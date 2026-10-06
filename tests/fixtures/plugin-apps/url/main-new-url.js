import lib from "./shaders/lib.wgsl?raw";

globalThis.shaders = { lib };
globalThis.extraUrl = new URL("./shaders/extra.wgsl", import.meta.url).href;
