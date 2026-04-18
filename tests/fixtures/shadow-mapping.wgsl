// Shadow mapping shader — typical rendering pattern
// Tests: multiple structs, depth textures, comparison samplers, matrix math

struct Scene {
    lightViewProj: mat4x4f,
    cameraViewProj: mat4x4f,
    lightPos: vec3f,
};

struct Model {
    modelMatrix: mat4x4f,
    normalMatrix: mat4x4f,
};

struct VertexInput {
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
};

struct ShadowOutput {
    @builtin(position) position: vec4f,
};

struct FragInput {
    @builtin(position) fragPos: vec4f,
    @location(0) shadowPos: vec3f,
    @location(1) worldNormal: vec3f,
    @location(2) worldPos: vec3f,
};

@group(0) @binding(0) var<uniform> scene: Scene;
@group(0) @binding(1) var<uniform> model: Model;
@group(0) @binding(2) var shadowMap: texture_depth_2d;
@group(0) @binding(3) var shadowSampler: sampler_comparison;

const AMBIENT: f32 = 0.15;
const SHADOW_BIAS: f32 = 0.005;

@vertex
fn vertShadow(input: VertexInput) -> ShadowOutput {
    let worldPos = model.modelMatrix * vec4f(input.position, 1.0);
    var out: ShadowOutput;
    out.position = scene.lightViewProj * worldPos;
    return out;
}

@vertex
fn vertMain(input: VertexInput) -> FragInput {
    let worldPos = model.modelMatrix * vec4f(input.position, 1.0);
    let lightClip = scene.lightViewProj * worldPos;
    let lightNdc = lightClip.xyz / lightClip.w;

    var out: FragInput;
    out.fragPos = scene.cameraViewProj * worldPos;
    out.shadowPos = vec3f(
        lightNdc.x * 0.5 + 0.5,
        lightNdc.y * -0.5 + 0.5,
        lightNdc.z,
    );
    out.worldNormal = (model.normalMatrix * vec4f(input.normal, 0.0)).xyz;
    out.worldPos = worldPos.xyz;
    return out;
}

@fragment
fn fragMain(input: FragInput) -> @location(0) vec4f {
    let normal = normalize(input.worldNormal);
    let lightDir = normalize(scene.lightPos - input.worldPos);
    let ndotl = max(dot(normal, lightDir), 0.0);

    let shadowDepth = input.shadowPos.z - SHADOW_BIAS;
    let visibility = textureSampleCompare(
        shadowMap, shadowSampler,
        input.shadowPos.xy, shadowDepth,
    );

    let lighting = AMBIENT + (1.0 - AMBIENT) * ndotl * visibility;
    return vec4f(vec3f(lighting), 1.0);
}
