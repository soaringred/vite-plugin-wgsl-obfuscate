import { describe, it, expect } from "vitest";
import { obfuscate, obfuscateProject } from "@/index";
import { expectValid, expectSameSpirv } from "@tests/helpers/compilers";
import { FILES, LIB, PASS } from "@tests/engine/options/helpers";
import { identifiers } from "@tests/helpers/wgsl";

// The `prefix` option.

/** Identifiers in `out` that do not appear in `src`: the generated names. */
function generated(src: string, out: string): string[] {
  const original = new Set(identifiers(src));
  return [...new Set(identifiers(out))].filter((n) => !original.has(n));
}

describe("prefix", () => {
  it("starts every generated module-scope name, field and local", async () => {
    const { files, report } = obfuscateProject(FILES, { prefix: "gx" });
    const names = generated(`${LIB}${PASS}`, `${files["lib.wgsl"]}${files["pass.wgsl"]}`);
    expect([...report.moduleMap.values()].every((n) => n.startsWith("gx"))).toBe(true);
    expect([...report.memberMap.values()].every((n) => n.startsWith("gx"))).toBe(true);
    // Parameters and locals get one too
    for (const local of ["g", "d", "id", "strength"]) expect(identifiers(files["lib.wgsl"] + files["pass.wgsl"])).not.toContain(local);
    expect(names.every((n) => /^gx[a-z]+$/.test(n))).toBe(true);
    const link = `${files["lib.wgsl"]}\n${files["pass.wgsl"]}`;
    await expectValid(link);
    expectSameSpirv(`${LIB}\n${PASS}`, link);
  });

  it("skips generated names that are WGSL words", async () => {
    // With the prefix `i`, the sequence passes `id` (an attribute name) and `if`
    const src = Array.from({ length: 12 }, (_, i) => `const value${i}: f32 = ${i}.0;`).join("\n") +
      `\nfn total() -> f32 { return ${Array.from({ length: 12 }, (_, i) => `value${i}`).join(" + ")}; }`;
    const { report } = obfuscateProject({ "a.wgsl": src }, { prefix: "i" });
    const names = [...report.moduleMap.values()];
    expect(names).toHaveLength(13);
    expect(names).not.toContain("if");
    expect(names).not.toContain("id");
    const out = obfuscate(src, { prefix: "i" });
    await expectValid(out);
    expectSameSpirv(src, out);
  });

  it("may be a non-ASCII letter", async () => {
    const out = obfuscate(LIB, { prefix: "é" });
    expect(identifiers(out).some((n) => n.startsWith("é"))).toBe(true);
    await expectValid(out);
    expectSameSpirv(LIB, out);
  });

  it("names the rule in the error for an invalid prefix", () => {
    expect(() => obfuscate(LIB, { prefix: "__g" })).toThrow(
      'vite-plugin-wgsl-obfuscate: invalid `prefix` "__g". A prefix must start with `_` or a letter, ' +
        "contain only identifier characters, and not start with `__`.",
    );
  });
});
