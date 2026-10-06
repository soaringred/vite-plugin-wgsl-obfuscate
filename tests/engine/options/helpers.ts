// A library and a pass that link, shared by the prefix and strict tests.

export const LIB = `
  struct Glow { strength: f32, radius: f32 }
  const PI: f32 = 3.14159265;
  fn glowAt(g: Glow, d: f32) -> f32 { return g.strength * exp(-d / g.radius) * PI; }
`;

export const PASS = `
  @group(0) @binding(0) var<uniform> glow: Glow;
  @group(0) @binding(1) var<storage, read_write> result: array<f32>;
  @compute @workgroup_size(1) fn main(@builtin(global_invocation_id) id: vec3u) {
    let strength = f32(id.x);
    result[id.x] = glowAt(glow, strength) + glow.radius;
  }
`;

export const FILES = { "lib.wgsl": LIB, "pass.wgsl": PASS };
