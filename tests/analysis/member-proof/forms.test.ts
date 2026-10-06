import { describe, it, expect } from "vitest";
import { obfuscateProject } from "@/index";
import { expectSameSpirv, nagaErrors } from "@tests/helpers/compilers";
import { build, expectLinkSet, expectProven, expectUnproven, useSites } from "@tests/analysis/member-proof/helpers";
import { count } from "@tests/helpers/wgsl";

// Forms the proof learned after its first version, and the near misses it must
// still refuse.

describe("proven: `array(...)` without a template list", () => {
  it.each([
    ["indexed directly", `fn value() -> f32 { return array(Inner(1.0), Inner(2.0))[0].depth; }`, "depth"],
    ["through an inferred `let`", `fn value(p: Probe) -> f32 { let ps = array(p, makeProbe()); return ps[1].gain; }`, "gain"],
    ["with a template-typed argument", `fn value() -> f32 { return array(array<Inner, 2>(), array<Inner, 2>())[1][0].depth; }`, "depth"],
  ])("%s", async (_, use, field) => {
    await expectProven({ files: { "use.wgsl": use } }, field);
  });

  it("not when a project file declares a function named `array`", () => {
    // The call then may name either, so it is not read as the constructor
    const { report } = obfuscateProject({
      "lib.wgsl": `struct Inner { depth: f32 } fn array(a: Inner, b: Inner) -> f32 { return a.depth + b.depth; }`,
      "use.wgsl": `fn value(i: Inner) -> f32 { let v = array(i, i); return v; }`,
    });
    expect(report.memberMap.has("depth")).toBe(true);
    const { report: withAccess } = obfuscateProject({
      "lib.wgsl": `struct Inner { depth: f32 } fn array(a: Inner) -> Inner { return a; }`,
      "use.wgsl": `fn value(i: Inner) -> f32 { return array(i).depth; }`,
    });
    // `array` is then predeclared and declared by the project: the proof follows neither
    expect(withAccess.memberMap.has("depth")).toBe(false);
  });
});

describe("proven: `workgroupUniformLoad`", () => {
  const use = `
    var<workgroup> pending: Probe;
    @compute @workgroup_size(1) fn main() { _ = value(); }
    fn value() -> f32 { let r = workgroupUniformLoad(&pending); return r.gain + workgroupUniformLoad(&pending).inner.depth; }`;

  it.each(["gain", "depth"])("`.%s` of its result", async (field) => {
    await expectProven({ files: { "use.wgsl": use } }, field);
  });
});

describe("proven: template lists as WGSL finds them", () => {
  it.each([
    [
      "`>=` closing a type's template list, in a `let`",
      `fn value() -> f32 { let a: array<Inner, 2>= array<Inner, 2>(Inner(1.0), Inner(2.0)); return a[0].depth; }`,
      "depth",
    ],
    [
      "`>=` closing a module-scope `var`'s type",
      `var<private> table: array<Inner, 2>= array<Inner, 2>(); fn value() -> f32 { return table[1].depth; }`,
      "depth",
    ],
    [
      "`>>=` closing two lists",
      `fn value() -> f32 { var arr: array<Inner, 2>; let q: ptr<function, array<Inner, 2>>= &arr; return q[0].depth; }`,
      "depth",
    ],
    ["`x > (s).m`, a comparison", `fn value(p: Probe) -> bool { return 0.5 > (p).gain; }`, "gain"],
    ["`a < b || c > (s).m`, two comparisons", `fn value(p: Probe, a: f32, b: f32) -> bool { return a < b || 1.0 > (p).gain; }`, "gain"],
  ])("%s", async (_, use, field) => {
    await expectProven({ files: { "use.wgsl": use } }, field);
  });

  it("`x >> (s).m`, a shift", async () => {
    const use = `struct Bits { count: u32 } fn value(b: Bits) -> u32 { return 8u >> (b).count; }`;
    await expectProven({ files: { "use.wgsl": use } }, "count");
  });

  it("`a<b>(s).m` stays a templated call, which the proof does not follow", async () => {
    // `vec2<f32>(...)` is a call of the builtin, whose result is not a struct
    const use = `fn value(p: Probe) -> f32 { return vec4<f32>(p.gain).x + array<Probe, 1>(p)[0].gain; }`;
    await expectProven({ files: { "use.wgsl": use } }, "gain");
  });
});

describe("proven: a name that several project files declare", () => {
  // Each declaring file is linked with use.wgsl in its own link set, and the
  // access is proven only because it is proven for every declaration
  it("a value", async () => {
    const use = `fn value() -> f32 { return sharedProbe.gain + sharedProbe.inner.depth; }`;
    const files = {
      "a.wgsl": `var<private> sharedProbe: Probe;`,
      "b.wgsl": `var<private> sharedProbe = Probe(1.0, Inner(2.0), array<Inner, 2>());`,
      "use.wgsl": use,
    };
    const result = await expectProven({ files, linked: ["a.wgsl", "use.wgsl"] }, "gain");
    await expectLinkSet({ files, linked: ["b.wgsl", "use.wgsl"] }, result as ReturnType<typeof build>);
    expect(result.report.memberMap.has("depth")).toBe(true);
  });

  it("a struct, with different fields in each file", async () => {
    const files = {
      "a.wgsl": `struct Beam { width: f32 }`,
      "b.wgsl": `struct Beam { glow: f32, width: f32 }`,
      "use.wgsl": `fn value(b: Beam) -> f32 { return b.width; }`,
    };
    const result = await expectProven({ files, linked: ["a.wgsl", "use.wgsl"] }, "width");
    await expectLinkSet({ files, linked: ["b.wgsl", "use.wgsl"] }, result as ReturnType<typeof build>);
  });

  it("a function returning a different struct in each file", async () => {
    const files = {
      "a.wgsl": `struct Ray { length: f32 } fn emit() -> Ray { return Ray(1.0); }`,
      "b.wgsl": `struct Beam { length: f32, glow: f32 } fn emit() -> Beam { return Beam(2.0, 3.0); }`,
      "use.wgsl": `fn value() -> f32 { return emit().length; }`,
    };
    const result = await expectProven({ files, linked: ["a.wgsl", "use.wgsl"] }, "length");
    await expectLinkSet({ files, linked: ["b.wgsl", "use.wgsl"] }, result as ReturnType<typeof build>);
  });

  it("not when one declaration's struct lacks the field", async () => {
    const use = `fn value(b: Beam) -> f32 { return b.width; }`;
    const files = { "other.wgsl": `struct Beam { glow: f32 }`, "use.wgsl": use, "types.wgsl": `struct Beam { width: f32 }` };
    const { report } = await expectUnproven({ files, linked: ["types.wgsl", "use.wgsl"] }, "width", useSites(use, "width"), "types.wgsl");
    expect(report.doubts.find((d) => d.name === "width")!.reason).toMatch(
      /`Beam` is declared more than once in the project, and the struct `Beam` in other\.wgsl has no field `width`/,
    );
  });
});

describe("proven: `binding_array` (naga)", () => {
  it("an element of a binding array of structs", () => {
    const src = `enable wgpu_binding_array;
struct Buffer { total: u32, rest: array<u32> }
@group(0) @binding(0) var<storage, read> buffers: binding_array<Buffer, 2>;
@group(0) @binding(1) var<storage, read_write> out: array<u32>;
@compute @workgroup_size(1) fn main() { out[0] = buffers[1].total; }`;
    expect(nagaErrors(src)).toBeNull();
    const { files, report } = obfuscateProject({ "s.wgsl": src });
    expect(report.memberMap.has("total")).toBe(true);
    expect(count(files["s.wgsl"], "total")).toBe(0);
    expectSameSpirv(src, files["s.wgsl"]);
  });
});
