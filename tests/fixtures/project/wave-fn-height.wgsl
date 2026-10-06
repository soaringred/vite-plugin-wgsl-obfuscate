fn oceanHeight(position: vec2f, time: f32, scale: f32) -> f32 {
  return surfaceHeight(position / scale, time) * scale;
}
