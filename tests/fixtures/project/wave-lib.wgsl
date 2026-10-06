// Wave library: constants, types and helpers shared by the other files.
// Synthetic shader for the project tests.

const WAVE_COUNT: u32 = 4u;
const GRAVITY: f32 = 9.81;
const TAU: f32 = 6.2831853;
const WATER_CLARITY: f32 = 0.35;

struct Wave {
  direction: vec2f,
  steepness: f32,
  wavelength: f32,
}

alias Height = f32;

fn waveNumber(wavelength: f32) -> f32 {
  return TAU / wavelength;
}

fn gerstnerOffset(wave: Wave, position: vec2f, time: f32) -> vec3f {
  let k = waveNumber(wave.wavelength);
  let speed = sqrt(GRAVITY / k);
  let dir = normalize(wave.direction);
  let phase = k * (dot(dir, position) - speed * time);
  let amplitude = wave.steepness / k;
  return vec3f(
    dir.x * amplitude * cos(phase),
    amplitude * sin(phase),
    dir.y * amplitude * cos(phase),
  );
}

fn defaultWave(index: u32) -> Wave {
  let angle = f32(index) * 0.7;
  return Wave(vec2f(cos(angle), sin(angle)), 0.25, 8.0 + f32(index) * 3.0);
}
