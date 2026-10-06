// Unsharp mask, run in a worker
const SHARPEN_AMOUNT: f32 = 0.6;

@group(0) @binding(0) var inputImage: texture_2d<f32>;
@group(0) @binding(1) var sharpenedImage: texture_storage_2d<rgba8unorm, write>;

fn neighbourMean(center: vec2i) -> vec4f {
  let up = textureLoad(inputImage, center + vec2i(0, -1), 0);
  let down = textureLoad(inputImage, center + vec2i(0, 1), 0);
  let left = textureLoad(inputImage, center + vec2i(-1, 0), 0);
  let right = textureLoad(inputImage, center + vec2i(1, 0), 0);
  return (up + down + left + right) * 0.25;
}

@compute @workgroup_size(8, 8)
fn sharpenMain(@builtin(global_invocation_id) id: vec3u) {
  let center = vec2i(id.xy);
  let original = textureLoad(inputImage, center, 0);
  let sharpened = original + (original - neighbourMean(center)) * SHARPEN_AMOUNT;
  textureStore(sharpenedImage, center, sharpened);
}
