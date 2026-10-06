// Value noise library, shared by the passes that include it
const NOISE_SCALE: f32 = 0.25;

struct Sample {
  value: f32,
  gradient: vec2f,
}

fn hashCell(cell: vec2i) -> f32 {
  let h = (u32(cell.x) * 73856093u) ^ (u32(cell.y) * 19349663u);
  return f32(h % 1024u) / 1024.0;
}

fn sampleNoise(position: vec2f) -> Sample {
  let scaled = position * NOISE_SCALE;
  let cell = vec2i(floor(scaled));
  let blend = fract(scaled);
  let left = hashCell(cell);
  let right = hashCell(cell + vec2i(1, 0));
  var result: Sample;
  result.value = mix(left, right, blend.x);
  result.gradient = vec2f(right - left, 0.0);
  return result;
}
