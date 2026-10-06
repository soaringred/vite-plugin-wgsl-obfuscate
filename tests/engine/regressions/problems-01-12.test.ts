import { describe, it, expect } from "vitest";
import { obfuscate } from "@/index";
import { expectComputePipeline } from "@tests/helpers/compilers";
import { expectSafeRename } from "@tests/helpers/differential";
import { members, nonMembers } from "@tests/helpers/wgsl";
import { link, expectProjectLinks, expectSameOnBoth, wgslFnInputs } from "@tests/engine/regressions/helpers";

// Problems 1-12, found in 0.1.x. Problem 7 (WGSL in JS strings) is the plugin's
// reference scan, in tests/vite; problem 12 (broken output shipped), every compiler check.

// Problem 1: names a file used but did not declare were renamed, breaking the link
const P1_FILES = {
  "terrain-lib.wgsl": `
    const SEA_LEVEL: f32 = 0.35;
    alias Height = f32;
    fn ridge(h: Height) -> Height { return 1.0 - abs(h * 2.0 - 1.0); }
  `,
  "terrain-main.wgsl": `
    @group(0) @binding(0) var<storage, read_write> heights: array<f32>;
    @compute @workgroup_size(64)
    fn carveTerrain(@builtin(global_invocation_id) gid: vec3u) {
      let raw: Height = heights[gid.x];
      heights[gid.x] = max(ridge(raw), SEA_LEVEL);
    }
  `,
};

// Problem 2: const inlining deleted module-scope consts that another file used
const P2_FILES = {
  "orbit-consts.wgsl": `
    const ORBIT_INNER: f32 = 1.5;
    const ORBIT_OUTER: f32 = 4.0;
    const ORBIT_STEPS: u32 = 16u;
  `,
  "orbit-sampler.wgsl": `
    @group(0) @binding(0) var<storage, read_write> radii: array<f32>;
    @compute @workgroup_size(1)
    fn sampleOrbits() {
      for (var i = 0u; i < ORBIT_STEPS; i++) {
        radii[i] = mix(ORBIT_INNER, ORBIT_OUTER, f32(i) / f32(ORBIT_STEPS));
      }
    }
  `,
};

// Problem 3: functions were renamed per file, so callers in other files broke
const P3_FILES = {
  "clouds.wgsl": `
    @group(0) @binding(0) var<storage, read_write> cloudCover: array<f32>;
    @compute @workgroup_size(8, 8)
    fn buildClouds(@builtin(global_invocation_id) gid: vec3u) {
      let p = vec2f(gid.xy) * 0.1;
      cloudCover[gid.x + gid.y * 64u] = cellNoise(p) * 0.5 + cellNoise(p * 2.0) * 0.25;
    }
  `,
  // Declared after its caller: link order must not matter
  "noise.wgsl": `
    fn hashCell(cell: vec2f) -> f32 {
      return fract(sin(dot(cell, vec2f(12.9898, 78.233))) * 43758.5453);
    }
    fn cellNoise(p: vec2f) -> f32 {
      let base = floor(p);
      let t = fract(p);
      return mix(hashCell(base), hashCell(base + vec2f(1.0, 0.0)), t.x);
    }
  `,
};

// Problem 4: inlining `const LANES: u32 = 32` dropped its type, making `limit` an i32
const P4 = `
  const LANES: u32 = 32;
  @group(0) @binding(0) var<storage, read_write> hits: array<u32, 64>;
  @compute @workgroup_size(64)
  fn gatherLanes(@builtin(local_invocation_index) lane: u32) {
    let limit = LANES;
    if (lane < limit) { hits[lane] = 1u; }
  }
`;

// Problem 5: override names were renamed, so JS could no longer set them by name
const P5 = `
  override fogStart: f32 = 10.0;
  @id(7) override fogDensity: f32 = 0.5;
  @group(0) @binding(0) var<storage, read_write> fogged: array<f32>;
  @compute @workgroup_size(1)
  fn applyFog() { fogged[0] = max(fogged[0] - fogStart, 0.0) * fogDensity; }
`;

// Problem 6: struct fields were renamed per file, so an access in another file broke
const P6_FILES = {
  "haze-types.wgsl": `
    struct HazeSettings {
      thickness: f32,
      horizonBoost: f32,
      hue: vec3f,
    }
    fn hazeAmount(settings: HazeSettings, depth: f32) -> f32 {
      return 1.0 - exp(-settings.thickness * depth) * settings.horizonBoost;
    }
  `,
  "haze-pass.wgsl": `
    @group(0) @binding(0) var<uniform> haze: HazeSettings;
    @fragment
    fn applyHaze(@location(0) depth: f32) -> @location(0) vec4f {
      return vec4f(haze.hue * hazeAmount(haze, depth), haze.thickness);
    }
  `,
};

// Problem 8: the parameters of a three.js `wgslFn` body were renamed, and JS passes arguments by name
const P8_WRAPPER = `fn glowTerm(emissive: vec3f, threshold: f32, strength: f32) -> vec3f {
  let lum = dot(emissive, vec3f(0.3, 0.6, 0.1));
  return emissive * softKnee(max(lum - threshold, 0.0), GLOW_KNEE) * strength;
}
`;

const P8_FILES = {
  "glow-lib.wgsl": `
    const GLOW_KNEE: f32 = 0.5;
    fn softKnee(x: f32, knee: f32) -> f32 { return x * x / (x + knee); }
  `,
  "glow-fn.wgsl": P8_WRAPPER,
};

// Problem 9: generated names could equal a name already in the source, here the entry point `_a`
const P9 = `
  fn blend(lo: f32, hi: f32) -> f32 { return mix(lo, hi, 0.5); }
  @compute @workgroup_size(1)
  fn _a() { let mixed = blend(1.0, 2.0); }
`;

// Problem 10: renaming was by name, so a local `falloff` renamed the call to another file's `falloff()`
const P10 = `
  fn attenuate(d: f32) -> f32 {
    let falloff = 1.0 / (1.0 + d * d);
    return falloff;
  }
  fn shade(d: f32) -> f32 { return falloff(d) * attenuate(d); }
`;
const P10_OTHER_FILE = `fn falloff(d: f32) -> f32 { return exp(-d); }`;

// Problem 11: names that look like swizzles (`rg`, `a`, `xy`) were never renamed.
// The first item is not a function, so no parameter is kept as a wgslFn input.
const P11 = `
  const rg: f32 = 0.5;
  fn tintColor(rgb: vec3f, a: f32) -> vec4f {
    let xy = rgb.xy * a;
    return vec4f(rgb * a, xy.x);
  }
  fn xyz(rgb: vec3f) -> vec4f { return tintColor(rgb, rg); }
`;

describe("regressions: problems 1-12", () => {
  it("problem 1: names a file uses but another file declares still resolve", async () => {
    await expectProjectLinks(P1_FILES);
  });

  it("problem 2: module-scope consts used by another file are kept", async () => {
    await expectProjectLinks(P2_FILES);
  });

  it("problem 3: functions called from another file keep one name everywhere", async () => {
    await expectProjectLinks(P3_FILES);
  });

  it("problem 4: a const keeps its declared type", async () => {
    await expectSafeRename(P4);
  });

  it("problem 5: overrides without @id keep their names; those with @id are renamed", async () => {
    // JS selects the entry point and sets overrides by name, or by @id
    await expectComputePipeline(P5, "applyFog", { fogStart: 4, 7: 0.25 });
    const out = await expectSafeRename(P5);
    expect(nonMembers(out)).toContain("fogStart");
    expect(nonMembers(out)).not.toContain("fogDensity");
    await expectComputePipeline(out, "applyFog", { fogStart: 4, 7: 0.25 });
  });

  it("problem 6: struct fields keep one name across files", async () => {
    await expectProjectLinks(P6_FILES);
  });

  it("problem 8: parameter names of a wgslFn wrapper stay as written", async () => {
    const out = await expectProjectLinks(P8_FILES);
    const inputs = wgslFnInputs(out["glow-fn.wgsl"]);
    expect(inputs).toEqual(wgslFnInputs(P8_WRAPPER));
    expect(inputs.every(([, type]) => type !== undefined)).toBe(true);
  });

  it("problem 9: generated names never collide with names in the source", async () => {
    await expectSafeRename(P9);
  });

  it("problem 10: a local that shares a name with another file's function", async () => {
    await expectSameOnBoth(link(P10, P10_OTHER_FILE), link(obfuscate(P10), P10_OTHER_FILE));
  });

  it("problem 11: locals, parameters and module-scope names that look like swizzles are renamed", async () => {
    const out = await expectSafeRename(P11);
    for (const name of ["rg", "rgb", "a", "xy", "xyz"]) expect(nonMembers(out)).not.toContain(name);
    // Swizzles are member accesses and stay as written
    expect(members(out)).toEqual(members(P11));
  });
});
