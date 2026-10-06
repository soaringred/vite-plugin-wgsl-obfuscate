// Particle integrator
const DRAG: f32 = 0.98;

struct Particle {
  place: vec3f,
  speed: vec3f,
}

@group(0) @binding(0) var<storage, read_write> swarm: array<Particle>;

fn damped(speed: vec3f) -> vec3f {
  return speed * DRAG;
}

@compute @workgroup_size(64)
fn integrate(@builtin(global_invocation_id) gid: vec3u) {
  let index = gid.x;
  swarm[index].speed = damped(swarm[index].speed);
  swarm[index].place += swarm[index].speed * 0.016;
}
