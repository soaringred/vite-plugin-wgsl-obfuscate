// Fetched at runtime with its ?url and linked after lib.wgsl
@group(0) @binding(0) var source: texture_2d<f32>;

@fragment
fn present(@builtin(position) coord: vec4f) -> @location(0) vec4f {
  let texel = textureLoad(source, vec2i(coord.xy), 0);
  return vec4f(tonemap(texel.rgb), 1.0);
}
