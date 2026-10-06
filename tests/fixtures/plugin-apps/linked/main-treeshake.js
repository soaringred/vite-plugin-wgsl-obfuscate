import noise from "./shaders/noise.wgsl?raw";
import terrain from "./shaders/terrain.wgsl?raw";
import unused from "./shaders/unused.wgsl?raw";

globalThis.shaders = { noise, terrain };
