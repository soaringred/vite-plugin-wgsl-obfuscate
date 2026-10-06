fn oceanFoam(position: vec2f, time: f32) -> f32 {
  let point = surfaceAt(position, time);
  return point.foam;
}
