import { describe, it, expect } from "vitest";
import { obfuscate } from "@/index";
import { generatedName } from "@/engine/project";
import { expectSafeEverywhere } from "@tests/helpers/differential";
import { identifiers } from "@tests/helpers/wgsl";

// Names built to confuse the renamer: ones that look generated or predeclared, one
// name in every role, shadowing at every depth, Unicode. Judged under every option set.

const OUT = `@group(0) @binding(0) var<storage, read_write> out: array<f32>;`;

describe("names that look like generated names", () => {
  // `_a` ... `_zz`: every generated name of up to two letters is taken
  const taken = Array.from({ length: 26 * 27 }, (_, i) => generatedName(i));
  const src = `${OUT}
${taken.map((name, i) => `const ${name} = ${i}.0;`).join("\n")}
fn helper(value: f32) -> f32 { let local = value * _a; return local + _zz; }
@compute @workgroup_size(1) fn main() { out[0] = helper(_b); }`;

  it("skips every name the source uses", async () => {
    const out = obfuscate(src);
    const fresh = identifiers(out).filter((n) => /^_[a-z]+$/.test(n) && !taken.includes(n));
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh.every((n) => n.length === 4)).toBe(true);
    await expectSafeEverywhere(src);
  });
});

describe("one name in every role", () => {
  it("a struct, its field, a parameter and a local named alike", async () => {
    await expectSafeEverywhere(`${OUT}
struct n { n: f32 }
fn f(n: n) -> f32 { return n.n; }
fn g() -> f32 { let n = n(1.0); return n.n + f(n); }
@compute @workgroup_size(1) fn main() { out[0] = g(); }`);
  });

  it("a parameter named like its function, and a function named like another's parameter", async () => {
    await expectSafeEverywhere(`${OUT}
fn f(f: f32) -> f32 { return f * 2.0; }
fn g(g: f32) -> f32 { let f2 = f(g); return f2; }
@compute @workgroup_size(1) fn main() { out[0] = g(1.0); }`);
  });

  it("a parameter named like a struct and typed by it", async () => {
    await expectSafeEverywhere(`${OUT}
struct P { v: f32 }
fn f(P: P) -> f32 { return P.v; }
@compute @workgroup_size(1) fn main() { out[0] = f(P(1.0)); }`);
  });

  it("context words, builtins and types as names", async () => {
    await expectSafeEverywhere(`${OUT}
struct builtin { position: f32, vertex_index: u32 }
struct length { v: f32 }
fn location(interpolate: builtin) -> f32 { let flat = interpolate.position; let perspective = f32(interpolate.vertex_index); return flat + perspective; }
fn sized(l: length) -> f32 { let vec3f = l.v; return vec3f; }
@compute @workgroup_size(1) fn main() { let sample = builtin(1.0, 2u); out[0] = location(sample) + sized(length(3.0)); }`);
  });

  it("a local shadows a builtin that another scope still calls", async () => {
    const src = `${OUT}
fn f() -> f32 { { let max = 1.0; let length = max + 1.0; _ = length; } let m = max(1.0, 2.0); return m + length(vec2f(3.0, 4.0)); }
@compute @workgroup_size(1) fn main() { out[0] = f(); }`;
    const out = obfuscate(src);
    expect(identifiers(out).filter((n) => n === "max")).toHaveLength(1);
    await expectSafeEverywhere(src);
  });

  it("names of diagnostic rules and extensions as declarations", async () => {
    await expectSafeEverywhere(`diagnostic(off, derivative_uniformity);
${OUT}
const derivative_uniformity = 2.0;
fn off() -> f32 { return derivative_uniformity; }
fn f(off: f32) -> f32 { @diagnostic(off, derivative_uniformity) { let derivative_uniformity = off; return derivative_uniformity; } }
@compute @workgroup_size(1) fn main() { out[0] = off() + f(1.0); }`);
  });
});

describe("shadowing", () => {
  it("at every depth, reading the outer name in the inner declaration", async () => {
    await expectSafeEverywhere(`${OUT}
fn f(x: f32) -> f32 { let y = x; { let x = x + 1.0; { let x = x * 2.0; { var x = x - y; x += 1.0; return x; } } } }
fn g(i: i32) -> i32 { var t = 0; for (var i = i; i < 10; i++) { let i = i * 2; t += i; } return t + i; }
fn h() -> f32 { let a = 1.0; { let b = a; let a = b + a; return a; } }
@compute @workgroup_size(1) fn main() { out[0] = f(1.0) + f32(g(2)) + h(); }`);
  });

  it("in loop bodies, continuing blocks and switch cases", async () => {
    await expectSafeEverywhere(`${OUT}
fn f(n: i32) -> i32 {
  var total = 0;
  var i = 0;
  loop { let step = i * 2; total += step; continuing { let next = step + 1; i = next; break if i > n; } }
  switch (n) { case 1, 2: { let total = 5; _ = total; } case 3: { total -= 1; } default: { let n = total; total = n + 1; } }
  while (total > 100) { let half = total / 2; total = half; }
  return total;
}
@compute @workgroup_size(1) fn main() { out[0] = f32(f(7)); }`);
  });
});

describe("Unicode identifiers", () => {
  it("that differ only by normalisation form are different names", async () => {
    const nfc = "é";
    const nfd = "é";
    const src = `${OUT}
fn f(${nfc}: f32, ${nfd}: f32) -> f32 { let ${nfc}2 = ${nfc} * 2.0; return ${nfc}2 - ${nfd}; }
@compute @workgroup_size(1) fn main() { out[0] = f(1.0, 2.0); }`;
    await expectSafeEverywhere(src);
  });

  it.each([
    ["astral", "\u{1D499}"],
    ["CJK", "関数"],
    ["with a zero-width non-joiner", "a‌b"],
    ["with a zero-width joiner", "a‍b"],
    ["from Unicode 15", "\u{11F04}"],
    ["from Unicode 16", "\u{1E5D0}"],
  ])("%s", async (_, name) => {
    await expectSafeEverywhere(`${OUT}
fn f(${name}: f32) -> f32 { let ${name}2 = ${name} * 2.0; return ${name}2; }
@compute @workgroup_size(1) fn main() { out[0] = f(1.0); }`);
  });

  it("a 5,000-character name", async () => {
    const name = "a".repeat(5000);
    const src = `${OUT}\nfn ${name}() -> f32 { return 1.0; }\n@compute @workgroup_size(1) fn main() { out[0] = ${name}(); }`;
    expect(obfuscate(src)).not.toContain(name);
    await expectSafeEverywhere(src);
  });
});
