// Surface sampling built on the wave library. Uses its constants, struct,
// alias and functions without declaring them.

struct SurfacePoint {
  offset: vec3f,
  foam: f32,
}

fn surfaceAt(position: vec2f, time: f32) -> SurfacePoint {
  var point = SurfacePoint(vec3f(0.0), 0.0);
  for (var i = 0u; i < WAVE_COUNT; i++) {
    let wave = defaultWave(i);
    point.offset += gerstnerOffset(wave, position, time);
    // A local that shares its name with a library function
    let waveNumber = f32(i + 1u);
    point.foam += wave.steepness / waveNumber;
  }
  point.foam = saturate(point.foam * point.offset.y);
  return point;
}

fn surfaceHeight(position: vec2f, time: f32) -> Height {
  return surfaceAt(position, time).offset.y;
}
