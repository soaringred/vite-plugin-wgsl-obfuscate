// Image blur compute shader — gaussian blur with texture sampling
// Tests: texture_2d, texture_storage_2d, textureDimensions, clamp, override

override KERNEL_SIZE: u32 = 5;

struct Params {
    filterDim: u32,
    blockDim: u32,
};

@group(0) @binding(0) var inputTex: texture_2d<f32>;
@group(0) @binding(1) var outputTex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params: Params;
@group(0) @binding(3) var samp: sampler;

const WEIGHTS: array<f32, 5> = array<f32, 5>(
    0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216
);

@compute @workgroup_size(8, 8)
fn blurHorizontal(@builtin(global_invocation_id) gid: vec3<u32>) {
    let dims = textureDimensions(inputTex);
    if (gid.x >= dims.x || gid.y >= dims.y) { return; }

    let texCoord = vec2f(f32(gid.x) + 0.5, f32(gid.y) + 0.5) / vec2f(dims);

    var color = textureSampleLevel(inputTex, samp, texCoord, 0.0) * WEIGHTS[0];

    for (var i: u32 = 1u; i < KERNEL_SIZE; i++) {
        let offset = vec2f(f32(i) / f32(dims.x), 0.0);
        color += textureSampleLevel(inputTex, samp, texCoord + offset, 0.0) * WEIGHTS[i];
        color += textureSampleLevel(inputTex, samp, texCoord - offset, 0.0) * WEIGHTS[i];
    }

    textureStore(outputTex, vec2u(gid.xy), color);
}

@compute @workgroup_size(8, 8)
fn blurVertical(@builtin(global_invocation_id) gid: vec3<u32>) {
    let dims = textureDimensions(inputTex);
    if (gid.x >= dims.x || gid.y >= dims.y) { return; }

    let texCoord = vec2f(f32(gid.x) + 0.5, f32(gid.y) + 0.5) / vec2f(dims);

    var color = textureSampleLevel(inputTex, samp, texCoord, 0.0) * WEIGHTS[0];

    for (var i: u32 = 1u; i < KERNEL_SIZE; i++) {
        let offset = vec2f(0.0, f32(i) / f32(dims.y));
        color += textureSampleLevel(inputTex, samp, texCoord + offset, 0.0) * WEIGHTS[i];
        color += textureSampleLevel(inputTex, samp, texCoord - offset, 0.0) * WEIGHTS[i];
    }

    textureStore(outputTex, vec2u(gid.xy), color);
}
