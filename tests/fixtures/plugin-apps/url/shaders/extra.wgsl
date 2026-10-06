// Fetched at runtime through new URL(...) and linked after lib.wgsl
@group(0) @binding(0) var source: texture_2d<f32>;

@fragment
fn presentEncoded(@builtin(position) coord: vec4f) -> @location(0) vec4f {
  let texel = textureLoad(source, vec2i(coord.xy), 0);
  return vec4f(gammaEncode(texel.rgb), 1.0);
}
