import { describe, it, expect } from "vitest";
import { obfuscateProject } from "@/index";
import type { Doubt } from "@/index";
import { EXPRESSION_ARGUMENT_ATTRIBUTES, CONTEXT_ARGUMENT_ATTRIBUTES } from "@/wgsl/grammar";
import { expectSameProgram } from "@tests/helpers/differential";
import { count, identifiers, without } from "@tests/helpers/wgsl";

// An attribute the plugin does not know may make a name part of an interface. An unknown
// attribute does not compile, so the compiler checks take a known one off the lists.

function build(src: string) {
  const { files, report } = obfuscateProject({ "s.wgsl": src });
  return { out: files["s.wgsl"], report };
}

function doubt(report: { doubts: Doubt[] }, name: string): Doubt | undefined {
  return report.doubts.find((d) => d.name === name && d.rule === "unknown-attribute");
}

describe("a declaration that carries an unknown attribute keeps its name", () => {
  it.each([
    ["var", `@future var<private> counter: f32;\nfn bump() { counter += 1.0; }`, "counter", "module"],
    ["alias", `@future alias Scalar = f32;\nfn s() -> Scalar { return 1.0; }`, "Scalar", "module"],
    ["struct", `@future struct Light { power: f32 }\nfn l(x: Light) -> f32 { return x.power; }`, "Light", "module"],
    ["struct field", `struct Light { @future power: f32, tint: f32 }\nfn l(x: Light) -> f32 { return x.power + x.tint; }`, "power", "member"],
    ["parameter", `fn first() {}\nfn scale(@future amount: f32, other: f32) -> f32 { return amount * other; }`, "amount", "local"],
    ["local let", `fn first() {}\nfn f() -> f32 { @future let level = 1.0; let other = 2.0; return level + other; }`, "level", "local"],
    ["function, in front", `fn first() {}\n@future fn helper() -> f32 { return 1.0; }`, "helper", "module"],
    ["function, return type", `fn first() {}\nfn helper() -> @future f32 { return 1.0; }`, "helper", "module"],
    ["function, body", `fn first() {}\nfn helper() -> f32 @future { return 1.0; }`, "helper", "module"],
    ["function without return type, body", `fn first() {}\nfn helper() @future { }`, "helper", "module"],
  ])("%s", (_, src, name, space) => {
    const { out, report } = build(src);
    expect(count(out, name)).toBe(count(src, name));
    expect(doubt(report, name)).toMatchObject({ name, space, rule: "unknown-attribute", files: ["s.wgsl"] });
    // Plain words, with only the name as code: "parameter `amount` carries ..."
    expect(doubt(report, name)!.reason).toMatch(/^[a-z ]+ `[\w.]+` carries `@future`, which the plugin does not know/);
    expect(doubt(report, name)!.action).toBe("update the plugin to a version that knows `@future`");
  });

  it("renames the declarations next to it", () => {
    const { out } = build(`struct Light { @future power: f32, tint: f32 }\nfn l(x: Light) -> f32 { return x.power + x.tint; }`);
    for (const name of ["Light", "tint", "l", "x"]) expect(identifiers(out)).not.toContain(name);
  });

  it("points at the declaration", () => {
    const { report } = build(`struct Light {\n  @future\n  power: f32,\n}`);
    expect(doubt(report, "power")!.sites).toEqual([{ file: "s.wgsl", line: 3, column: 3 }]);
  });

  it("gives one position for a function with two unknown attributes", () => {
    const { report } = build(`@alpha @beta fn trace() {}`);
    const entry = doubt(report, "trace")!;
    expect(entry.sites).toEqual([{ file: "s.wgsl", line: 1, column: 17 }]);
    expect(entry.reason).toContain("`@alpha`");
    expect(entry.reason).toContain("`@beta`");
  });

  it("an attribute on the body or return type does not make the function an entry point", () => {
    // The leading function keeps its parameters for three.js
    const { out } = build(`fn tint(color: vec3f) -> vec3f @future { return color; }`);
    expect(identifiers(out)).toContain("color");
    expect(identifiers(out)).toContain("tint");
  });
});

describe("with a known attribute taken off the lists, the output still compiles", () => {
  it("a module `var` with `@binding`", async () => {
    const src = `
      @group(0) @binding(0) var<storage, read_write> totals: array<f32>;
      @group(0) @binding(1) var<storage, read> weights: array<f32>;
      @compute @workgroup_size(1) fn main() { totals[0] = weights[0]; }`;
    await without(EXPRESSION_ARGUMENT_ATTRIBUTES, ["binding"], async () => {
      const { out, report } = build(src);
      expect(identifiers(out)).toContain("totals");
      expect(identifiers(out)).toContain("weights");
      expect(report.doubts.map((d) => d.name).sort()).toEqual(["totals", "weights"]);
      await expectSameProgram(src, out);
    });
  });

  it("struct fields with `@size`", async () => {
    const src = `
      struct Particle { @size(16) mass: f32, speed: f32 }
      @group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
      @compute @workgroup_size(1) fn main() { particles[0].speed = particles[0].mass; }`;
    await without(EXPRESSION_ARGUMENT_ATTRIBUTES, ["size"], async () => {
      const { out, report } = build(src);
      expect(identifiers(out)).toContain("mass");
      expect(identifiers(out)).not.toContain("speed");
      expect(report.doubts.map((d) => `${d.space} ${d.name}`)).toEqual(["member mass"]);
      await expectSameProgram(src, out);
    });
  });

  it("parameters and a return type with `@location`", async () => {
    const src = `
      fn helper() -> f32 { return 1.0; }
      @fragment fn shade(@location(0) tint: vec4f, @location(1) glow: f32) -> @location(0) vec4f {
        return tint * glow * helper();
      }`;
    await without(EXPRESSION_ARGUMENT_ATTRIBUTES, ["location"], async () => {
      const { out, report } = build(src);
      for (const name of ["tint", "glow", "shade"]) expect(identifiers(out)).toContain(name);
      expect(identifiers(out)).not.toContain("helper");
      expect(report.doubts.map((d) => `${d.space} ${d.name}`)).toEqual(["local glow", "local tint"]);
      await expectSameProgram(src, out);
    });
  });

  it("a function whose body carries `@diagnostic` (Tint only)", async () => {
    const src = `
      @group(0) @binding(0) var tex: texture_2d<f32>;
      @group(0) @binding(1) var smp: sampler;
      fn other() -> f32 { return 2.0; }
      fn sampleEdge(uv: vec2f) -> vec4f @diagnostic(off, derivative_uniformity) {
        return textureSample(tex, smp, uv) * other();
      }
      @fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f { return sampleEdge(uv); }`;
    await without(CONTEXT_ARGUMENT_ATTRIBUTES, ["diagnostic"], async () => {
      const { out, report } = build(src);
      expect(identifiers(out)).toContain("sampleEdge");
      expect(identifiers(out)).not.toContain("other");
      expect(doubt(report, "sampleEdge")).toMatchObject({ space: "module" });
      await expectSameProgram(src, out);
    });
  });

  it("an override with `@id`", async () => {
    const src = `
      @id(3) override strength: f32 = 1.0;
      @group(0) @binding(0) var<storage, read_write> out: array<f32>;
      @compute @workgroup_size(1) fn main() { out[0] = strength; }`;
    await without(EXPRESSION_ARGUMENT_ATTRIBUTES, ["id"], async () => {
      const { out, report } = build(src);
      expect(identifiers(out)).toContain("strength");
      expect(doubt(report, "strength")).toMatchObject({ space: "module" });
      await expectSameProgram(src, out);
    });
  });
});
