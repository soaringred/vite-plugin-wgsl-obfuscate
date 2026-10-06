import { describe, it, expect } from "vitest";
import { obfuscateProject } from "@/index";
import type { ObfuscateOptions } from "@/index";
import { scanModuleDeclarations } from "@/engine/verify";
import { tokenize, isGap } from "@/wgsl/tokenizer";
import { getTintDevice, nagaErrors, nagaSpirv, tintErrors } from "@tests/helpers/compilers";
import { generate } from "@tests/helpers/random/generator";

// Random programs, partly outside the project, whose fields only the member proof keeps.
// Longer runs: WGSL_RANDOM_RUNS=5000; one seed: WGSL_RANDOM_SEED=1234 WGSL_RANDOM_RUNS=1.

const RUNS = Number(process.env.WGSL_RANDOM_RUNS ?? 150);
const FIRST_SEED = Number(process.env.WGSL_RANDOM_SEED ?? 1);
const SEEDS = Array.from({ length: RUNS }, (_, i) => FIRST_SEED + i);
const hasTint = (await getTintDevice()) !== null;

const OPTION_SETS: ObfuscateOptions[] = [
  {},
  { collapseWhitespace: false },
  { topLevel: "keep" },
  { wgslFnParams: "rename" },
  { prefix: "q" },
];

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/** What is wrong with `after` as a replacement for `before`, for the compilers that accept `before`. */
async function compare(label: string, before: string, after: string): Promise<string[]> {
  const problems: string[] = [];
  if (nagaErrors(before) === null) {
    const errors = nagaErrors(after);
    if (errors !== null) {
      problems.push(`${label}: naga rejects the output:\n${errors}`);
    } else {
      let spirv: Uint8Array | null = null;
      try {
        spirv = nagaSpirv(before);
      } catch {
        // naga validates it but cannot write SPIR-V for it
      }
      if (spirv && !sameBytes(spirv, nagaSpirv(after))) problems.push(`${label}: the SPIR-V differs`);
    }
  }
  const tint = await tintErrors(before);
  if (tint !== null && tint.length === 0) {
    const errors = await tintErrors(after);
    if (errors && errors.length > 0) problems.push(`${label}: Tint rejects the output:\n${errors.join("\n")}`);
  }
  return problems;
}

async function accepted(source: string): Promise<boolean> {
  if (nagaErrors(source) === null) return true;
  const tint = await tintErrors(source);
  return tint !== null && tint.length === 0;
}

const link = (...parts: string[]) => parts.filter((p) => p !== "").join("\n");

/**
 * The names outside code declares at module scope or uses, leaving out
 * member names (after `.`) and names before `:` (fields, parameters, locals).
 */
function outsideNames(external: string): string[] {
  const toks = tokenize(external).filter((t) => !isGap(t));
  const used = toks.filter((t, i) => t.type === "ident" && toks[i - 1]?.value !== "." && toks[i + 1]?.value !== ":");
  return [...new Set([...scanModuleDeclarations(external), ...used.map((t) => t.value)])];
}

describe("random programs", () => {
  let rejected = 0;

  it.each(SEEDS)("seed %i", async (seed) => {
    const { external, source, files } = generate(seed, { statementAttributes: hasTint });
    const input = link(external, source);
    if (!(await accepted(input))) {
      // A program neither compiler accepts is a generator bug, counted below
      rejected++;
      return;
    }
    // Outside code links by name, so the names it shares with the project are preserved
    const options = { ...OPTION_SETS[seed % OPTION_SETS.length], preserve: outsideNames(external) };
    const problems: string[] = [];

    const one = obfuscateProject({ "shader.wgsl": source }, options).files["shader.wgsl"];
    problems.push(...(await compare("one file", input, link(external, one))));

    const ids = Object.keys(files);
    const out = obfuscateProject(files, options).files;
    problems.push(
      ...(await compare("three files", link(external, ...ids.map((id) => files[id])), link(external, ...ids.map((id) => out[id])))),
    );

    expect(problems, `seed ${seed}, options ${JSON.stringify(options)}:\n${input}`).toEqual([]);
    // Dawn slows down after tens of thousands of modules in one process
  }, 60_000);

  it("the generator writes valid WGSL", () => {
    // More than a few rejected programs would mean the test checks little
    expect(rejected).toBeLessThanOrEqual(Math.ceil(RUNS * 0.02));
  });
});
