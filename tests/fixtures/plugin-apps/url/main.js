import lib from "./shaders/lib.wgsl?raw";
import postUrl from "./shaders/post.wgsl?url";

globalThis.shaders = { lib };
globalThis.postUrl = postUrl;
