import { describe, it, expect } from "vitest";
import vm from "node:vm";
import {
  PlaceholderStore,
  escapeForStringLiteral,
  findPlaceholders,
  placeholderFor,
  replacePlaceholders,
  substitutePlaceholders,
} from "@/vite/placeholders";
import { doubtWarnings, unrecognisedWarning } from "@/vite/report";
import { fail } from "@/vite/plugin/errors";
import type { BuildContext } from "@/vite/plugin/context";
import { ObfuscateError, VerifyError } from "@/index";
import { originalPositionFor, positionOf } from "@/vite/calls/source-map";
import type { Doubt } from "@/index";

// Building blocks of the Vite plugin, tested without a build.

/** The value of `literal` as JS reads it. */
function evaluate(literal: string): string {
  return vm.runInNewContext(`"use strict"; (${literal})`) as string;
}

describe("escapeForStringLiteral", () => {
  const TRICKY = [
    'fn f() { return 1.0; }\n\r\t"double" \'single\' `back` $ ${x} \\ \\n',
    "\u2028\u2029\u0000\u0001\u001f\u007f\u0085\u200e",
    "unicode names: 𝒻 ñame 変数",
    "",
  ];

  it.each(TRICKY)("gives the same text inside double quotes, single quotes and backticks (%#)", (text) => {
    const escaped = escapeForStringLiteral(text);
    expect(evaluate(`"${escaped}"`)).toBe(text);
    expect(evaluate(`'${escaped}'`)).toBe(text);
    expect(evaluate(`\`${escaped}\``)).toBe(text);
  });

  it("never produces a line terminator, so line numbers after it do not move", () => {
    const escaped = escapeForStringLiteral(TRICKY.join(""));
    expect(escaped).not.toMatch(/[\n\r\u2028\u2029]/);
  });
});

describe("placeholders", () => {
  it("are stable for a module id and distinct between modules", () => {
    const a = placeholderFor("/app/a.wgsl?raw");
    expect(a).toMatch(/^__WGSL_OBFUSCATE_[0-9a-f]{32}__$/);
    expect(placeholderFor("/app/a.wgsl?raw")).toBe(a);
    expect(placeholderFor("/app/b.wgsl?raw")).not.toBe(a);
  });

  it("are found wherever they are, also next to each other", () => {
    const a = placeholderFor("a");
    const b = placeholderFor("b");
    const text = `x = "${a}${b}"; y = '${a}'; z = "__WGSL_OBFUSCATE_notahash__";`;
    expect(findPlaceholders(text).map((p) => p.placeholder)).toEqual([a, b, a]);
    const [first] = findPlaceholders(text);
    expect(text.slice(first.start, first.end)).toBe(a);
    expect(findPlaceholders("no placeholder here")).toEqual([]);
    expect(replacePlaceholders(text, (p) => (p === a ? "A" : "B"))).toBe(
      'x = "AB"; y = \'A\'; z = "__WGSL_OBFUSCATE_notahash__";',
    );
  });

  it("replaces a module's text without changing its placeholder, and can forget the module", () => {
    const store = new PlaceholderStore();
    const wgsl = store.put("/app/a.wgsl?raw", "fn a() {}");
    const other = store.put("/app/b.wgsl?raw", "fn b() {}");
    expect(store.get(wgsl.placeholder)).toEqual({
      placeholder: wgsl.placeholder,
      module: "/app/a.wgsl?raw",
      original: "fn a() {}",
    });
    expect(store.of("/app/a.wgsl?raw")).toEqual(wgsl);

    const again = store.put("/app/a.wgsl?raw", "fn a2() {}");
    expect(again.placeholder).toBe(wgsl.placeholder);
    expect(store.get(wgsl.placeholder)?.original).toBe("fn a2() {}");
    expect(store.of("/app/a.wgsl?raw")).toEqual(again);

    store.clear("/app/a.wgsl?raw");
    expect(store.of("/app/a.wgsl?raw")).toBeUndefined();
    expect(store.get(wgsl.placeholder)).toBeUndefined();
    expect(store.get(other.placeholder)).toEqual(other);
  });
});

describe("substitutePlaceholders", () => {
  const a = placeholderFor("a");
  const b = placeholderFor("b");
  const unknown = placeholderFor("unknown");
  const code = `const x = "${a}";\nconst y = \`${a}\` + '${b}';\nconst z = "${unknown}";\nconst after = 1;\n`;
  const texts = new Map([
    [a, "fn a() {\n  return;\n}"],
    [b, "fn b() {}"],
  ]);

  it("replaces every known placeholder, escaped, and leaves unknown ones", () => {
    const result = substitutePlaceholders(code, (p) => texts.get(p), false)!;
    expect(result.map).toBeNull();
    expect(result.code).toContain(unknown);
    expect(result.code).not.toContain(a);
    const values = vm.runInNewContext(result.code.replace(/const /g, "var ") + "({ x, y })") as { x: string; y: string };
    expect(values.x).toBe(texts.get(a));
    expect(values.y).toBe(texts.get(a)! + texts.get(b)!);
    // No line moved
    expect(result.code.split("\n").length).toBe(code.split("\n").length);
  });

  it("returns a source map that keeps positions after a replaced placeholder", () => {
    const result = substitutePlaceholders(code, (p) => texts.get(p), true)!;
    const map = { mappings: result.map!.mappings, sources: ["code.js"] };
    // The single-quoted literal after the replaced one on line 2, and line 4
    for (const needle of [`'`, "const after"]) {
      const generated = positionOf(result.code, result.code.indexOf(needle));
      const original = positionOf(code, code.indexOf(needle));
      expect(originalPositionFor(map, generated.line, generated.column)).toEqual({ source: "code.js", ...original });
    }
  });

  it("returns null when there is nothing to replace", () => {
    expect(substitutePlaceholders("const x = 1;", () => "x", true)).toBeNull();
    expect(substitutePlaceholders(`"${unknown}"`, () => undefined, true)).toBeNull();
  });
});

describe("report warnings", () => {
  const unproven = (name: string, action: string): Doubt => ({
    name,
    space: "member",
    rule: "unproven-access",
    files: ["a.wgsl"],
    sites: [{ file: "a.wgsl", line: 3, column: 9 }],
    reason: `an access to \`.${name}\` could not be proven to read a struct the project declares: it is not`,
    action,
  });

  it("groups names by cause: one warning per action", () => {
    const warnings = doubtWarnings([
      unproven("color", "assign the value to a `let`"),
      unproven("size", "assign the value to a `let`"),
      unproven("mass", "declare `M` in a project file"),
    ]);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("Kept 2 WGSL struct fields as written because renaming them could not be proven safe:");
    expect(warnings[0]).toContain("  - `.color`, struct field: an access to `.color` could not be proven");
    expect(warnings[0]).toContain("(a.wgsl:3:9)");
    expect(warnings[0]).toContain("To rename them: assign the value to a `let`.");
    expect(warnings[1]).toContain("Kept 1 WGSL struct field as written");
  });

  it("does not tell the reader to add `?raw` to a module that already has it", () => {
    const raw = unrecognisedWarning(["shaders/a.wgsl?raw"]);
    expect(raw).toContain("Left 1 module as it is although `include` matches it: shaders/a.wgsl?raw.");
    expect(raw).toContain("shaders/a.wgsl?raw is already imported with `?raw`, so another plugin changed it before this one ran.");
    expect(raw).not.toContain("import it with `?raw`");
    const plain = unrecognisedWarning(["shaders/b.wgsl"]);
    expect(plain).toContain("If it is WGSL, import it with `?raw`");
    expect(plain).not.toContain("already imported");
    const both = unrecognisedWarning(["shaders/a.wgsl?raw", "shaders/b.wgsl"]);
    expect(both).toContain("If shaders/b.wgsl is WGSL, import it with `?raw`");
    expect(both).toContain("shaders/a.wgsl?raw is already imported with `?raw`");
  });
});

describe("fail", () => {
  const ctx = { error: (error: unknown) => { throw error; } } as unknown as BuildContext;
  const count = (text: string, part: string) => text.split(part).length - 1;

  it("adds each hint once when the same error passes through twice", () => {
    const error = new ObfuscateError("a.wgsl", 1, 1, "`#` is not WGSL.");
    for (let i = 0; i < 2; i++) expect(() => fail(ctx, error, "Leave it out of `include`.")).toThrow(error);
    expect(count(error.message, "Leave it out of `include`.")).toBe(1);

    const verify = new VerifyError("a.wgsl", "token 1", "a name moved");
    for (let i = 0; i < 2; i++) expect(() => fail(ctx, verify)).toThrow(verify);
    expect(count(verify.message, "To build in the meantime")).toBe(1);
  });
});
