import { describe, it, expect } from "vitest";
import { obfuscate, obfuscateProject } from "@/index";
import { expectValid, expectSameSpirv, expectComputePipeline } from "@tests/helpers/compilers";
import { loadProject, LINK_SETS, link } from "@tests/engine/project/helpers";
import { identifiers } from "@tests/helpers/wgsl";

// A library, a file that depends on it, a compute pass and three.js wrappers,
// obfuscated together. Each link set is the concatenation of its files.

const SOURCES = loadProject();
const { files: OUTPUTS, report: REPORT } = obfuscateProject(SOURCES);

describe("project link sets", () => {
  it.each(Object.entries(LINK_SETS))("%s: stays valid and compiles to the same SPIR-V", async (_, names) => {
    await expectValid(link(SOURCES, names), "original link set");
    await expectValid(link(OUTPUTS, names), "obfuscated link set");
    expectSameSpirv(link(SOURCES, names), link(OUTPUTS, names));
  });

  it("the whole project links as one module", async () => {
    const names = Object.keys(SOURCES);
    await expectValid(link(OUTPUTS, names));
    expectSameSpirv(link(SOURCES, names), link(OUTPUTS, names));
  });

  it("keeps the entry point and the override without @id, so JS still sets them by name", async () => {
    expect(identifiers(OUTPUTS["wave-bake.wgsl"])).toContain("bakeHeights");
    expect(identifiers(OUTPUTS["wave-bake.wgsl"])).toContain("gridSize");
    expect(identifiers(OUTPUTS["wave-bake.wgsl"])).not.toContain("bakeTime");
    await expectComputePipeline(link(OUTPUTS, LINK_SETS.bake), "bakeHeights", { gridSize: 32, 3: 1.5 });
  });
});

describe("project names", () => {
  it("renames every module-scope name the project declares, in every file", () => {
    for (const name of ["WAVE_COUNT", "Wave", "Height", "gerstnerOffset", "defaultWave", "surfaceAt", "surfaceHeight"]) {
      expect(REPORT.moduleMap.get(name), name).toMatch(/^_[a-z]+$/);
    }
    for (const [file, out] of Object.entries(OUTPUTS)) {
      for (const name of REPORT.moduleMap.keys()) expect(identifiers(out), `${name} in ${file}`).not.toContain(name);
    }
  });

  it("renames struct fields across files", () => {
    for (const name of ["direction", "steepness", "wavelength", "offset", "foam"]) {
      expect(REPORT.memberMap.get(name), name).toMatch(/^_[a-z]+$/);
    }
    // `foam` is also a wrapper parameter: kept there, renamed as a field
    expect(identifiers(OUTPUTS["wave-fn-tint.wgsl"])).toContain("foam");
    expect(identifiers(OUTPUTS["wave-fn-foam.wgsl"])).not.toContain("foam");
  });

  it("a local named like a library function is renamed as a local", () => {
    // wave-surface.wgsl declares `let waveNumber` inside surfaceAt
    const surface = identifiers(OUTPUTS["wave-surface.wgsl"]);
    expect(surface).not.toContain("waveNumber");
    expect(surface).not.toContain(REPORT.moduleMap.get("waveNumber"));
  });
});

describe("project report", () => {
  it("lists cross-file links with the declaring file", () => {
    expect(REPORT.files["wave-fn-height.wgsl"].links).toEqual([
      { name: "surfaceHeight", declaredIn: ["wave-surface.wgsl"] },
    ]);
    expect(REPORT.files["wave-surface.wgsl"].links).toEqual([
      { name: "Height", declaredIn: ["wave-lib.wgsl"] },
      { name: "WAVE_COUNT", declaredIn: ["wave-lib.wgsl"] },
      { name: "defaultWave", declaredIn: ["wave-lib.wgsl"] },
      { name: "gerstnerOffset", declaredIn: ["wave-lib.wgsl"] },
    ]);
    expect(REPORT.files["wave-lib.wgsl"].links).toEqual([]);
  });

  it("lists names nothing in the project declares", () => {
    const { report } = obfuscateProject({
      "caller.wgsl": `fn caller(v: f32) -> f32 { return externalHelper(v) * sqrt(v) + EXTERNAL_BIAS; } fn other() {}`,
    });
    // Builtins such as `sqrt` are not listed
    expect(report.files["caller.wgsl"].unresolved).toEqual(["EXTERNAL_BIAS", "externalHelper"]);
    expect(report.files["caller.wgsl"].links).toEqual([]);
  });

  it("has one entry per input file and returns every file", () => {
    expect(Object.keys(REPORT.files)).toEqual(Object.keys(SOURCES));
    expect(Object.keys(OUTPUTS)).toEqual(Object.keys(SOURCES));
  });

  it("is deterministic", () => {
    const again = obfuscateProject(SOURCES);
    expect(again.files).toEqual(OUTPUTS);
    expect([...again.report.moduleMap]).toEqual([...REPORT.moduleMap]);
    // Input order changes nothing but the order of the keys
    const reversed = obfuscateProject(Object.fromEntries(Object.entries(SOURCES).reverse()));
    for (const name of Object.keys(SOURCES)) expect(reversed.files[name]).toBe(OUTPUTS[name]);
  });
});

describe("generated names", () => {
  it("go to the most used names first, then in name order", () => {
    // Uses, counting the declaration: freqConst 4, rareConst 2, the functions 1 each
    const { report } = obfuscateProject({
      "a.wgsl": `
        const rareConst: f32 = 1.0;
        const freqConst: f32 = 2.0;
        fn beta() {} fn alpha() {}
        fn f() -> f32 { return freqConst + freqConst * freqConst + rareConst; }`,
    });
    expect([...report.moduleMap]).toEqual([
      ["freqConst", "_a"], ["rareConst", "_b"], ["alpha", "_c"], ["beta", "_d"], ["f", "_e"],
    ]);
  });

  it("start again for the locals of each function", () => {
    const out = obfuscate(`
      @compute @workgroup_size(1) fn first() { let a = 2.0; let b = a * a; }
      @compute @workgroup_size(1) fn second() { let c = 3.0; let d = c * c; }
    `);
    const [first, second] = out.split("fn").slice(1);
    const locals = (s: string) => identifiers(s).filter((n) => n.startsWith("_"));
    expect(locals(first)).toEqual(["_a", "_b", "_a", "_a"]);
    expect(locals(second)).toEqual(locals(first));
  });

  it("never equal a preserved name", () => {
    const out = obfuscate(`const K = 1.0; fn f(v: f32) -> f32 { let w = v * K; return w; } fn g() {}`, { preserve: ["_a", "_b"] });
    expect(identifiers(out)).not.toContain("_a");
    expect(identifiers(out)).not.toContain("_b");
    expect(identifiers(out)).toContain("_c");
  });
});
