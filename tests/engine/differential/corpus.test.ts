import { describe, it, expect } from "vitest";
import { existsSync } from "fs";
import { join } from "path";
import { obfuscate, ObfuscateError, VerifyError } from "@/index";
import type { ObfuscateOptions } from "@/index";
import { nagaErrors, nagaSpirv, tintErrors } from "@tests/helpers/compilers";
import { CORPUS_DIR, NAGA_ONLY, corpusFiles, hasCorpus, readCorpus } from "@tests/helpers/corpus/files";

// WGSL written by other people (`yarn corpus:fetch`); skipped without it. What a
// compiler accepts, the plugin accepts, and the output compiles to the same SPIR-V.

const OPTION_SETS: [string, ObfuscateOptions][] = [
  ["defaults", {}],
  ["collapseWhitespace: false", { collapseWhitespace: false }],
  ['topLevel: "keep"', { topLevel: "keep" }],
  ['wgslFnParams: "rename"', { wgslFnParams: "rename" }],
  ['prefix: "e"', { prefix: "e" }],
];

/** Files not checked, with the reason. A compiler that rejects an extension is not one. */
const SKIPPED: Record<string, string> = {};

const files = hasCorpus ? corpusFiles() : [];

/** Files at least one compiler accepts, and files naga compiles to SPIR-V, as the suite runs. */
const counts = { checked: 0, accepted: 0, spirv: 0 };

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** Everything wrong with the plugin's handling of one corpus file. */
async function problemsWith(source: string, nagaOnly = false): Promise<string[]> {
  const nagaAccepts = nagaErrors(source) === null;
  const tint = nagaOnly ? null : await tintErrors(source);
  const tintAccepts = tint !== null && tint.length === 0;

  let spirv: Uint8Array | null = null;
  if (nagaAccepts) {
    try {
      spirv = nagaSpirv(source);
    } catch {
      // naga validates the input but cannot write SPIR-V for it
    }
  }

  counts.checked++;
  if (nagaAccepts || tintAccepts) counts.accepted++;
  if (spirv) counts.spirv++;

  const problems: string[] = [];
  for (const [label, options] of OPTION_SETS) {
    let output: string;
    try {
      output = obfuscate(source, options);
    } catch (error) {
      if (nagaAccepts || tintAccepts) {
        problems.push(`${label}: the plugin refuses input that ${nagaAccepts ? "naga" : "Tint"} accepts: ${describeError(error)}`);
      } else if (!(error instanceof ObfuscateError || error instanceof VerifyError)) {
        problems.push(`${label}: the plugin crashed on invalid input: ${describeError(error)}`);
      }
      continue;
    }

    if (nagaAccepts) {
      const errors = nagaErrors(output);
      if (errors !== null) {
        problems.push(`${label}: naga rejects the output:\n${errors}`);
      } else if (spirv) {
        const after = nagaSpirv(output);
        const same = after.length === spirv.length && after.every((byte, i) => byte === spirv![i]);
        if (!same) problems.push(`${label}: the output compiles to different SPIR-V`);
      }
    }
    if (tintAccepts) {
      const errors = await tintErrors(output);
      if (errors && errors.length > 0) problems.push(`${label}: Tint rejects the output:\n${errors.join("\n")}`);
    }
  }
  return problems;
}

describe.skipIf(!hasCorpus)("corpus", () => {
  it("has files in every folder", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("lists only skipped files that exist", () => {
    for (const id of Object.keys(SKIPPED)) expect(existsSync(join(CORPUS_DIR, id)), id).toBe(true);
  });

  it.each(files.filter((id) => !(id in SKIPPED)))("%s", async (id) => {
    expect(await problemsWith(readCorpus(id), NAGA_ONLY.has(id))).toEqual([]);
  });

  it("checks most files against a compiler", () => {
    // A corpus that compilers stopped accepting would check nothing
    expect(counts.checked).toBe(files.length - Object.keys(SKIPPED).length);
    expect(counts.accepted).toBeGreaterThan(counts.checked * 0.9);
    expect(counts.spirv).toBeGreaterThan(counts.checked * 0.8);
  });
});
