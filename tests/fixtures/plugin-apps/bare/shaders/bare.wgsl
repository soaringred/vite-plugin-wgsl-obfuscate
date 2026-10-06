// Reaches the obfuscator as WGSL text: a plugin that runs later wraps it
struct Vertex {
  position: vec2f,
}

fn shift(vertex: Vertex, amount: f32) -> vec2f {
  let moved = sharedOffset(vertex.position) * amount;
  return moved + vec2f(SHARED_SCALE);
}
