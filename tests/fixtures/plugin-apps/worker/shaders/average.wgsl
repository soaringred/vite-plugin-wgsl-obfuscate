// Box average, run on the main thread
const KERNEL_RADIUS: i32 = 2;

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var averagedTexture: texture_storage_2d<rgba8unorm, write>;

fn averageAround(center: vec2i) -> vec4f {
  var total = vec4f(0.0);
  for (var dy = -KERNEL_RADIUS; dy <= KERNEL_RADIUS; dy++) {
    for (var dx = -KERNEL_RADIUS; dx <= KERNEL_RADIUS; dx++) {
      total += textureLoad(sourceTexture, center + vec2i(dx, dy), 0);
    }
  }
  let count = f32((2 * KERNEL_RADIUS + 1) * (2 * KERNEL_RADIUS + 1));
  return total / count;
}

@compute @workgroup_size(8, 8)
fn averageMain(@builtin(global_invocation_id) id: vec3u) {
  textureStore(averagedTexture, vec2i(id.xy), averageAround(vec2i(id.xy)));
}
