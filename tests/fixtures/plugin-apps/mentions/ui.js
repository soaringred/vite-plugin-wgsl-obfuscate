// UI text that happens to mention WGSL names
export function label(count, drag) {
  return "Particle count: " + count + ` (DRAG ${drag})`;
}

// `speed` and `damped` appear only as identifiers
export const speed = 3;
export function damped(value) {
  return value * speed;
}
