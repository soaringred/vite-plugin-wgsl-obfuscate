// Tone mapping helpers, obfuscated with the project
const EXPOSURE: f32 = 1.2;

fn tonemap(color: vec3f) -> vec3f {
  let scaled = color * EXPOSURE;
  return scaled / (scaled + vec3f(1.0));
}

fn gammaEncode(color: vec3f) -> vec3f {
  return pow(color, vec3f(1.0 / 2.2));
}
