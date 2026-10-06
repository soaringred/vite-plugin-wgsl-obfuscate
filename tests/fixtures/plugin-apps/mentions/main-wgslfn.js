import particles from "./shaders/particles.wgsl?raw";
import { wgslFn } from "./tsl.js";

// WGSL handed to a shader call, using a name that particles.wgsl declares
globalThis.drag = wgslFn("fn externalDrag() -> f32 { return DRAG; }");
globalThis.shaders = { particles };
