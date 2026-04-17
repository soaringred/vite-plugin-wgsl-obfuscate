import { describe, it, expect } from "vitest";
import { runTransform } from "./helpers";

describe("const inlining", () => {
  it("removes const declarations from output", () => {
    const out = runTransform(
      `const MAX: u32 = 256u; @compute @workgroup_size(1) fn main() { let x = MAX; }`,
      { renameIdents: false, splitConstants: false, collapseWhitespace: false }
    );
    expect(out).not.toMatch(/const\s+MAX/);
  });

  it("inlines const value at every usage site", () => {
    const out = runTransform(
      `const FACTOR: f32 = 2.5; @compute @workgroup_size(1) fn main() { let a = FACTOR; let b = FACTOR * FACTOR; }`,
      { renameIdents: false, splitConstants: false, collapseWhitespace: false }
    );
    // FACTOR should be gone from the output, replaced by 2.5
    expect(out).not.toContain("FACTOR");
    // count occurrences of "2.5"
    const matches = out.match(/2\.5/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it("handles multiple consts independently", () => {
    const out = runTransform(
      `const A: f32 = 1.5; const B: f32 = 9.5; @compute @workgroup_size(1) fn main() { let x = A + B; }`,
      { renameIdents: false, splitConstants: false, collapseWhitespace: false }
    );
    expect(out).not.toContain(" A ");
    expect(out).not.toContain(" B ");
    expect(out).toContain("1.5");
    expect(out).toContain("9.5");
  });
});
