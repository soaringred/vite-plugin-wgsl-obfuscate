// Water colour from depth and foam. three.js rejects a source that starts
// with a comment; the obfuscated output has none.
fn oceanTint(deep: vec3f, shallow: vec3f, depth: f32, foam: f32) -> vec3f {
  let t = exp(-depth * WATER_CLARITY);
  return mix(mix(deep, shallow, t), vec3f(1.0), foam);
}
