// Declares names that legacy.wgsl uses
const FALLOFF: f32 = 0.5;

fn attenuate(distance: f32) -> f32 {
  return 1.0 / (1.0 + distance * FALLOFF);
}

fn coreOnly(v: f32) -> f32 {
  return v * 2.0;
}
