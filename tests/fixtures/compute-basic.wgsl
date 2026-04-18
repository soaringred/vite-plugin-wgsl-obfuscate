// Basic compute shader — tests const inlining, entry point detection, numeric splitting

const GRID_SIZE: u32 = 256u;
const HALF: f32 = 0.5;
const SCALE: f32 = HALF * 2.0;

struct Params {
    count: u32,
    dt: f32,
};

@group(0) @binding(0) var<storage, read> input: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> output: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> params: Params;

fn computeForce(pos: vec3<f32>, target: vec3<f32>) -> vec3<f32> {
    let diff = target - pos;
    let dist = length(diff);
    if (dist < 0.001) { return vec3<f32>(0.0); }
    return normalize(diff) / (dist * dist);
}

@compute @workgroup_size(64)
fn simulate(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if (idx >= params.count) { return; }

    let pos = input[idx].xyz;
    var force = vec3<f32>(0.0);

    for (var i: u32 = 0u; i < params.count; i++) {
        if (i == idx) { continue; }
        force += computeForce(pos, input[i].xyz);
    }

    let velocity = force * params.dt * SCALE;
    output[idx] = vec4<f32>(pos + velocity, 1.0);
}
