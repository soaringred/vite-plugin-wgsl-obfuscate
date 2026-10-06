import { describe, it, expect } from "vitest";
import WGSLNodeFunction from "three/src/renderers/webgpu/nodes/WGSLNodeFunction.js";
import { obfuscate, obfuscateProject } from "@/index";
import {
  STAGE_ATTRIBUTES,
  NO_ARGUMENT_ATTRIBUTES,
  EXPRESSION_ARGUMENT_ATTRIBUTES,
  CONTEXT_ARGUMENT_ATTRIBUTES,
} from "@/wgsl/grammar";
import { expectComputePipeline, nagaErrors } from "@tests/helpers/compilers";
import { count, identifiers, members, without } from "@tests/helpers/wgsl";
import { link, expectSameOnBoth, wgslFnInputs, obfuscateErrorOf } from "@tests/engine/regressions/helpers";

// Problems 22-27, found while designing 0.2.

// Problem 22: a name that WGSL in a JS string declares (`PI`) was renamed where another file declares it too
const P22_PRELUDE = `const PI: f32 = 3.14159265;`;

const P22_FILES = {
  "ring.wgsl": `
    @group(0) @binding(0) var<storage, read_write> areas: array<f32>;
    @compute @workgroup_size(1)
    fn ringAreas(@builtin(global_invocation_id) gid: vec3u) {
      let outer = f32(gid.x) + 1.0;
      areas[gid.x] = PI * (outer * outer - 1.0);
    }
  `,
  // Unrelated to ring.wgsl, and never linked with it or with the prelude
  "gauge.wgsl": `
    const PI: f32 = 3.0;
    fn roughCircumference(radius: f32) -> f32 { return 2.0 * PI * radius; }
  `,
};

// Problem 23: a field read on a struct declared outside the project was renamed.
// This code is outside the project, linked with tonemap.wgsl at runtime.
const P23_EXTERNAL = `
  struct Camera { exposure: f32, gamma: f32 }
  @group(0) @binding(0) var<uniform> cam: Camera;
`;

const P23_FILES = {
  "tonemap.wgsl": `
    @group(0) @binding(1) var<storage, read_write> pixels: array<vec3f>;
    @compute @workgroup_size(64)
    fn tonemap(@builtin(global_invocation_id) gid: vec3u) {
      pixels[gid.x] = pow(pixels[gid.x] * cam.exposure, vec3f(1.0 / cam.gamma));
    }
  `,
  "grade.wgsl": `
    struct Grade { exposure: f32, lift: f32 }
    fn applyGrade(g: Grade, c: vec3f) -> vec3f { return c * g.exposure + vec3f(g.lift); }
  `,
};

// Problem 24: a three.js `wgslFn` body with a helper after it lost its parameter names
const P24 = `fn sparkle(uv: vec2f, time: f32) -> f32 {
  return twinkle(uv * 8.0, time) * 0.5;
}
fn twinkle(cell: vec2f, phase: f32) -> f32 {
  return fract(sin(dot(cell, vec2f(12.9898, 78.233)) + phase) * 43758.5453);
}
`;

// Problem 25: input that is not plain WGSL gave garbage output. Each case has the position the error must name.
const P25: { name: string; source: string; line: number; column: number; reason: RegExp }[] = [
  {
    name: "`#include`",
    source: `fn shade() -> f32 { return 1.0; }\n#include "lights.wgsl"\nfn lit() -> f32 { return 2.0; }`,
    line: 2,
    column: 1,
    reason: /`#` is not WGSL.*#include/,
  },
  {
    name: "`#define`",
    source: `// scale\n  #define SCALE 2.0\nfn shade() -> f32 { return SCALE; }`,
    line: 2,
    column: 3,
    reason: /`#` is not WGSL.*#define/,
  },
  {
    name: "a `${...}` placeholder",
    source: `fn shade() -> f32 {\n  return \${scale} * 2.0;\n}`,
    line: 2,
    column: 10,
    reason: /`\$\{` is not WGSL/,
  },
  {
    name: "a missing `;` at module scope",
    source: `const A = 1.0\nconst B = 2.0;`,
    line: 2,
    column: 1,
    reason: /expected `;` to end the `const` declaration before `const`/,
  },
  {
    name: "a missing `;` in a function",
    source: `fn shade() -> f32 {\n  let a = 1.0\n  return a;\n}`,
    line: 3,
    column: 3,
    reason: /expected `;` to end the `let` declaration before `return`/,
  },
  {
    name: "an unbalanced `{`",
    source: `fn shade() -> f32 {\n  if (true) {\n    return 1.0;\n}`,
    line: 1,
    column: 19,
    reason: /this `\{` is never closed/,
  },
];

// Problem 26: a declaration with an attribute the plugin did not know was renamed.
// Tests take `compute` off the lists to stand in for a stage added to WGSL later.
const P26_STAGE = `
  @group(0) @binding(0) var<storage, read_write> samples: array<f32>;
  fn weight(i: u32) -> f32 { return 1.0 / f32(i + 1u); }
  @compute @workgroup_size(8)
  fn accumulate(@builtin(global_invocation_id) gid: vec3u) { samples[gid.x] *= weight(gid.x); }
`;

// With `workgroup_size` taken off the lists, `GROUP` is an unknown attribute's argument
const P26_ARGUMENT = `
  const GROUP: u32 = 64u;
  @group(0) @binding(0) var<storage, read_write> counts: array<u32>;
  @compute @workgroup_size(GROUP)
  fn countUp(@builtin(global_invocation_id) gid: vec3u) { counts[gid.x] += GROUP + tally(gid.x); }
  fn tally(i: u32) -> u32 { return i * 2u; }
`;

// With `diagnostic` taken off the lists, its argument `off` could name the parameter `off`
const P26_LOCAL = `
  @diagnostic(off, derivative_uniformity)
  fn edgeWeight(off: f32, coverage: f32) -> f32 {
    if (coverage > off) { return fwidth(coverage); }
    return off;
  }
  @fragment
  fn shadeEdge(@location(0) coverage: f32) -> @location(0) vec4f { return vec4f(edgeWeight(0.5, coverage)); }
`;

// Problem 27: code the plugin cannot see declares `_a`, which the plugin generated too.
// This code is linked with the project's output at runtime.
const P27_HIDDEN = `fn _a(x: f32) -> f32 { return x * 0.5; }`;

const P27 = `
  @group(0) @binding(0) var<storage, read_write> values: array<f32>;
  fn scaleValue(v: f32) -> f32 { return v * 2.0; }
  @compute @workgroup_size(1) fn main() { values[0] = scaleValue(values[0]); }
`;


describe("regressions: problems 22-27", () => {
  it("problem 22: a name a JS string declares is kept when `preserve` lists it", async () => {
    const { files: out, report } = obfuscateProject(P22_FILES, { preserve: ["PI"] });
    expect(identifiers(out["ring.wgsl"])).toContain("PI");
    expect(identifiers(out["gauge.wgsl"])).toContain("PI");
    expect(report.moduleMap.has("PI")).toBe(false);

    // What runs: the prelude followed by the obfuscated file
    await expectSameOnBoth(link(P22_PRELUDE, P22_FILES["ring.wgsl"]), link(P22_PRELUDE, out["ring.wgsl"]));
    await expectSameOnBoth(P22_FILES["gauge.wgsl"], out["gauge.wgsl"]);
  });

  it("problem 22: without `preserve`, the name is renamed and the prelude no longer links", () => {
    // gauge.wgsl declares `PI`, so the project renames it in both files. The
    // prelude is not in the project, so nothing says it declares `PI` too.
    const { files: out, report } = obfuscateProject(P22_FILES);
    expect(report.moduleMap.has("PI")).toBe(true);
    expect(identifiers(out["ring.wgsl"])).not.toContain("PI");
    expect(nagaErrors(link(P22_PRELUDE, out["ring.wgsl"]))).toMatch(/no definition in scope/);
  });

  it("problem 23: a field read on a struct declared outside the project is kept in every file", async () => {
    const { files: out, report } = obfuscateProject(P23_FILES);
    // The access in tonemap.wgsl is left as written...
    expect(members(out["tonemap.wgsl"])).toEqual(members(P23_FILES["tonemap.wgsl"]));
    // ...and so is the field of the same name in grade.wgsl, declaration and access
    expect(count(out["grade.wgsl"], "exposure")).toBe(2);
    expect(report.memberMap.has("exposure")).toBe(false);
    // A field that every access proves is renamed
    expect(report.memberMap.has("lift")).toBe(true);
    expect(identifiers(out["grade.wgsl"])).not.toContain("lift");

    const doubt = report.doubts.find((d) => d.name === "exposure");
    expect(doubt).toMatchObject({
      space: "member",
      rule: "unproven-access",
      files: ["grade.wgsl", "tonemap.wgsl"],
      sites: [{ file: "tonemap.wgsl", line: 5, column: 47 }],
    });
    expect(doubt!.reason).toMatch(/`cam` is not declared in the project/);

    await expectSameOnBoth(link(P23_EXTERNAL, P23_FILES["tonemap.wgsl"]), link(P23_EXTERNAL, out["tonemap.wgsl"]));
    await expectSameOnBoth(P23_FILES["grade.wgsl"], out["grade.wgsl"]);
  });

  it("problem 24: a wgslFn body with a helper after the leading function keeps its inputs", async () => {
    const out = obfuscate(P24);
    const before = new WGSLNodeFunction(P24);
    const after = new WGSLNodeFunction(out);
    expect(wgslFnInputs(out)).toEqual(wgslFnInputs(P24));
    expect(after.inputs.map((input) => input.name)).toEqual(["uv", "time"]);
    expect(after.type).toBe(before.type);
    // The helper's parameters and both function names are renamed
    for (const name of ["sparkle", "twinkle", "cell", "phase"]) expect(identifiers(out)).not.toContain(name);

    // three.js rewrites the signature and carries the helper along as body text
    await expectSameOnBoth(before.getCode("threeNodeFn"), after.getCode("threeNodeFn"));
  });

  describe("problem 25: input that is not plain WGSL fails with a file, a position and a reason", () => {
    it.each(P25)("$name", ({ source, line, column, reason }) => {
      const error = obfuscateErrorOf(() => obfuscateProject({ "shader.wgsl": source }));
      expect({ file: error.file, line: error.line, column: error.column }).toEqual({ file: "shader.wgsl", line, column });
      expect(error.reason).toMatch(reason);
      expect(error.message).toBe(`Cannot obfuscate shader.wgsl:${line}:${column}: ${error.reason}`);
      // `obfuscate` names its one file "source"
      expect(obfuscateErrorOf(() => obfuscate(source)).file).toBe("source");
    });

    it("fails the whole project when one file is not WGSL", () => {
      const error = obfuscateErrorOf(() =>
        obfuscateProject({ "good.wgsl": `fn good() -> f32 { return 1.0; }`, "bad.wgsl": P25[0].source }),
      );
      expect(error.file).toBe("bad.wgsl");
    });
  });

  it("problem 26: a function with a stage attribute the plugin does not know keeps its name", async () => {
    await without(STAGE_ATTRIBUTES, ["compute"], () =>
      without(NO_ARGUMENT_ATTRIBUTES, ["compute"], async () => {
        const { files, report } = obfuscateProject({ "pass.wgsl": P26_STAGE });
        const out = files["pass.wgsl"];
        expect(identifiers(out)).toContain("accumulate");
        expect(identifiers(out)).not.toContain("weight");
        expect(report.doubts).toContainEqual(
          expect.objectContaining({ name: "accumulate", space: "module", rule: "unknown-attribute" }),
        );
        await expectSameOnBoth(P26_STAGE, out);
        await expectComputePipeline(out, "accumulate");
      }),
    );
  });

  it("problem 26: a stage from a newer WGSL is an entry point and its arguments stay as written", () => {
    const src = `
      const RAYS: u32 = 4u;
      fn shadeHit(t: f32) -> f32 { return t * 0.5; }
      @raygen @max_recursion(RAYS) fn traceRays(@builtin(launch_id) id: vec3u) { _ = shadeHit(f32(id.x)); }
    `;
    const { files, report } = obfuscateProject({ "rays.wgsl": src });
    const out = files["rays.wgsl"];
    expect(identifiers(out)).toContain("traceRays");
    expect(count(out, "RAYS")).toBe(2);
    expect(out).toContain("@raygen");
    expect(out).toContain("@max_recursion(RAYS)");
    expect(identifiers(out)).not.toContain("shadeHit");
    expect(report.doubts.map((d) => `${d.space} ${d.name} ${d.rule}`)).toEqual([
      "module RAYS unknown-attribute",
      "module traceRays unknown-attribute",
    ]);
  });

  it("problem 26: a declaration that an unknown attribute's argument could name is kept", async () => {
    await without(EXPRESSION_ARGUMENT_ATTRIBUTES, ["workgroup_size"], async () => {
      const { files, report } = obfuscateProject({ "count.wgsl": P26_ARGUMENT });
      const out = files["count.wgsl"];
      // Declaration, use and attribute argument all stay
      expect(count(out, "GROUP")).toBe(3);
      expect(identifiers(out)).not.toContain("tally");
      expect(report.doubts).toContainEqual(
        expect.objectContaining({
          name: "GROUP",
          space: "module",
          rule: "unknown-attribute",
          sites: [{ file: "count.wgsl", line: 4, column: 28 }],
        }),
      );
      await expectSameOnBoth(P26_ARGUMENT, out);
    });
  });

  it("problem 26: a local that an unknown attribute's argument could name is kept", async () => {
    await without(CONTEXT_ARGUMENT_ATTRIBUTES, ["diagnostic"], async () => {
      const { files, report } = obfuscateProject({ "edge.wgsl": P26_LOCAL });
      const out = files["edge.wgsl"];
      expect(count(out, "off")).toBe(count(P26_LOCAL, "off"));
      expect(identifiers(out)).not.toContain("coverage");
      expect(report.doubts).toContainEqual(
        expect.objectContaining({ name: "off", space: "local", rule: "unknown-attribute" }),
      );
      await expectSameOnBoth(P26_LOCAL, out);
    });
  });

  it("problem 27: code the plugin cannot see declares `_a`; `prefix` avoids the clash", async () => {
    // The default prefix generates `_a` too
    const clash = obfuscate(P27);
    expect(identifiers(clash)).toContain("_a");
    expect(nagaErrors(link(P27_HIDDEN, clash))).toMatch(/redefinition/);

    const out = obfuscate(P27, { prefix: "_w" });
    expect(identifiers(out).filter((n) => n.startsWith("_"))).not.toHaveLength(0);
    expect(identifiers(out).filter((n) => n.startsWith("_")).every((n) => n.startsWith("_w"))).toBe(true);
    await expectSameOnBoth(link(P27_HIDDEN, P27), link(P27_HIDDEN, out));
  });

  it.each([
    ["an empty prefix", ""],
    ["a prefix starting with `__`", "__x"],
    ["a prefix with a character that is not an identifier's", "a-b"],
    ["a prefix that is not a string", 7],
  ])("problem 27: %s is rejected", (_, prefix) => {
    expect(() => obfuscate(P27, { prefix: prefix as string })).toThrow(TypeError);
    expect(() => obfuscate(P27, { prefix: prefix as string })).toThrow(/invalid `prefix`/);
  });
});
