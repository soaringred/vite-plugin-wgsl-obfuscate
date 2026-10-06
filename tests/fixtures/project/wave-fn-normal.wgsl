fn oceanNormal(position: vec2f, time: f32, epsilon: f32) -> vec3f {
  let center = surfaceHeight(position, time);
  let dx = surfaceHeight(position + vec2f(epsilon, 0.0), time) - center;
  let dz = surfaceHeight(position + vec2f(0.0, epsilon), time) - center;
  return normalize(vec3f(-dx, epsilon, -dz));
}
