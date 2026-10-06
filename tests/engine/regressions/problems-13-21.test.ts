import { describe, it } from "vitest";
import { BUILTINS } from "@/index";
import { expectSafeRename } from "@tests/helpers/differential";
import { without } from "@tests/helpers/wgsl";

// Problems 13-21, found in 0.1.3. Each output must compile to the input's SPIR-V.

// Problem 13: the phony assignment target `_` was renamed to an undeclared name
const P13 = `
  @group(0) @binding(0) var<uniform> exposure: vec4f;
  @compute @workgroup_size(1)
  fn main() { _ = exposure; }
`;

// Problem 14: `a - -b` became `a --b`
const P14 = `
  fn offsetBy(base: f32, delta: f32) -> f32 { return base - -delta - -1.0; }
`;

// Problem 15: `a / *p` became `a /*p`, opening a block comment
const P15 = `
  fn divideBy(numer: f32, denom: ptr<function, f32>) -> f32 { return numer / *denom; }
`;

// Problem 16: hex float literals were split, and the exponent renamed
const P16 = `
  fn hexFloats() -> f32 { return 0x1.8p1 + 0x.4p-1 + 0x1p2f + 0xA.Bp+1; }
  fn hexMask() -> u32 { return 0xFFu & 0x0Fu; }
`;

// Problem 17: builtins missing from the plugin's lists were renamed
const P17 = `
  @group(0) @binding(0) var<storage, read_write> counter: atomic<u32>;
  fn wholePart(v: f32) -> f32 { return modf(v).whole; }
  fn easeIn(t: f32) -> f32 { return smoothstep(0.0, 1.0, t); }
  @compute @workgroup_size(1)
  fn main() {
    let swap = atomicCompareExchangeWeak(&counter, 0u, 1u);
    if (swap.exchanged) {
      atomicStore(&counter, swap.old_value + u32(wholePart(easeIn(2.5))));
    }
  }
`;

// Problem 18: the names in `diagnostic(...)` were renamed
const P18 = `
  diagnostic(off, derivative_uniformity);
  @diagnostic(warning, derivative_uniformity)
  fn edgeWidth(coverage: f32) -> f32 { return fwidth(coverage); }
  @fragment
  fn shadeEdge(@location(0) coverage: f32) -> @location(0) vec4f {
    if (coverage > 0.5) { return vec4f(fwidth(coverage)); }
    return vec4f(0.0);
  }
`;

// Problem 19: the const inliner rewrote a nested `let` that shadows a const
const P19 = `
  const spread = 2.0;
  fn widen(v: f32) -> f32 {
    var total = v * spread;
    if (v > 1.0) {
      let spread = 3.0;
      total += spread;
    }
    return total;
  }
`;

// Problem 20: removing a comment joined its neighbours: `let/* c */x` became `letx`
const P20 = `
  fn brightness(color: vec3f) -> f32 {
    let/* luma */weight = vec3f(0.2126, 0.7152, 0.0722);
    return/**/dot(color, weight);
  }
`;

// Problem 21: `@ fragment` with a space was not seen as an entry point, and renamed
const P21 = `
  @ fragment
  fn paintSolid() -> @location(0) vec4f { return vec4f(0.2, 0.4, 0.6, 1.0); }
`;

describe("regressions: problems 13-21", () => {
  it("problem 13: the phony assignment target `_` is not renamed", async () => {
    await expectSafeRename(P13);
  });

  it("problem 14: `a - -b` does not become `a --b`", async () => {
    await expectSafeRename(P14);
  });

  it("problem 15: `a / *p` does not open a block comment", async () => {
    await expectSafeRename(P15);
  });

  it("problem 16: hex float literals survive intact", async () => {
    await expectSafeRename(P16);
  });

  it("problem 17: builtins missing from the plugin's lists are left alone", async () => {
    // `smoothstep` stands in for a builtin added to WGSL later
    await without(BUILTINS, ["smoothstep"], () => expectSafeRename(P17));
  });

  it("problem 18: diagnostic directive and attribute arguments are kept", async () => {
    await expectSafeRename(P18);
  });

  it("problem 19: a nested local that shadows a module const is left intact", async () => {
    await expectSafeRename(P19);
  });

  it("problem 20: removing a comment does not join its neighbours", async () => {
    await expectSafeRename(P20);
  });

  it("problem 21: `@ fragment` with a space still marks an entry point", async () => {
    // Entry point names are part of the SPIR-V, so a rename would show there
    await expectSafeRename(P21);
  });
});
