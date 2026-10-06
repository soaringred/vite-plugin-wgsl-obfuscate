import noise from "./shaders/noise.wgsl?raw";

globalThis.shaders = { noise };
globalThis.loadTerrain = () => import("./lazy.js");
