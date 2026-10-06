import { describe, it, expect } from "vitest";
import { obfuscate } from "@/index";
import type { ObfuscateOptions } from "@/index";

// Nothing may be quadratic enough to hang a build. A 5,000-line shader takes
// about 150 ms; the budget leaves room for slow machines, not for quadratic growth.

const BUDGET_MS = 1000;

function timed(src: string, options: ObfuscateOptions = {}): number {
  const start = performance.now();
  obfuscate(src, options);
  return performance.now() - start;
}

/** About 7 lines per block: structs, consts, functions with loops and member accesses. */
function largeShader(blocks: number): string {
  const lines: string[] = [];
  for (let i = 0; i < blocks; i++) {
    lines.push(`struct S${i} { f${i}: f32, g${i}: vec3f, h: f32 }`);
    lines.push(`const K${i}: f32 = ${i}.0;`);
    lines.push(`fn fun${i}(p: S${i}, q: f32) -> f32 {`);
    lines.push(`  var acc = p.f${i} * q + K${i};`);
    lines.push(`  for (var j = 0; j < 4; j++) { let t = acc + f32(j); acc = t * p.h + ext${i % 7}.h; }`);
    lines.push(`  return acc + p.g${i}.x;`);
    lines.push(`}`);
  }
  return lines.join("\n");
}

describe("performance", () => {
  const large = largeShader(715);

  it("a 5,000-line shader", () => {
    expect(large.split("\n").length).toBeGreaterThanOrEqual(5000);
    expect(timed(large)).toBeLessThan(BUDGET_MS);
  });

  const fields = Array.from({ length: 5000 }, (_, i) => `m${i}: f32`).join(", ");
  const reads = Array.from({ length: 5000 }, (_, i) => `+ q.m${i} + ext.m${i}`).join(" ");
  const locals = Array.from({ length: 5000 }, (_, i) => `let l${i} = ${i}.0;`).join(" ");
  const sum = Array.from({ length: 5000 }, (_, i) => `l${i}`).join(" + ");

  it.each([
    ["5,000 fields, each read proven and unproven", `struct S { ${fields} } fn f(q: S) -> f32 { return 0.0 ${reads}; }`],
    ["5,000 locals in one function", `fn f() -> f32 { ${locals} return ${sum}; }`],
    ["5,000 nested blocks", `fn f() { ${Array.from({ length: 5000 }, (_, i) => `{ let v${i} = ${i};`).join(" ")} ${"}".repeat(5000)} }`],
    ["a 20,000-term expression", `fn f(a: f32) -> f32 { return ${Array(20000).fill("a").join(" + ")}; }`],
    ["a chain of 5,000 member accesses", `struct S { n: S2 } fn f(s: S) { _ = s${".n".repeat(5000)}; }`],
    ["3,000 nested parentheses", `struct S { m: f32 } fn f(s: S) -> f32 { return ${"(".repeat(3000)}s${")".repeat(3000)}.m; }`],
    ["a 1 MB comment", `fn f() {}\n/*${"x".repeat(1_000_000)}*/`],
  ])("%s", (_, src) => {
    expect(timed(src)).toBeLessThan(BUDGET_MS);
  });
});
