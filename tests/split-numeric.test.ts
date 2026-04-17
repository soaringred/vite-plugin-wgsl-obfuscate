import { describe, it, expect } from "vitest";
import { runTransform } from "./helpers";

function extractSplits(wgsl: string): string[] {
  const out = runTransform(wgsl, {
    renameIdents: false,
    stripComments: false,
    collapseWhitespace: false,
    inlineConsts: false,
  });
  const matches = out.matchAll(/\(([-+0-9.eE+]+)\)/g);
  return [...matches].map((m) => m[1]);
}

function evalSum(expr: string): number {
  const parts = expr.split("+").map((s) => parseFloat(s));
  return parts.reduce((a, b) => a + b, 0);
}

describe("constant splitting", () => {
  it("splits floats that exceed the skip threshold", () => {
    const splits = extractSplits(`fn main() { let x = 3.14159; }`);
    expect(splits.length).toBe(1);
  });

  it("split sum approximates the original value", () => {
    const splits = extractSplits(`fn main() { let x = 3.14159; }`);
    const sum = evalSum(splits[0]);
    expect(Math.abs(sum - 3.14159)).toBeLessThan(1e-5);
  });

  it("does not split small integers (likely indices)", () => {
    const out = runTransform(`fn main() { let n = 8; let m = 42; }`, {
      renameIdents: false,
      collapseWhitespace: false,
      inlineConsts: false,
    });
    // bare integers, no parenthesised sum wrapping them
    expect(out).toMatch(/= 8;/);
    expect(out).toMatch(/= 42;/);
  });

  it("does not split hex literals", () => {
    const out = runTransform(`fn main() { let mask = 0xFFu; }`, {
      renameIdents: false,
      collapseWhitespace: false,
      inlineConsts: false,
    });
    expect(out).toContain("0xFFu");
  });

  it("preserves numeric type suffixes (u, i, f, h)", () => {
    const out = runTransform(`fn main() { let x = 12345u; }`, {
      renameIdents: false,
      collapseWhitespace: false,
      inlineConsts: false,
    });
    // the last part of the sum should carry the "u" suffix
    expect(out).toMatch(/u\)/);
  });

  it("is deterministic for the same input", () => {
    const a = extractSplits(`fn main() { let x = 7.777; }`);
    const b = extractSplits(`fn main() { let x = 7.777; }`);
    expect(a).toEqual(b);
  });
});
