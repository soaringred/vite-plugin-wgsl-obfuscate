import { describe, it, expect } from "vitest";
import { tokenize } from "@/wgsl/tokenizer";
import { resolve } from "@/analysis/resolver";
import { buildProject } from "@/engine/project";
import type { ProjectSettings } from "@/engine/project";
import {
  VerifyError,
  checkTokenShape,
  checkBindingShape,
  checkProjectConsistency,
  verifyBuild,
  scanModuleDeclarations,
} from "@/engine/verify";
import { VerifyError as ExportedVerifyError } from "@/index";

// Self-checks, fed deliberately wrong outputs.

const SETTINGS: ProjectSettings = {
  preserve: new Set(),
  renameIdents: true,
  collapseWhitespace: true,
  topLevel: "rename",
  wgslFnParams: "keep",
  prefix: "_",
};

const analyse = (src: string) => resolve(tokenize(src));
const NO_MAP = new Map<string, string>();

/** The VerifyError that `fn` throws. */
function verifyError(fn: () => void): VerifyError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(VerifyError);
    return error as VerifyError;
  }
  throw new Error("expected a VerifyError");
}

describe("VerifyError", () => {
  it("is exported and names the file, position and reason", () => {
    expect(ExportedVerifyError).toBe(VerifyError);
    const error = verifyError(() => checkTokenShape("shader.wgsl", analyse("let x = 1.0;"), "letx=1.0;"));
    expect(error.file).toBe("shader.wgsl");
    expect(error.position).toMatch(/^token 0 \(input 1:1, output 1:1\)$/);
    expect(error.message).toMatch(/^WGSL obfuscation self-check failed in shader\.wgsl at token 0 \(input 1:1, output 1:1\): /);
    expect(error.reason).toContain("letx");
  });
});

describe("token shape", () => {
  const SRC = `
    @vertex
    fn vs(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
      let x = f32(index) - -1.0;
      return vec4f(x);
    }
  `;
  const input = analyse(SRC);

  it("passes a rename-only output", () => {
    expect(() =>
      checkTokenShape("a.wgsl", input, "@vertex fn vs(@builtin(vertex_index)_a:u32)->@builtin(position)vec4f{let _b=f32(_a)- -1.0;return vec4f(_b);}"),
    ).not.toThrow();
  });

  it("passes `@ vertex` written with a gap", () => {
    expect(() => checkTokenShape("a.wgsl", input, SRC.replace("@vertex", "@ vertex"))).not.toThrow();
  });

  it("fails a merged token", () => {
    const error = verifyError(() =>
      checkTokenShape("a.wgsl", input, "@vertex fn vs(@builtin(vertex_index)_a:u32)->@builtin(position)vec4f{let_b=f32(_a)- -1.0;return vec4f(_b);}"),
    );
    expect(error.position).toMatch(/^token 19 \(input 4:7, output 1:\d+\)$/);
  });

  it("fails two operators that merged", () => {
    const error = verifyError(() =>
      checkTokenShape("a.wgsl", input, "@vertex fn vs(@builtin(vertex_index)_a:u32)->@builtin(position)vec4f{let _b=f32(_a)--1.0;return vec4f(_b);}"),
    );
    expect(error.reason).toMatch(/op "-" became op "--"/);
  });

  it("fails a changed literal", () => {
    const error = verifyError(() => checkTokenShape("a.wgsl", input, SRC.replace("-1.0", "-2.0")));
    expect(error.reason).toMatch(/number "1.0" became number "2.0"/);
  });

  it("fails a renamed keyword", () => {
    const error = verifyError(() => checkTokenShape("a.wgsl", input, SRC.replace("return", "_r")));
    expect(error.reason).toMatch(/keyword "return" was renamed/);
  });

  it("fails a renamed context-dependent name", () => {
    const error = verifyError(() => checkTokenShape("a.wgsl", input, SRC.replace("(position)", "(_p)")));
    expect(error.reason).toMatch(/context "position" was renamed/);
  });

  it("fails a changed attribute", () => {
    const error = verifyError(() => checkTokenShape("a.wgsl", input, SRC.replace("@vertex", "@fragment")));
    expect(error.reason).toMatch(/@vertex became @fragment/);
  });

  it("fails a missing or extra token", () => {
    expect(verifyError(() => checkTokenShape("a.wgsl", input, SRC.trimEnd().slice(0, -1))).reason)
      .toMatch(/the output has 36 tokens and the input 37; op "}" in the input, nothing in the output/);
    expect(verifyError(() => checkTokenShape("a.wgsl", input, `${SRC};`)).reason).toMatch(/38 tokens and the input 37/);
  });
});

describe("binding shape", () => {
  it("fails a local that captures a module-scope name", () => {
    const src = `const K: f32 = 1.0; fn f() -> f32 { let a = 2.0; return a + K; }`;
    // `_a` is both the const and the local: the last `_a` now binds to the local
    const bad = `const _a:f32=1.0;fn _b()->f32{let _a=2.0;return _a+_a;}`;
    expect(() => checkTokenShape("a.wgsl", analyse(src), bad)).not.toThrow();
    const error = verifyError(() => checkBindingShape("a.wgsl", analyse(src), bad, new Map([["K", "_a"], ["f", "_b"]]), NO_MAP));
    expect(error.reason).toMatch(/"K" binds to the declaration at token 1, but "_a" binds to the declaration at token 15/);
  });

  it("fails a local that captures a builtin", () => {
    const src = `fn f() -> f32 { let a = 1.0; return a + sqrt(4.0); }`;
    const bad = `fn _a()->f32{let sqrt=1.0;return sqrt+sqrt(4.0);}`;
    const error = verifyError(() => checkBindingShape("a.wgsl", analyse(src), bad, new Map([["f", "_a"]]), NO_MAP));
    expect(error.reason).toMatch(/"sqrt" is unresolved in the input but "sqrt" is ref in the output/);
  });

  it("fails two locals merged into one name", () => {
    const src = `fn f() -> f32 { let a = 1.0; { let b = 2.0; return a + b; } }`;
    const bad = `fn _a()->f32{let _b=1.0;{let _b=2.0;return _b+_b;}}`;
    expect(() => checkBindingShape("a.wgsl", analyse(src), bad, new Map([["f", "_a"]]), NO_MAP)).toThrow(VerifyError);
  });

  it("fails an unresolved name renamed to something other than its module map name", () => {
    const src = `fn f() -> f32 { return helper(); }`;
    const bad = `fn _a()->f32{return _c();}`;
    const map = new Map([["f", "_a"], ["helper", "_b"]]);
    expect(verifyError(() => checkBindingShape("a.wgsl", analyse(src), bad, map, NO_MAP)).reason)
      .toMatch(/unresolved "helper" became "_c", which is not its module map name/);
    expect(() => checkBindingShape("a.wgsl", analyse(src), `fn _a()->f32{return _b();}`, map, NO_MAP)).not.toThrow();
  });

  it("fails a member renamed against the member map", () => {
    const src = `struct S { width: f32 } fn f(s: S) -> f32 { return s.width; }`;
    const bad = `struct _a{_b:f32}fn _c(_d:_a)->f32{return _d._x;}`;
    const modules = new Map([["S", "_a"], ["f", "_c"]]);
    const error = verifyError(() => checkBindingShape("a.wgsl", analyse(src), bad, modules, new Map([["width", "_b"]])));
    expect(error.reason).toMatch(/member "width" became "_x" instead of "_b"/);
  });

  it("fails an output with a different token shape instead of misreading it", () => {
    expect(() => checkBindingShape("a.wgsl", analyse("fn f() {}"), "fn f(){};", NO_MAP, NO_MAP)).toThrow(/token shape/);
  });
});

describe("project consistency", () => {
  const FILES = {
    "lib.wgsl": `const LIMIT: f32 = 2.0; fn helper(v: f32) -> f32 { return min(v, LIMIT); }`,
    "use.wgsl": `fn user(v: f32) -> f32 { return helper(v) * LIMIT; } fn other() {}`,
  };

  it("passes a real build", () => {
    expect(() => verifyBuild(buildProject(FILES, SETTINGS))).not.toThrow();
  });

  it("fails an inconsistent cross-file rename", () => {
    const build = buildProject(FILES, SETTINGS);
    const helper = build.moduleMap.get("helper")!;
    // The using file calls the library function by a different name
    build.files[1].output = build.files[1].output.replace(helper, "_zz");
    const error = verifyError(() => verifyBuild(build));
    expect(error.file).toBe("use.wgsl");
    expect(error.reason).toMatch(/unresolved "helper" became "_zz"/);
  });

  it("fails a module map that is not one-to-one", () => {
    const build = buildProject(FILES, SETTINGS);
    build.moduleMap.set("helper", build.moduleMap.get("LIMIT")!);
    const error = verifyError(() => checkProjectConsistency(build));
    expect(error.file).toBe("project");
    expect(error.reason).toMatch(/are both renamed to/);
  });

  it("fails a member map that is not one-to-one", () => {
    const build = buildProject({ "a.wgsl": `struct S { p: f32, q: f32 }` }, SETTINGS);
    build.memberMap.set("q", build.memberMap.get("p")!);
    expect(() => checkProjectConsistency(build)).toThrow(/member map: "p" and "q" are both renamed/);
  });

  it("fails a generated name that appears in the sources", () => {
    const build = buildProject({ ...FILES, "other.wgsl": `fn _q() {}` }, SETTINGS);
    build.moduleMap.set("helper", "_q");
    expect(verifyError(() => checkProjectConsistency(build)).reason).toMatch(/"helper" is renamed to "_q", which appears in the sources/);
  });

  it("fails a generated local name that appears in the sources", () => {
    const build = buildProject({ ...FILES, "other.wgsl": `fn _q() {}` }, SETTINGS);
    build.localNames.add("_q");
    expect(verifyError(() => checkProjectConsistency(build)).reason).toMatch(/local name "_q"/);
  });

  it("fails a renamed name that nothing declares at module scope", () => {
    const build = buildProject({ "use.wgsl": `fn user(v: f32) -> f32 { return outsideFn(v); } fn other() {}` }, SETTINGS);
    build.moduleMap.set("outsideFn", "_zz");
    expect(verifyError(() => checkProjectConsistency(build)).reason).toMatch(/"outsideFn" is renamed but nothing declares it/);
  });

  it("fails an unresolved token renamed although no file declares it", () => {
    const build = buildProject({ "use.wgsl": `fn user(v: f32) -> f32 { return outsideFn(v); } fn other() {}` }, SETTINGS);
    const k = build.files[0].analysis.classes.findIndex(
      (cls, i) => cls === "unresolved" && build.files[0].analysis.tokens[build.files[0].analysis.sig[i]].value === "outsideFn",
    );
    build.files[0].names[k] = "_zz";
    const error = verifyError(() => checkProjectConsistency(build));
    expect(error.file).toBe("use.wgsl");
    expect(error.reason).toMatch(/unresolved "outsideFn" was renamed to "_zz"/);
  });

  it("finds module-scope declarations without the resolver", () => {
    const src = `
      const A = 1; override B: f32; var<private> C: f32; @group(0) @binding(0) var D: sampler;
      struct E { f: f32 } alias G = f32; fn H(i: f32) { let j = 1; var k = 2; const l = 3; }
    `;
    expect([...scanModuleDeclarations(src)].sort()).toEqual(["A", "B", "C", "D", "E", "G", "H"]);
  });
});
