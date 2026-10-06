import { describe, it, expect } from "vitest";
import {
  BUILTINS,
  BUILTIN_MEMBERS,
  CONTEXT_NAMES,
  ENUMERANTS,
  EXTENSION_PREDECLARED,
  KEYWORDS,
  RESERVED,
  attributeArguments,
  isPredeclared,
} from "@/wgsl/grammar";
import { nagaErrors, tintErrors } from "@tests/helpers/compilers";
import { hasCorpus } from "@tests/helpers/corpus/files";
import { nagaReserved, nagaWords, tintWords } from "@tests/helpers/corpus/definitions";
import type { CompilerWords } from "@tests/helpers/corpus/definitions";

// A word missing from the grammar lists can get a builtin renamed, so the lists are checked
// against the compilers' definition files (`yarn corpus:fetch`) and the installed compilers.

/** Words of `set` that `has` rejects, sorted, for a readable failure. */
function missing(set: Set<string>, has: (word: string) => boolean): string[] {
  return [...set].filter((word) => !has(word)).sort();
}

const extensionWords = new Set(EXTENSION_PREDECLARED.flatMap(({ words }) => [...words]));
const knownAttribute = (name: string) => attributeArguments(name) !== "unknown";

/** Which plugin list each kind of compiler word must be on. */
const EXPECTATIONS: [keyof CompilerWords, string, (word: string) => boolean][] = [
  ["functions", "BUILTINS", (w) => BUILTINS.has(w) && isPredeclared(w)],
  ["types", "BUILTINS", (w) => BUILTINS.has(w) && isPredeclared(w)],
  ["enumerants", "ENUMERANTS or EXTENSION_PREDECLARED", (w) => ENUMERANTS.has(w) || extensionWords.has(w)],
  ["builtinValues", "CONTEXT_NAMES", (w) => CONTEXT_NAMES.has(w) && BUILTINS.has(w)],
  ["interpolation", "CONTEXT_NAMES", (w) => CONTEXT_NAMES.has(w) && BUILTINS.has(w)],
  ["attributes", "an attribute list", knownAttribute],
  ["constants", "ENUMERANTS", (w) => ENUMERANTS.has(w)],
  ["members", "BUILTIN_MEMBERS", (w) => BUILTIN_MEMBERS.has(w)],
];

describe.skipIf(!hasCorpus)("the lists cover the compilers' definition files", () => {
  const compilers: [string, () => CompilerWords][] = [
    ["Tint", tintWords],
    ["naga", nagaWords],
  ];
  for (const [compiler, words] of compilers) {
    describe(compiler, () => {
      it.each(EXPECTATIONS)("every entry of %s is on %s", (kind, _, has) => {
        expect(missing(words()[kind], has)).toEqual([]);
      });
    });
  }

  it("the reserved words are naga's", () => {
    const naga = nagaReserved();
    expect(missing(naga, (w) => RESERVED.has(w))).toEqual([]);
    expect(missing(RESERVED, (w) => naga.has(w))).toEqual([]);
  });
});

describe("the lists agree with the installed compilers", () => {
  /** The quoted words after "Possible values:" in a Tint error. */
  async function tintPossibleValues(source: string): Promise<Set<string> | null> {
    const errors = await tintErrors(source);
    if (errors === null) return null;
    const line = errors.join("\n").match(/Possible values: (.*)/)?.[1];
    if (!line) throw new Error(`Tint listed no possible values for:\n${source}\n${errors.join("\n")}`);
    return new Set([...line.matchAll(/'([^']+)'/g)].map((m) => m[1]));
  }

  it.each([
    ["builtin value", `@fragment fn f(@builtin(unknown_value) p: vec4f) {}`, (w: string) => CONTEXT_NAMES.has(w)],
    ["attribute", `@unknown_attribute fn f() {}`, knownAttribute],
    ["interpolation type", `@fragment fn f(@location(0) @interpolate(unknown_type) p: vec4f) {}`, (w: string) => CONTEXT_NAMES.has(w)],
    [
      "interpolation sampling",
      `@fragment fn f(@location(0) @interpolate(perspective, unknown_sampling) p: vec4f) {}`,
      (w: string) => CONTEXT_NAMES.has(w),
    ],
  ])("every %s Tint knows is on the lists", async (_, source, has) => {
    const words = await tintPossibleValues(source);
    if (words === null) return;
    expect(words.size).toBeGreaterThan(0);
    expect(missing(words, has)).toEqual([]);
  });

  // The validator rejects a reserved word that is not a keyword, so no compiler may accept one
  it("both compilers reject every reserved word as a name", async () => {
    const accepted: string[] = [];
    for (const word of RESERVED) {
      const source = `const ${word} = 1;`;
      if (nagaErrors(source) === null) accepted.push(`${word} (naga)`);
      const tint = await tintErrors(source);
      if (tint !== null && tint.length === 0) accepted.push(`${word} (Tint)`);
    }
    expect(accepted).toEqual([]);
  });

  it("naga takes a cooperative matrix role only with the extension and its types", () => {
    for (const { extension, uses, words } of EXTENSION_PREDECLARED) {
      for (const type of uses) {
        for (const word of words) {
          const use = `fn f() { var m: ${type}<f32, ${word}>; }`;
          expect(nagaErrors(use), `${word} without the extension`).not.toBeNull();
          expect(nagaErrors(`enable ${extension};\n${use}`), `${word} with the extension`).toBeNull();
        }
      }
    }
  });

  it("every keyword is a reserved word", () => {
    expect(missing(KEYWORDS, (w) => RESERVED.has(w))).toEqual([]);
  });
});
