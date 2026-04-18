// Vertex + fragment shader — tests multiple entry points, swizzle, struct members

struct VertexInput {
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
    @location(2) uv: vec2f,
};

struct VertexOutput {
    @builtin(position) clipPos: vec4f,
    @location(0) worldNormal: vec3f,
    @location(1) texCoord: vec2f,
};

struct Camera {
    viewProj: mat4x4f,
    eyePos: vec3f,
};

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var diffuseTexture: texture_2d<f32>;
@group(0) @binding(2) var texSampler: sampler;

@vertex
fn vertMain(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.clipPos = camera.viewProj * vec4f(input.position, 1.0);
    out.worldNormal = input.normal;
    out.texCoord = input.uv;
    return out;
}

@fragment
fn fragMain(input: VertexOutput) -> @location(0) vec4f {
    let lightDir = normalize(vec3f(0.5, 1.0, 0.3));
    let ndotl = max(dot(input.worldNormal, lightDir), 0.0);
    let albedo = textureSample(diffuseTexture, texSampler, input.texCoord);
    let ambient = 0.15;
    return vec4f(albedo.rgb * (ndotl + ambient), albedo.a);
}
