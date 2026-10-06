// WGSL under another extension
const GLOW_RADIUS: f32 = 4.0;

fn glowWeight(distance: f32) -> f32 {
  return exp(-distance / GLOW_RADIUS);
}
