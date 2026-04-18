import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { obfuscate } from "@/obfuscate";
import { RESERVED, BUILTINS } from "@/wgsl-grammar";

const FIXTURES_DIR = join(__dirname, "fixtures");

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), "utf-8");
}

/** Check that no WGSL reserved word or builtin was used as a rename target */
function assertNoReservedRenames(output: string) {
  // Extract all _prefixed identifiers (our rename format)
  const renamed = output.match(/\b_[a-z]+\b/g) ?? [];
  for (const name of renamed) {
    expect(RESERVED.has(name), `renamed to reserved word: ${name}`).toBe(false);
    expect(BUILTINS.has(name), `renamed to builtin: ${name}`).toBe(false);
  }
}

/** Check that specific strings are absent from the output */
function assertAbsent(output: string, ...terms: string[]) {
  for (const term of terms) {
    expect(output.includes(term), `"${term}" should be absent`).toBe(false);
  }
}

/** Check that specific strings are present in the output */
function assertPresent(output: string, ...terms: string[]) {
  for (const term of terms) {
    expect(output.includes(term), `"${term}" should be present`).toBe(true);
  }
}

describe("fixture: compute-basic.wgsl", () => {
  const src = loadFixture("compute-basic.wgsl");
  const out = obfuscate(src);

  it("produces non-empty output", () => {
    expect(out.length).toBeGreaterThan(0);
  });

  it("preserves entry point name", () => {
    assertPresent(out, "simulate");
  });

  it("strips comments", () => {
    assertAbsent(out, "// Basic compute", "tests const inlining");
  });

  it("removes user-defined names", () => {
    assertAbsent(out, "computeForce", "GRID_SIZE", "SCALE", "HALF");
  });

  it("preserves WGSL keywords", () => {
    assertPresent(out, "fn", "var", "let", "if", "for", "return", "struct");
  });

  it("preserves builtins", () => {
    assertPresent(out, "length", "normalize", "vec3", "vec4");
  });

  it("preserves attributes", () => {
    assertPresent(out, "@compute", "@workgroup_size", "@group", "@binding");
  });

  it("does not produce reserved-word renames", () => {
    assertNoReservedRenames(out);
  });

  it("inlines const declarations", () => {
    assertAbsent(out, "const ");
  });

  it("is smaller than the original", () => {
    expect(out.length).toBeLessThan(src.length);
  });
});

describe("fixture: vertex-fragment.wgsl", () => {
  const src = loadFixture("vertex-fragment.wgsl");
  const out = obfuscate(src);

  it("preserves both entry points", () => {
    assertPresent(out, "vertMain", "fragMain");
  });

  it("preserves predeclared type aliases", () => {
    assertPresent(out, "vec4f", "vec3f", "vec2f", "mat4x4f");
  });

  it("preserves texture and sampler types", () => {
    assertPresent(out, "texture_2d", "sampler");
  });

  it("preserves builtin functions", () => {
    assertPresent(out, "normalize", "max", "dot", "textureSample");
  });

  it("preserves @builtin values", () => {
    assertPresent(out, "position");
  });

  it("preserves @location attributes", () => {
    assertPresent(out, "@location");
  });

  it("removes user-defined names", () => {
    assertAbsent(out, "Camera", "VertexInput", "VertexOutput", "lightDir", "albedo");
  });

  it("does not rename swizzle access", () => {
    // .rgb and .a are used in the fragment shader
    assertPresent(out, ".rgb", ".a");
  });

  it("does not produce reserved-word renames", () => {
    assertNoReservedRenames(out);
  });
});

describe("fixture: atomics-workgroup.wgsl", () => {
  const src = loadFixture("atomics-workgroup.wgsl");
  const out = obfuscate(src);

  it("preserves entry point name", () => {
    assertPresent(out, "reduce");
  });

  it("preserves atomic builtins", () => {
    assertPresent(out, "atomicMax", "atomicAdd");
  });

  it("preserves workgroupBarrier", () => {
    assertPresent(out, "workgroupBarrier");
  });

  it("handles nested block comments", () => {
    assertAbsent(out, "Outer comment", "nested comment", "still outer");
  });

  it("inlines chained consts", () => {
    assertAbsent(out, "WG_SIZE", "GRID_TOTAL");
  });

  it("preserves atomic type", () => {
    assertPresent(out, "atomic");
  });

  it("preserves address space keywords", () => {
    assertPresent(out, "workgroup", "storage", "uniform");
  });

  it("preserves access modes", () => {
    assertPresent(out, "read", "read_write");
  });

  it("removes user-defined names", () => {
    assertAbsent(out, "localMax", "globalMax", "quantized", "threshold");
  });

  it("does not produce reserved-word renames", () => {
    assertNoReservedRenames(out);
  });
});

describe("fixture: boids-compute.wgsl", () => {
  const src = loadFixture("boids-compute.wgsl");
  const out = obfuscate(src);

  it("preserves entry point", () => {
    assertPresent(out, "main");
  });

  it("preserves builtins", () => {
    assertPresent(out, "arrayLength", "distance", "normalize", "clamp", "length");
  });

  it("removes user-defined names", () => {
    assertAbsent(out, "Particle", "SimParams", "particlesA", "particlesB", "cMass", "colVel");
  });

  it("preserves struct and var keywords", () => {
    assertPresent(out, "struct", "var", "let", "fn");
  });

  it("does not produce reserved-word renames", () => {
    assertNoReservedRenames(out);
  });
});

describe("fixture: shadow-mapping.wgsl", () => {
  const src = loadFixture("shadow-mapping.wgsl");
  const out = obfuscate(src);

  it("preserves all three entry points", () => {
    assertPresent(out, "vertShadow", "vertMain", "fragMain");
  });

  it("preserves depth texture and comparison sampler types", () => {
    assertPresent(out, "texture_depth_2d", "sampler_comparison");
  });

  it("preserves textureSampleCompare builtin", () => {
    assertPresent(out, "textureSampleCompare");
  });

  it("preserves predeclared type aliases", () => {
    assertPresent(out, "vec4f", "vec3f", "mat4x4f");
  });

  it("preserves swizzle access", () => {
    assertPresent(out, ".xyz", ".xy");
  });

  it("removes user-defined names", () => {
    assertAbsent(out, "Scene", "Model", "ShadowOutput", "FragInput", "shadowMap", "SHADOW_BIAS");
  });

  it("inlines const declarations", () => {
    assertAbsent(out, "AMBIENT", "SHADOW_BIAS");
  });

  it("does not produce reserved-word renames", () => {
    assertNoReservedRenames(out);
  });
});

describe("fixture: image-blur.wgsl", () => {
  const src = loadFixture("image-blur.wgsl");
  const out = obfuscate(src);

  it("preserves both entry points", () => {
    assertPresent(out, "blurHorizontal", "blurVertical");
  });

  it("preserves texture types", () => {
    assertPresent(out, "texture_2d", "texture_storage_2d");
  });

  it("preserves texel format", () => {
    assertPresent(out, "rgba8unorm");
  });

  it("preserves texture builtins", () => {
    assertPresent(out, "textureDimensions", "textureSampleLevel", "textureStore");
  });

  it("preserves override keyword", () => {
    assertPresent(out, "override");
  });

  it("preserves sampler type", () => {
    assertPresent(out, "sampler");
  });

  it("preserves write access mode", () => {
    assertPresent(out, "write");
  });

  it("removes user-defined names", () => {
    assertAbsent(out, "WEIGHTS", "inputTex", "outputTex", "filterDim", "blockDim");
  });

  it("does not produce reserved-word renames", () => {
    assertNoReservedRenames(out);
  });
});
