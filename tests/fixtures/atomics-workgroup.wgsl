// Atomic + workgroup shader — tests atomic builtins, workgroup vars, nested comments

const WG_SIZE: u32 = 64u;
const GRID_TOTAL: u32 = 128u * 128u * 128u;

/* Outer comment /* nested comment */ still outer */

@group(0) @binding(0) var<storage, read> values: array<f32>;
@group(0) @binding(1) var<storage, read_write> result: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> globalMax: atomic<u32>;

struct Uniforms {
    count: u32,
    threshold: f32,
};
@group(0) @binding(3) var<uniform> uniforms: Uniforms;

var<workgroup> localMax: array<u32, WG_SIZE>;

@compute @workgroup_size(WG_SIZE)
fn reduce(
    @builtin(global_invocation_id) gid: vec3<u32>,
    @builtin(local_invocation_index) lid: u32,
) {
    let inBounds = gid.x < uniforms.count;
    var val: f32 = 0.0;
    if (inBounds) {
        val = values[gid.x];
    }

    let quantized = u32(clamp(val, 0.0, 1.0) * 65535.0);
    localMax[lid] = quantized;
    workgroupBarrier();

    // Parallel reduction
    var stride: u32 = WG_SIZE / 2u;
    loop {
        if (stride == 0u) { break; }
        if (lid < stride) {
            localMax[lid] = max(localMax[lid], localMax[lid + stride]);
        }
        workgroupBarrier();
        stride = stride / 2u;
    }

    if (lid == 0u) {
        atomicMax(&globalMax, localMax[0]);
    }

    if (inBounds && val > uniforms.threshold) {
        atomicAdd(&result[gid.x], 1u);
    }
}
