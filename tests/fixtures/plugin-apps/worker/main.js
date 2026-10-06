import average from "./shaders/average.wgsl?raw";
import ImageWorker from "./worker.js?worker";

globalThis.shaders = { average };
globalThis.ImageWorker = ImageWorker;
