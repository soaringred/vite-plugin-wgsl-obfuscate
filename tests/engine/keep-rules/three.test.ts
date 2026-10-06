import { describe, it, expect } from "vitest";
import WGSLNodeFunction from "three/src/renderers/webgpu/nodes/WGSLNodeFunction.js";
import { obfuscateProject } from "@/index";
import { expectValid, expectSameSpirv } from "@tests/helpers/compilers";
import { loadProject, LINK_SETS, WRAPPERS, link } from "@tests/engine/project/helpers";

// three.js `wgslFn` parses a function's source with WGSLNodeFunction: it takes
// the parameter names and types from the text, and JS passes arguments by name.

const SOURCES = loadProject();

/** Each wrapper's link set: the library files it calls into, then the wrapper. */
const WRAPPER_LINKS = WRAPPERS.map((wrapper) => {
  const names = Object.values(LINK_SETS).find((set) => set[set.length - 1] === wrapper);
  if (!names) throw new Error(`no link set ends with ${wrapper}`);
  return [wrapper, names] as const;
});

/** The wrapper as three.js reads it: its source without the leading comments. */
function parse(src: string): WGSLNodeFunction {
  return new WGSLNodeFunction(src.replace(/^(\s*\/\/[^\n]*\n)+/, ""));
}

/** Parameter names and three.js types. */
function inputsOf(fn: WGSLNodeFunction): [string, string | undefined][] {
  return fn.inputs.map((input) => [input.name, input.type]);
}

describe("three.js wgslFn wrappers", () => {
  const { files: out, report } = obfuscateProject(SOURCES);

  it("keep their parameter names and types, and rename the function", () => {
    for (const name of WRAPPERS) {
      const before = parse(SOURCES[name]);
      const after = parse(out[name]);
      expect(inputsOf(after), name).toEqual(inputsOf(before));
      expect(after.inputs.every((input) => input.type !== undefined), name).toBe(true);
      expect(after.type, name).toBe(before.type);
      expect(after.name, name).toBe(report.moduleMap.get(before.name));
    }
  });

  it("give code that links with the library once three.js rewrites the signature", async () => {
    for (const [name, names] of WRAPPER_LINKS) {
      const code = new WGSLNodeFunction(out[name]).getCode("threeNodeFn");
      await expectValid(`${link(out, names.slice(0, -1))}\n${code}`, `${name} linked with the library`);
    }
  });

  it("lose the leading comment that three.js cannot read", () => {
    const withComment = SOURCES["wave-fn-tint.wgsl"];
    expect(withComment.trimStart().startsWith("//")).toBe(true);
    expect(() => new WGSLNodeFunction(withComment)).toThrow();
    expect(() => new WGSLNodeFunction(out["wave-fn-tint.wgsl"])).not.toThrow();
  });
});

describe('three.js wgslFn wrappers with wgslFnParams: "rename"', () => {
  const { files: out, report } = obfuscateProject(SOURCES, { wgslFnParams: "rename" });

  it("rename the parameters, keep their types, and still link", async () => {
    for (const [name, names] of WRAPPER_LINKS) {
      const before = parse(SOURCES[name]);
      const after = parse(out[name]);
      expect(after.inputs.map((i) => i.type), name).toEqual(before.inputs.map((i) => i.type));
      for (const [i, input] of after.inputs.entries()) {
        expect(input.name).not.toBe(before.inputs[i].name);
        expect(input.name).toMatch(/^_[a-z]+$/);
      }
      expect(after.name, name).toBe(report.moduleMap.get(before.name));
      await expectValid(link(out, names));
      expectSameSpirv(link(SOURCES, names), link(out, names));
    }
  });
});
