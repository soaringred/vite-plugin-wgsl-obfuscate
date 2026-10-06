import { describe, it, expect } from "vitest";
import WGSLNodeFunction from "three/src/renderers/webgpu/nodes/WGSLNodeFunction.js";
import { obfuscate, obfuscateProject } from "@/index";
import { tokenize } from "@/wgsl/tokenizer";
import { resolve } from "@/analysis/resolver";
import { expectSafeRename } from "@tests/helpers/differential";
import { identifiers } from "@tests/helpers/wgsl";

// three.js `wgslFn` reads the parameter names of the function that starts the
// source, and JS passes arguments by those names. Which item is first: resolver.test.ts.

const WRAPPER = `fn rimLight(normal: vec3f, viewDir: vec3f, power: f32) -> f32 {
  let facing = 1.0 - max(dot(normal, viewDir), 0.0);
  return pow(facing, power);
}`;

const WRAPPER_PARAMS = ["normal", "viewDir", "power"];

/** Parameter names as three.js reads them. */
function threeInputs(src: string): string[] {
  return new WGSLNodeFunction(src).inputs.map((input) => input.name);
}

/** Name of the leading function the resolver finds, or null. */
function leadingName(src: string): string | null {
  const analysis = resolve(tokenize(src));
  return analysis.leadingFunction < 0 ? null : analysis.symbols[analysis.leadingFunction].name;
}

describe("the first item is a `fn`", () => {
  it("keeps its parameters and renames its name and locals", async () => {
    const out = await expectSafeRename(WRAPPER);
    expect(threeInputs(out)).toEqual(WRAPPER_PARAMS);
    expect(new WGSLNodeFunction(out).type).toBe("float");
    expect(identifiers(out)).not.toContain("rimLight");
    expect(identifiers(out)).not.toContain("facing");
  });

  it("reports the parameters as kept by `wgsl-fn-param`", () => {
    const { report } = obfuscateProject({ "rim.wgsl": WRAPPER });
    expect(report.files["rim.wgsl"].kept).toEqual(
      [...WRAPPER_PARAMS].sort().map((name) => ({ name, space: "local", rule: "wgsl-fn-param" })),
    );
    expect(report.doubts).toEqual([]);
  });

  it("still applies after directives and with an attribute on the function", async () => {
    const src = `enable f16;\ndiagnostic(off, derivative_uniformity);\n@diagnostic(off, derivative_uniformity) ${WRAPPER}`;
    expect(leadingName(src)).toBe("rimLight");
    const out = await expectSafeRename(src);
    for (const name of WRAPPER_PARAMS) expect(identifiers(out)).toContain(name);
  });

  it("applies per file in a project", () => {
    const { files } = obfuscateProject({
      "rim.wgsl": WRAPPER,
      "fresnel.wgsl": `fn fresnel(cosTheta: f32) -> f32 { return pow(1.0 - cosTheta, 5.0) * rimLight(vec3f(1.0), vec3f(0.0), 1.0); }`,
    });
    expect(threeInputs(files["rim.wgsl"])).toEqual(WRAPPER_PARAMS);
    expect(threeInputs(files["fresnel.wgsl"])).toEqual(["cosTheta"]);
  });
});

describe("the first item is not a plain `fn`", () => {
  it.each([
    ["a const", `const RIM_BIAS: f32 = 0.1;`],
    ["an entry point", `@fragment fn shade(@location(0) normal: vec3f) -> @location(0) vec4f { return vec4f(normal, 1.0); }`],
  ])("%s: the parameters are renamed", async (_, first) => {
    const src = `${first}\n${WRAPPER}`;
    expect(leadingName(src)).toBeNull();
    const out = await expectSafeRename(src);
    for (const name of WRAPPER_PARAMS) expect(identifiers(out)).not.toContain(name);
  });

  it("a function with an unknown attribute counts as an entry point", () => {
    const src = `@futureStage fn trace(origin: vec3f) -> f32 { return origin.x; }\n${WRAPPER}`;
    expect(leadingName(src)).toBeNull();
    const out = obfuscate(src);
    expect(identifiers(out)).toContain("trace");
    for (const name of ["origin", ...WRAPPER_PARAMS]) expect(identifiers(out)).not.toContain(name);
  });
});

describe('wgslFnParams: "rename"', () => {
  it("renames the leading function's parameters, and three.js still reads their types", async () => {
    const out = await expectSafeRename(WRAPPER, { wgslFnParams: "rename" });
    const before = new WGSLNodeFunction(WRAPPER);
    const after = new WGSLNodeFunction(out);
    expect(after.inputs.map((i) => i.type)).toEqual(before.inputs.map((i) => i.type));
    for (const [i, input] of after.inputs.entries()) {
      expect(input.name).not.toBe(before.inputs[i].name);
      expect(input.name).toMatch(/^_[a-z]+$/);
    }
    const { report } = obfuscateProject({ "rim.wgsl": WRAPPER }, { wgslFnParams: "rename" });
    expect(report.files["rim.wgsl"].kept).toEqual([]);
  });

  it("changes nothing in a file without a leading function", () => {
    const src = `const RIM_BIAS: f32 = 0.1;\n${WRAPPER}`;
    expect(obfuscate(src, { wgslFnParams: "rename" })).toBe(obfuscate(src));
  });
});
