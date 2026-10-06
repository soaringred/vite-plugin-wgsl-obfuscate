// three.js ships no types for its source tree. The tests only use the parser
// that `wgslFn` runs on a function's source.
declare module "three/src/renderers/webgpu/nodes/WGSLNodeFunction.js" {
  export default class WGSLNodeFunction {
    constructor(source: string);
    /** Function name, taken from the source. */
    name: string;
    /** three.js type of the return value. */
    type: string;
    /** Parameters in source order. `type` is undefined for struct and alias types. */
    inputs: { name: string; type: string | undefined }[];
    getCode(name?: string): string;
  }
}
