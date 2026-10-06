// Compute pass that bakes a height field from the surface. JS selects the
// entry point by name and sets `gridSize` through pipeline constants.

@group(0) @binding(0) var<storage, read_write> heights: array<f32>;
override gridSize: u32 = 64u;
@id(3) override bakeTime: f32 = 0.0;

@compute @workgroup_size(8, 8)
fn bakeHeights(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= gridSize || id.y >= gridSize) { return; }
  let position = vec2f(id.xy) * 0.5;
  heights[id.x + id.y * gridSize] = surfaceHeight(position, bakeTime);
}
