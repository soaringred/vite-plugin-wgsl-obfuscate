import { describe, it, expect } from "vitest";
import { tokenize } from "@/wgsl/tokenizer";
import { resolve } from "@/analysis/resolver";
import type { FileAnalysis, IdentClass } from "@/analysis/resolver";

// The class of every identifier token and the declaration it binds to.

interface Ident {
  text: string;
  cls: IdentClass;
  /** Significant-token index of the bound declaration, or -1. */
  decl: number;
  /** Significant-token index of this token. */
  index: number;
}

function identsOf(analysis: FileAnalysis): Ident[] {
  const out: Ident[] = [];
  analysis.classes.forEach((cls, index) => {
    if (cls === undefined) return;
    const symbol = analysis.symbols[analysis.bindings[index]];
    out.push({ text: analysis.tokens[analysis.sig[index]].value, cls, decl: symbol?.decl ?? -1, index });
  });
  return out;
}

/** `text:class` for every identifier in `src`. */
function classes(src: string): string[] {
  return identsOf(resolve(tokenize(src))).map((i) => `${i.text}:${i.cls}`);
}

/**
 * For each occurrence of `name`, the occurrence number (0-based, among all
 * identifiers with that text) of the declaration it binds to, or null.
 */
function bindingsOf(src: string, name: string): (number | null)[] {
  const idents = identsOf(resolve(tokenize(src))).filter((i) => i.text === name);
  return idents.map((i) => {
    const target = idents.findIndex((d) => d.index === i.decl);
    return target < 0 ? null : target;
  });
}

describe("classes", () => {
  it("keywords, declarations, references and unresolved names", () => {
    expect(classes(`fn f(a: f32) -> f32 { let b = a; return sqrt(b); }`)).toEqual([
      "fn:keyword", "f:decl", "a:decl", "f32:unresolved", "f32:unresolved",
      "let:keyword", "b:decl", "a:ref", "return:keyword", "sqrt:unresolved", "b:ref",
    ]);
  });

  it("module-scope names are visible before their declaration", () => {
    expect(classes(`fn f() -> f32 { return g() + K; } const K = 1.0; fn g() -> f32 { return 2.0; }`)).toContain("K:ref");
    // The call binds to the declaration that follows it
    expect(bindingsOf(`fn f() -> f32 { return g(); } fn g() -> f32 { return 2.0; }`, "g")).toEqual([1, 1]);
  });

  it("struct fields and member accesses", () => {
    expect(classes(`struct S { @size(16) width: f32, height: f32 } fn f(s: S) -> f32 { return s.width + s.height; }`)).toEqual([
      "struct:keyword", "S:decl", "width:member-decl", "f32:unresolved", "height:member-decl", "f32:unresolved",
      "fn:keyword", "f:decl", "s:decl", "S:ref", "f32:unresolved",
      "return:keyword", "s:ref", "width:member-ref", "s:ref", "height:member-ref",
    ]);
  });

  it("an identifier after `.` is a member whatever its name", () => {
    expect(classes(`const scale = 1.0; fn f(v: vec2f) -> f32 { return v.scale + v.x + v . sqrt; }`)).toEqual(
      expect.arrayContaining(["scale:member-ref", "x:member-ref", "sqrt:member-ref"]),
    );
  });

  it("the phony target `_` is context", () => {
    expect(classes(`fn f() { _ = 1; }`)).toContain("_:context");
  });

  it("the list after `var` is context, the name after it a declaration", () => {
    expect(classes(`@group(0) @binding(0) var<storage, read_write> data: array<f32>;`)).toEqual([
      "var:keyword", "storage:context", "read_write:context", "data:decl", "array:unresolved", "f32:unresolved",
    ]);
    expect(classes(`fn f() { var<function> x: f32; }`)).toContain("function:context");
  });

  it("enumerants in other template lists resolve like any name", () => {
    expect(classes(`fn f(p: ptr<storage, f32, read>) {}`)).toEqual(
      expect.arrayContaining(["storage:unresolved", "read:unresolved"]),
    );
  });

  it("arguments of @builtin, @interpolate and @diagnostic are context", () => {
    expect(classes(`
      @diagnostic(off, chromium.unreachable_code)
      fn f(@builtin(position) p: vec4f, @location(0) @interpolate(flat, either) t: u32) {}
    `)).toEqual(expect.arrayContaining([
      "off:context", "chromium:context", "unreachable_code:context",
      "position:context", "flat:context", "either:context",
    ]));
  });

  it("statement attributes inside a function body", () => {
    expect(classes(`fn f(v: f32) { @diagnostic(off, derivative_uniformity) if v > 0.0 { let w = v; } }`)).toEqual(
      expect.arrayContaining(["off:context", "derivative_uniformity:context", "w:decl", "v:ref"]),
    );
  });

  it("arguments of the expression attributes are expressions", () => {
    const src = `
      const LOC = 1u; const WG = 8u; const N = 0;
      struct S { @align(WG) @size(WG) @location(LOC) v: f32 }
      @id(N) override o: f32;
      @compute @workgroup_size(WG, WG / 2u) fn main() {}
      @fragment fn fs() -> @location(LOC) @blend_src(N) vec4f { return vec4f(); }
      @group(N) @binding(N) var t: texture_2d<f32>;
    `;
    for (const name of ["LOC", "WG", "N"]) {
      expect(classes(src).filter((c) => c.startsWith(`${name}:`)).slice(1).every((c) => c === `${name}:ref`)).toBe(true);
    }
  });

  it("arguments of an unknown attribute are context and are recorded", () => {
    const src = `
      const WG = 8u;
      struct S { @someNewAttribute(WG, s.m) v: f32 }
      @group(0) @binding(0) @someNewAttribute(WG) var t: texture_2d<f32>;
      fn f(p: f32) { @otherAttribute(p) { } }
    `;
    const analysis = resolve(tokenize(src));
    expect(classes(src)).toEqual(expect.arrayContaining(["WG:decl", "WG:context", "s:context", "m:context", "p:context"]));
    expect(classes(src)).not.toContain("WG:ref");
    const text = (k: number) => analysis.tokens[analysis.sig[k]].value;
    expect(analysis.unknownArguments.map((a) => `${a.attribute}(${text(a.k)})`)).toEqual([
      "someNewAttribute(WG)", "someNewAttribute(s)", "someNewAttribute(m)", "someNewAttribute(WG)", "otherAttribute(p)",
    ]);
  });

  it("arguments of a no-argument attribute that has some are read like an unknown attribute's", () => {
    // naga accepts `@mesh(output)`
    const analysis = resolve(tokenize(`var<workgroup> output: u32; @mesh(output) @workgroup_size(1) fn ms() {}`));
    expect(analysis.unknownArguments.map((a) => a.attribute)).toEqual(["mesh"]);
    expect(classes(`var<workgroup> output: u32; @mesh(output) @workgroup_size(1) fn ms() {}`)).toContain("output:context");
  });

  it("an attribute that takes no arguments does not take a following `(`", () => {
    // `@must_use` is followed by `fn`; `@invariant` by another attribute
    expect(classes(`@must_use fn f() -> f32 { return 1.0; }`)).toContain("f:decl");
    expect(classes(`struct S { @invariant @builtin(position) p: vec4f }`)).toContain("p:member-decl");
  });

  it("directives are context up to their `;`", () => {
    expect(classes(`enable f16, subgroups; requires readonly_and_readwrite_storage_textures; diagnostic(off, derivative_uniformity); const f16v = 1.0;`)).toEqual([
      "enable:keyword", "f16:context", "subgroups:context",
      "requires:keyword", "readonly_and_readwrite_storage_textures:context",
      "diagnostic:keyword", "off:context", "derivative_uniformity:context",
      "const:keyword", "f16v:decl",
    ]);
  });

  it("`const_assert` and `alias` at module scope", () => {
    expect(classes(`const A = 2; alias Real = f32; const_assert A > 1; fn f(r: Real) {}`)).toEqual(
      expect.arrayContaining(["Real:decl", "const_assert:keyword", "A:ref", "Real:ref"]),
    );
  });
});

describe("scopes", () => {
  it("a local is in scope from the end of its statement", () => {
    // let x = v; { let x = x + 1.0; y = x; } z = x;
    const src = `fn f(v: f32) -> f32 { let x = v; var y = 0.0; { let x = x + 1.0; y = x; } return y + x; }`;
    expect(bindingsOf(src, "x")).toEqual([0, 1, 0, 1, 0]);
  });

  it("parameter types, return types and attributes resolve at module scope", () => {
    const src = `struct P { a: f32 } const W = 1u; @compute @workgroup_size(W) fn f(@builtin(local_invocation_index) W: u32) {}
      fn g(P: f32, q: P) -> P { return q; }`;
    expect(bindingsOf(src, "W")).toEqual([0, 0, 2]);
    // struct P, param P, type of q, return type
    expect(bindingsOf(src, "P")).toEqual([0, 1, 0, 0]);
  });

  it("a for initializer covers the condition, update and body, and nothing after", () => {
    const src = `fn f() -> i32 { let i = 7; var t = 0; for (var i = i; i < 3; i++) { t += i; } return t + i; }`;
    // decl, decl (for), init reads outer, cond, update, body, after the loop
    expect(bindingsOf(src, "i")).toEqual([0, 1, 0, 1, 1, 1, 0]);
  });

  it("continuing nests inside its loop body", () => {
    const src = `fn f() { var n = 0; loop { let step = 1; continuing { n += step; break if n > 4; } } }`;
    expect(bindingsOf(src, "step")).toEqual([0, 0]);
  });

  it("every `{` opens a scope", () => {
    const src = `fn f(c: bool) -> i32 { let a = 1; if c { let a = 2; } else { let a = 3; } switch a { default { let a = 4; } } return a; }`;
    expect(bindingsOf(src, "a")).toEqual([0, 1, 2, 0, 4, 0]);
  });
});

describe("flags", () => {
  it("entry points, with any spelling of the stage attribute", () => {
    const analysis = resolve(tokenize(`@ fragment fn a() {} @/* c */vertex fn b() {} @compute @workgroup_size(1) fn c() {} fn d() {}`));
    const entry = analysis.symbols.filter((s) => s.kind === "fn").map((s) => [s.name, s.entryPoint]);
    expect(entry).toEqual([["a", true], ["b", true], ["c", true], ["d", false]]);
  });

  it("overrides with @id", () => {
    const analysis = resolve(tokenize(`override a: f32; @id(1) override b: f32; @ id(2) override c = 1.0;`));
    expect(analysis.symbols.map((s) => [s.name, s.overrideId])).toEqual([["a", false], ["b", true], ["c", true]]);
  });

  it("leading function", () => {
    const leading = (src: string) => {
      const analysis = resolve(tokenize(src));
      return analysis.symbols[analysis.leadingFunction]?.name ?? null;
    };
    expect(leading(`fn f(a: f32) -> f32 { let b = a; return b; }`)).toBe("f");
    expect(leading(`// comment\nenable f16;\nfn f(a: f32) -> f32 { return a; }`)).toBe("f");
    expect(leading(`;\n@must_use fn f() -> f32 { return 1.0; }`)).toBe("f");
    // Anything after the leading function does not matter
    expect(leading(`fn f() {} fn g() {}`)).toBe("f");
    expect(leading(`fn f() {} const K = 1;`)).toBe("f");
    expect(leading(`const K = 1; fn f() {}`)).toBe(null);
    expect(leading(`struct S { v: f32 } fn f() {}`)).toBe(null);
    expect(leading(`const_assert 1 < 2; fn f() {}`)).toBe(null);
    expect(leading(`@fragment fn f() -> @location(0) vec4f { return vec4f(); } fn g() {}`)).toBe(null);
    expect(leading(`@someNewStage fn f() {} fn g() {}`)).toBe(null);
    expect(leading(``)).toBe(null);
  });

  it("stages, unknown attributes and entry points", () => {
    const analysis = resolve(tokenize(`@compute @workgroup_size(1) fn a() {} @someNewStage fn b() {} @must_use fn c() -> f32 { return 1.0; }`));
    const fns = analysis.symbols.filter((s) => s.kind === "fn");
    expect(fns.map((s) => [s.name, s.stage, s.entryPoint, s.unknownAttributes])).toEqual([
      ["a", true, true, []],
      ["b", false, true, ["someNewStage"]],
      ["c", false, false, []],
    ]);
  });

  it("function ranges start at the first attribute and end at the closing brace", () => {
    const src = `const K = 1u; @compute @workgroup_size(K) fn main() { let x = K; }`;
    const analysis = resolve(tokenize(src));
    const [fn] = analysis.functions;
    const text = (k: number) => analysis.tokens[analysis.sig[k]].value;
    expect(text(fn.start)).toBe("@compute");
    expect(text(fn.end)).toBe("}");
    expect(fn.end).toBe(analysis.sig.length - 1);
    expect(fn.locals.map((id) => analysis.symbols[id].name)).toEqual(["x"]);
  });
});

describe("declared types", () => {
  /** Text of every declared type, by symbol name. */
  function types(src: string): Record<string, string> {
    const analysis = resolve(tokenize(src));
    const text = ([start, end]: [number, number]) =>
      analysis.sig.slice(start, end).map((index) => analysis.tokens[index].value).join(" ");
    return Object.fromEntries(analysis.symbols.filter((s) => s.type).map((s) => [s.name, text(s.type!)]));
  }

  it("of parameters, values, return types and aliases", () => {
    expect(types(`
      alias A = array<vec2f, 4>;
      var<private> v: ptr<function, f32>;
      fn f(p: A, q: array<f32, 2>,) -> A { let l: vec2<f32>= vec2(1.0); const c: f32 = 1.0; return p; }
    `)).toEqual({
      A: "array < vec2f , 4 >",
      v: "ptr < function , f32 >",
      f: "A",
      p: "A",
      q: "array < f32 , 2 >",
      // `>=` is one token that closes the list and starts the initializer:
      // the range ends with it, and the proof reads only its `>`
      l: "vec2 < f32 >=",
      c: "f32",
    });
  });

  it("a return type ends where the attributes of the body begin", () => {
    expect(types(`fn f() -> vec4f @diagnostic(off, derivative_uniformity) { return vec4f(); }`)).toEqual({ f: "vec4f" });
    expect(types(`fn f() -> @location(0) vec4f @diagnostic(off, derivative_uniformity) { return vec4f(); }`)).toEqual({ f: "vec4f" });
    expect(types(`fn f() @diagnostic(off, derivative_uniformity) { }`)).toEqual({});
  });

  it("attributes of the body are read at module scope, as context", () => {
    expect(classes(`fn f(off: f32) -> f32 @diagnostic(off, derivative_uniformity) { return off; }`)).toEqual([
      "fn:keyword", "f:decl", "off:decl", "f32:unresolved", "f32:unresolved",
      "off:context", "derivative_uniformity:context", "return:keyword", "off:ref",
    ]);
  });
});
