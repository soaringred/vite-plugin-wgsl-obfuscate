import { describe, it, expect } from "vitest";
import { obfuscate, validate } from "@/index";
import { expectValid, expectSameSpirv, nagaErrors, tintErrors } from "@tests/helpers/compilers";

// Valid WGSL must pass, or the plugin blocks somebody's build. A compiler confirms each
// shader first.

/** Which compilers accept a shader. naga and Tint disagree on a few extensions. */
type AcceptedBy = "both" | "tint" | "naga";

/** Assert that the compilers in `by` accept `source`. A missing Tint adapter skips the Tint half. */
async function expectAccepted(source: string, by: AcceptedBy, label: string): Promise<void> {
  if (by === "both") return expectValid(source, label);
  if (by === "naga") {
    expect(nagaErrors(source), `naga on the ${label}`).toBeNull();
    return;
  }
  const errors = await tintErrors(source);
  if (errors !== null) expect(errors, `Tint on the ${label}`).toEqual([]);
}

/**
 * Valid WGSL that the validator must accept, by construct. `by` names the
 * compiler that accepts it when only one does (default: both).
 */
const VALID: Record<string, { source: string; by?: AcceptedBy }> = {
  // Statements
  "every simple statement": {
    source: `
      fn g() {}
      fn f(p: ptr<function, i32>) -> i32 {
        let a = 1;
        var b: i32;
        var c = 2;
        const d = 3;
        b = a;
        b += c; b -= d; b *= 2; b /= 2; b %= 5;
        b &= 7; b |= 8; b ^= 1; b <<= 1u; b >>= 1u;
        b++; b--;
        *p = b;
        _ = c;
        g();
        { }
        ;
        return b;
      }`,
  },
  "if, else if and else, with and without parentheses": {
    source: `fn f(b: bool, c: bool) -> i32 { if b { return 1; } else if (c) { return 2; } else { return 3; } }`,
  },
  "switch with a default clause, with and without `:`": {
    source: `fn f(x: i32) -> i32 { switch x { case 1: { return 1; } case 2, 3 { return 2; } default: { return 0; } } }`,
  },
  "switch with `default` among the case selectors": {
    source: `fn f(x: i32) -> i32 { switch (x) { case 1, default { return 1; } case 2 { return 2; } } }`,
  },
  "switch with constant-expression selectors": {
    source: `const K = 3; fn f(x: i32) -> i32 { switch x + 1 { case K, 1 + 1: { return 1; } default { return 0; } } }`,
  },
  "loop whose continuing only has break if": { source: `fn f() { loop { continuing { break if true; } } }` },
  "for with every header form": {
    source: `
      fn f() {
        for (;;) { break; }
        for (var i = 0; i < 2; i++) { continue; }
        for (let j = 0; ; ) { break; }
        var k = 0;
        for (; k < 2; k += 1) { }
        for (k = 0; k < 2; k++) { }
      }`,
  },
  "while, with and without parentheses": { source: `fn f(b: bool) { while b { break; } while (b) { break; } }` },
  "discard": { source: `@fragment fn fs() -> @location(0) vec4f { if true { discard; } return vec4f(); }` },
  "return without a value": { source: `fn f() { return; }` },
  "nested blocks": { source: `fn f() -> i32 { { { let a = 1; return a; } } }` },
  // Attributes
  "@diagnostic on every statement that takes it": {
    source: `
      fn f(b: bool) {
        @diagnostic(off, derivative_uniformity) { }
        @diagnostic(off, derivative_uniformity) if b { }
        @diagnostic(off, derivative_uniformity) switch 1 { default { } }
        @diagnostic(off, derivative_uniformity) loop { break; }
        @diagnostic(off, derivative_uniformity) for (;;) { break; }
        @diagnostic(off, derivative_uniformity) while b { }
      }`,
    by: "tint",
  },
  "attributes on a function body": {
    source: `
      fn f() @diagnostic(off, derivative_uniformity) { }
      fn g() -> f32 @diagnostic(off, derivative_uniformity) { return 1.0; }
      @fragment fn fs(@location(0) c: vec4f) -> @location(0) vec4f @diagnostic(off, derivative_uniformity) { return c; }`,
    by: "tint",
  },
  "naga's @early_depth_test": {
    source: `@fragment @early_depth_test(force) fn fs() -> @location(0) vec4f { return vec4f(); }`,
    by: "naga",
  },
  // const_assert
  "const_assert at module and function scope": {
    source: `const_assert 1 < 2; const N = 4; const_assert (N > 2); fn f() { const_assert N == 4; const M = 2; const_assert M < N; }`,
  },
  // Directives
  "directives in any order": {
    source: `diagnostic(off, derivative_uniformity); requires readonly_and_readwrite_storage_textures; enable f16; fn f() {}`,
  },
  "directives with several names": { source: `requires readonly_and_readwrite_storage_textures, packed_4x8_integer_dot_product; fn f() {}` },
  "a diagnostic rule with a namespace": { source: `diagnostic(off, chromium.unreachable_code); fn f() {}` },
  "a diagnostic rule named like a reserved word": { source: `diagnostic(off, foo.filter); @diagnostic(off, bar.typeof) fn f() {}`, by: "naga" },
  // Empty and minimal
  "an empty function": { source: `fn f() { }` },
  "lone `;` at module scope and in a function": { source: `;;; fn f() { ; ; } ; const a = 1; ;` },
  // naga accepts attributes that no declaration follows, and ignores them
  "attributes at the end of the file": { source: `fn f() {}\n@group(0) @binding(0)`, by: "naga" },
  "attributes before `;`": { source: `const N = 4u; @compute @workgroup_size(N) ; fn f() -> u32 { return N; }`, by: "naga" },
  // Trailing commas
  "a trailing comma in parameter and argument lists": {
    source: `fn g(a: f32, b: f32,) -> f32 { return a + b; } fn f() -> f32 { return g(1.0, 2.0,) + vec2f(1.0, 2.0,).x; }`,
  },
  "a trailing comma in template lists": { source: `var<private,> a: array<f32, 4,>; var<private> v: vec3<f32,>;` },
  "a trailing comma in a struct": { source: `struct S { a: f32, b: f32, }` },
  "a trailing comma in attribute arguments": {
    source: `@compute @workgroup_size(1, 1,) fn m() { } @group(0,) @binding(0,) var<uniform> u: f32;
      @vertex fn v() -> @builtin(position,) vec4f { return vec4f(); }
      @fragment fn fs(@location(0,) @interpolate(flat, either,) c: u32) -> @location(0) vec4f { return vec4f(f32(c)); }
      @diagnostic(off, derivative_uniformity,) fn g() { }`,
  },
  "a trailing comma in case selectors": { source: `fn f(x: i32) { switch x { case 1, 2, { } default { } } }` },
  "a trailing comma in directives": {
    source: `enable f16,; requires readonly_and_readwrite_storage_textures,; diagnostic(off, derivative_uniformity,);`,
  },
  // Brackets and template lists
  "deeply nested brackets": {
    source: `
      fn f(a: f32) -> f32 {
        return ((((((((((a)))))))))) * array<array<array<f32, 1>, 1>, 1>(array<array<f32, 1>, 1>(array<f32, 1>(1.0)))[0][0][0];
      }
      fn g() { {{{{{{ }}}}}} }`,
  },
  "spaces inside a `var` template list": { source: `var < private > a: f32;` },
  // Literals
  "every numeric literal form": {
    source: `
      fn f() {
        let a = 0; let b = 123; let c = 0i; let d = 1u; let e = 0x1F; let g = 0X1fu; let h = 0xAbCdEfi;
        let i = 0.0; let j = .5; let k = 1.; let l = 1.5e3; let m = 1e-3; let n = 1E+3f; let o = 2f; let p = 0f;
        let q = 01.5; let r = 00.5; let s = 007e3; let t = 1.5E-3f;
        let u = 0x1p4; let v = 0x1.8p1; let w = 0x.8p0; let x = 0x1.p0; let y = 0x1p-2f; let z = 0x1.8;
        let aa = 0x.8; let ab = 0XA.BP+1; let ac = 0X1P+4f; let ad = 0x1P-4; let ae = 0x1.; let af = 0x1.f;
      }`,
  },
  "f16 literals": { source: `enable f16; fn f() { let a = 0h; let b = 1.5h; let c = 0x1p2h; let d = 1e2h; let e = 2h; let f = .5h; }`, by: "tint" },
  // Names
  "identifiers with underscores and digits": {
    source: `fn f2() -> f32 { let _a = 1.0; let _0 = 2.0; let a_ = 3.0; let A1 = 4.0; _ = a_; return _a + _0 + A1; }`,
  },
  "locals named like context words, builtins and types": {
    source: `
      fn f(v: vec3f) -> f32 {
        let position = 1.0; let read = 2.0; let flat = 3.0; let storage = 4.0; let vertex = 5.0;
        let length = length(v); let f32 = 6.0;
        return position + read + flat + storage + vertex + length + f32;
      }`,
  },
  // Types and declarations
  "aliases of template types": { source: `alias V = vec3<f32>; alias A = array<V, 4>; fn f(a: A) -> V { return a[0]; }` },
  "overrides with and without type, value and @id": {
    source: `override a: f32; override b = 1.0; @id(3) override c: u32 = 2u; @id(4) override d: bool; override e = b * 2.0;`,
  },
  "module-scope initializers": {
    source: `var<private> a: f32 = 1.0; var<private> b = vec2f(1.0); const c: array<f32, 2> = array<f32, 2>(1.0, 2.0); const d = vec3(1.0, 2.0, 3.0).xy;`,
  },
  "bitcast with a template list": { source: `fn f(a: f32) -> u32 { return bitcast<u32>(a); }` },
  "an inferred array constructor": { source: `fn f() -> i32 { let a = array(1, 2, 3); return a[0]; }` },
  "line breaks inside a signature and an expression": {
    source: "fn f(\n  a: f32,\n  b: f32\n) -> f32\n{\n  return (a +\n    b);\n}",
  },
};

describe("valid WGSL passes", () => {
  it.each(Object.entries(VALID))("%s", async (_, { source, by = "both" }) => {
    // The compilers first, so that a failure below is the plugin's
    await expectAccepted(source, by, "input");
    expect(() => validate(source)).not.toThrow();
    // And the output is still accepted by the same compilers
    const out = obfuscate(source);
    await expectAccepted(out, by, "output");
    if (by !== "tint") expectSameSpirv(source, out);
  });
});
