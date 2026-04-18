// Boid flocking simulation — based on webgpu-samples/computeBoids pattern
// Tests: structs, dual storage buffers, workgroup_size, math builtins

struct Particle {
    pos: vec2<f32>,
    vel: vec2<f32>,
};

struct SimParams {
    deltaT: f32,
    rule1Distance: f32,
    rule2Distance: f32,
    rule3Distance: f32,
    rule1Scale: f32,
    rule2Scale: f32,
    rule3Scale: f32,
};

@group(0) @binding(0) var<uniform> params: SimParams;
@group(0) @binding(1) var<storage, read> particlesA: array<Particle>;
@group(0) @binding(2) var<storage, read_write> particlesB: array<Particle>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let total = arrayLength(&particlesA);
    let index = gid.x;
    if (index >= total) { return; }

    var vPos = particlesA[index].pos;
    var vVel = particlesA[index].vel;

    var cMass = vec2<f32>(0.0);
    var cVel = vec2<f32>(0.0);
    var colVel = vec2<f32>(0.0);
    var cMassCount: u32 = 0u;
    var cVelCount: u32 = 0u;

    for (var i: u32 = 0u; i < total; i++) {
        if (i == index) { continue; }

        let pos = particlesA[i].pos;
        let vel = particlesA[i].vel;
        let dist = distance(pos, vPos);

        if (dist < params.rule1Distance) {
            cMass += pos;
            cMassCount++;
        }
        if (dist < params.rule2Distance) {
            colVel -= pos - vPos;
        }
        if (dist < params.rule3Distance) {
            cVel += vel;
            cVelCount++;
        }
    }

    if (cMassCount > 0u) {
        cMass = cMass / f32(cMassCount) - vPos;
    }
    if (cVelCount > 0u) {
        cVel = cVel / f32(cVelCount);
    }

    vVel += cMass * params.rule1Scale + colVel * params.rule2Scale + cVel * params.rule3Scale;

    // Clamp velocity
    vVel = normalize(vVel) * clamp(length(vVel), 0.0, 0.1);

    // Wrap around
    vPos = (vPos + vVel * params.deltaT + 1.0) % 2.0 - 1.0;

    particlesB[index] = Particle(vPos, vVel);
}
