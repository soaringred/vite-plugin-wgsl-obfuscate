import noise from "./shaders/noise.wgsl?raw";
import terrain from "./shaders/terrain.wgsl?raw";

export const linked = noise + "\n" + terrain;
