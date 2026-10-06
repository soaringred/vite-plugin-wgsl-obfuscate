import { describe, it, expect } from "vitest";
import { obfuscate, obfuscateProject } from "@/index";
import { expectSameProgram } from "@tests/helpers/differential";

// The proof once followed declarations by recursion, and 2,000 chained `let`s
// overflowed the stack. Past a fixed depth it now gives "unknown", which keeps the name.

const OUT = `@group(0) @binding(0) var<storage, read_write> out: array<f32>;`;

function chain(n: number): string {
  const lets = Array.from({ length: n }, (_, i) => `let a${i + 1} = a${i};`).join("\n  ");
  return `${OUT}
struct S { m: f32 }
fn f(s: S) -> f32 {
  let a0 = s;
  ${lets}
  return a${n}.m;
}
@compute @workgroup_size(1) fn main() { out[0] = f(S(1.0)); }`;
}

describe("long chains of declarations", () => {
  it("2,000 inferred `let`s: no crash, the access is proven, the output compiles the same", async () => {
    const src = chain(2000);
    const { files, report } = obfuscateProject({ "s.wgsl": src });
    expect(report.memberMap.has("m")).toBe(true);
    await expectSameProgram(src, files["s.wgsl"]);
  });

  it("20,000 inferred `let`s", () => {
    expect(() => obfuscate(chain(20000))).not.toThrow();
  });

  it("module-scope values declared after the ones they use, 2,000 deep: the field is kept", async () => {
    const consts = Array.from({ length: 2000 }, (_, i) => `const c${2000 - i} = c${1999 - i};`).join("\n");
    const src = `${OUT}\nstruct S { m: f32 }\n${consts}\nconst c0 = S(1.0);\n@compute @workgroup_size(1) fn main() { out[0] = c2000.m; }`;
    const { files, report } = obfuscateProject({ "s.wgsl": src });
    expect(report.memberMap.has("m")).toBe(false);
    expect(report.doubts.find((d) => d.name === "m")!.reason).toMatch(/nests too deeply/);
    await expectSameProgram(src, files["s.wgsl"]);
  });

  it("the reason for an unproven chain stays short", () => {
    const lets = Array.from({ length: 3000 }, (_, i) => `let a${i + 1} = a${i};`).join(" ");
    const src = `struct S { m: f32 } fn f(s: S) -> f32 { let a0 = ext; ${lets} return a3000.m + s.m; }`;
    const doubt = obfuscateProject({ "s.wgsl": src }).report.doubts.find((d) => d.name === "m")!;
    expect(doubt.reason.length).toBeLessThan(300);
    expect(doubt.reason).toContain("`a3000` has no explicit type, and the type of `ext` is not proven");
  });
});

describe("deeply nested expressions and types", () => {
  it.each([
    ["50,000 parentheses", `struct S { m: f32 } fn f(s: S) -> f32 { return ${"(".repeat(50000)}s${")".repeat(50000)}.m; }`],
    ["50,000 dereferences", `struct S { m: f32 } fn f(p: ptr<function, S>) -> f32 { return (${"*".repeat(50000)}p).m; }`],
    ["20,000 nested `array(...)`", `struct S { m: f32 } fn f(s: S) -> f32 { return ${"array(".repeat(20000)}s${")[0]".repeat(20000)}.m; }`],
    ["a type nested 20,000 deep", `struct S { m: f32 } fn f(p: ${"array<".repeat(20000)}S${", 1>".repeat(20000)}) -> f32 { return p${"[0]".repeat(20000)}.m; }`],
    ["20,000 aliases, each of the next", `struct S { m: f32 } ${Array.from({ length: 20000 }, (_, i) => `alias T${i} = T${i + 1};`).join(" ")} alias T20000 = S; fn f(t: T0) -> f32 { return t.m; }`],
  ])("%s: no crash (no compiler accepts these)", (_, src) => {
    expect(() => obfuscate(src)).not.toThrow();
  });
});
