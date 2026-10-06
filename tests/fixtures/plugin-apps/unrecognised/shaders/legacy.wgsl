fn legacyLight(distance: f32) -> f32 {
  return attenuate(distance) * FALLOFF;
}
