import particles from "./shaders/particles.wgsl?raw";
import { label, damped } from "./ui.js";

globalThis.shaders = { particles };
globalThis.label = label(10, damped(2));
