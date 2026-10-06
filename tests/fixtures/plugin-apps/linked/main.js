import noise from "./shaders/noise.wgsl?raw";
import terrain from "./shaders/terrain.wgsl?raw";

// JS identifiers that share names with WGSL declarations. They are never in
// a string, so the WGSL names are still renamed.
const sampleNoise = (x) => x * 2;
const heightAt = { NOISE_SCALE: 1.5 };

globalThis.shaders = { noise, terrain };
// JS selects the entry point by name
globalThis.entryPoint = "buildTerrain";
globalThis.scale = sampleNoise(heightAt.NOISE_SCALE);
globalThis.marker = "AFTER_THE_SHADERS";
