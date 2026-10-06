/* Terrain height pass. Uses the noise library: it declares none of
   NOISE_SCALE, Sample or sampleNoise itself. */
struct Params {
  size: u32,
  amplitude: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> heights: array<f32>;

fn heightAt(x: u32, y: u32) -> f32 {
  let sample: Sample = sampleNoise(vec2f(f32(x), f32(y)));
  return sample.value * params.amplitude + length(sample.gradient) * NOISE_SCALE;
}

@compute @workgroup_size(8, 8)
fn buildTerrain(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= params.size || id.y >= params.size) {
    return;
  }
  heights[id.y * params.size + id.x] = heightAt(id.x, id.y);
}
