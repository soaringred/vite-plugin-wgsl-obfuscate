// Declares names that bare.wgsl uses
const SHARED_SCALE: f32 = 2.0;

fn sharedOffset(v: vec2f) -> vec2f {
  return v * SHARED_SCALE;
}

fn privateHelper(v: f32) -> f32 {
  return v + 1.0;
}
