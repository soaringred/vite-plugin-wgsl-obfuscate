import { describe, it, expect } from "vitest";
import { obfuscate, obfuscateProject } from "@/index";
import { expectValid, expectSameSpirv, expectComputePipeline } from "@tests/helpers/compilers";
import { expectSafeRename } from "@tests/helpers/differential";
import { count, members, nonMembers } from "@tests/helpers/wgsl";

// Names that are never renamed, one block per rule. The leading-function rule
// is in leading-function.test.ts, overrides also in regression problem 5.

describe("entry points", () => {
  it("keeps entry point names, which JS selects with `entryPoint`", async () => {
    const src = `
      @group(0) @binding(0) var<storage, read_write> cells: array<u32>;
      fn cellValue(i: u32) -> u32 { return i * 3u; }
      @compute @workgroup_size(1) fn fillCells(@builtin(global_invocation_id) id: vec3u) { cells[id.x] = cellValue(id.x); }
      @compute @workgroup_size(1) fn clearCells(@builtin(global_invocation_id) id: vec3u) { cells[id.x] = 0u; }
    `;
    const out = await expectSafeRename(src);
    expect(nonMembers(out)).toContain("fillCells");
    expect(nonMembers(out)).toContain("clearCells");
    expect(nonMembers(out)).not.toContain("cellValue");
    await expectComputePipeline(out, "fillCells");
    await expectComputePipeline(out, "clearCells");
  });

  it("keeps the name in every file, by name", async () => {
    // `main` is an entry point in one file and a helper in another, never linked with it
    const files = {
      "pass.wgsl": `@compute @workgroup_size(1) fn main() {}`,
      "helpers.wgsl": `fn main(v: f32) -> f32 { return v * 2.0; } fn twice(v: f32) -> f32 { return main(main(v)); }`,
    };
    const { files: out, report } = obfuscateProject(files);
    expect(count(out["helpers.wgsl"], "main")).toBe(3);
    expect(report.files["helpers.wgsl"].kept).toContainEqual({ name: "main", space: "module", rule: "entry-point" });
    await expectValid(out["helpers.wgsl"]);
    expectSameSpirv(files["helpers.wgsl"], out["helpers.wgsl"]);
  });
});

describe("overrides without @id", () => {
  it("keeps the name in the files that use it", async () => {
    const files = {
      "settings.wgsl": `override quality: f32 = 1.0;`,
      "pass.wgsl": `
        @group(0) @binding(0) var<storage, read_write> result: f32;
        @compute @workgroup_size(1) fn main() { result = quality; }
      `,
    };
    const { files: out, report } = obfuscateProject(files);
    expect(nonMembers(out["pass.wgsl"])).toContain("quality");
    expect(report.files["pass.wgsl"].kept).toContainEqual({ name: "quality", space: "module", rule: "override" });
    await expectComputePipeline(`${out["settings.wgsl"]}\n${out["pass.wgsl"]}`, "main", { quality: 3 });
  });
});

describe("names that are also predeclared", () => {
  it("keeps a module-scope declaration named like a builtin function, type or enumerant", async () => {
    // Another file, never linked with this one, uses the builtins: renaming the declarations would rename them too
    const files = {
      "shadowing.wgsl": `
        fn saturate(v: f32) -> f32 { return clamp(v, 0.25, 0.75); }
        const rgba8unorm: u32 = 7u;
        alias vec2i = vec2f;
        fn useThem(v: vec2i) -> f32 { return saturate(v.x) * f32(rgba8unorm); }
      `,
      "builtins.wgsl": `
        @group(0) @binding(0) var target_: texture_storage_2d<rgba8unorm, write>;
        @compute @workgroup_size(1) fn main() {
          let v = vec2i(1, 2);
          textureStore(target_, v, vec4f(saturate(1.5)));
        }
      `,
    };
    const { files: out, report } = obfuscateProject(files);
    for (const name of ["saturate", "rgba8unorm", "vec2i"]) {
      expect(nonMembers(out["shadowing.wgsl"])).toContain(name);
      expect(report.moduleMap.has(name)).toBe(false);
      expect(report.files["shadowing.wgsl"].kept).toContainEqual({ name, space: "module", rule: "predeclared" });
    }
    expect(nonMembers(out["shadowing.wgsl"])).not.toContain("useThem");
    for (const id of Object.keys(files) as (keyof typeof files)[]) {
      await expectValid(out[id], id);
      expectSameSpirv(files[id], out[id]);
    }
  });
});

describe("enumerants", () => {
  it("keeps parameters and locals named like enumerants", async () => {
    const src = `
      fn weigh(storage: f32, read: f32) -> f32 {
        let rgba8unorm = storage * read;
        var workgroup = rgba8unorm + 1.0;
        return workgroup;
      }
      @group(0) @binding(0) var<storage, read_write> result: f32;
      @compute @workgroup_size(1) fn main() { result = weigh(result, 2.0); }
    `;
    const out = await expectSafeRename(src);
    for (const name of ["storage", "read", "rgba8unorm", "workgroup"]) expect(count(out, name)).toBe(count(src, name));
    expect(nonMembers(out)).not.toContain("weigh");
    const { report } = obfuscateProject({ "a.wgsl": src });
    expect(report.files["a.wgsl"].kept).toContainEqual({ name: "rgba8unorm", space: "local", rule: "enumerant" });
  });
});

describe("swizzle-like and builtin result members", () => {
  it("keeps struct fields named like swizzles or builtin result members, and no other field", async () => {
    const src = `
      struct Sample { rgb: vec3f, xy: vec2f, fract: f32, whole: f32, exp: i32, old_value: u32, exchanged: bool, weight: f32 }
      fn mixSample(s: Sample, v: f32) -> f32 {
        let parts = modf(v);
        let split = frexp(v);
        return s.rgb.g + s.xy.x + s.fract + s.whole + f32(s.exp) + f32(s.old_value) + select(0.0, 1.0, s.exchanged)
          + s.weight + parts.fract + parts.whole + f32(split.exp) + split.fract;
      }
      @group(0) @binding(0) var<storage, read_write> result: f32;
      @group(0) @binding(1) var<storage, read_write> counter: atomic<u32>;
      @compute @workgroup_size(1) fn main() {
        let swap = atomicCompareExchangeWeak(&counter, 0u, 1u);
        let s = Sample(vec3f(1.0), vec2f(2.0), 0.5, 1.0, 2, swap.old_value, swap.exchanged, 3.0);
        result = mixSample(s, result);
      }
    `;
    const out = await expectSafeRename(src);
    // Every member name stays except the ordinary field `weight`
    const weight = members(out)[members(src).indexOf("weight")];
    expect(weight).not.toBe("weight");
    expect(members(out)).toEqual(members(src).map((m) => (m === "weight" ? weight : m)));
    // Kept by these rules, not in doubt
    const { report } = obfuscateProject({ "a.wgsl": src });
    expect(report.doubts).toEqual([]);
    for (const name of ["fract", "whole", "exp", "old_value", "exchanged"]) {
      expect(report.files["a.wgsl"].kept).toContainEqual({ name, space: "member", rule: "builtin-member" });
    }
    for (const name of ["rgb", "xy"]) {
      expect(report.files["a.wgsl"].kept).toContainEqual({ name, space: "member", rule: "swizzle" });
    }
  });
});

describe("preserve", () => {
  it("keeps a module-scope name, a struct field and a local", async () => {
    const src = `
      struct Light { power: f32, range: f32 }
      const falloff: f32 = 2.0;
      fn lit(l: Light, distance: f32) -> f32 { let reach = l.range / distance; return l.power * pow(reach, falloff); }
      @group(0) @binding(0) var<storage, read_write> result: f32;
      @compute @workgroup_size(1) fn main() { result = lit(Light(1.0, 4.0), result); }
    `;
    const preserve = ["falloff", "power", "reach"];
    const out = obfuscate(src, { preserve });
    await expectValid(out);
    expectSameSpirv(src, out);
    expect(nonMembers(out)).toContain("falloff");
    expect(members(out)).toContain("power");
    expect(nonMembers(out)).toContain("reach");
    expect(members(out)).not.toContain("range");
    const { report } = obfuscateProject({ "a.wgsl": src }, { preserve });
    expect(report.files["a.wgsl"].kept).toEqual([
      { name: "falloff", space: "module", rule: "preserve" },
      { name: "main", space: "module", rule: "entry-point" },
      { name: "power", space: "member", rule: "preserve" },
      { name: "reach", space: "local", rule: "preserve" },
    ]);
  });

  it("keeps an unresolved name that another file declares", () => {
    const { files } = obfuscateProject(
      { "lib.wgsl": `fn sharedValue() -> f32 { return 1.0; }`, "use.wgsl": `fn user() -> f32 { return sharedValue(); } fn other() {}` },
      { preserve: ["sharedValue"] },
    );
    expect(nonMembers(files["use.wgsl"])).toContain("sharedValue");
    expect(nonMembers(files["lib.wgsl"])).toContain("sharedValue");
  });
});
