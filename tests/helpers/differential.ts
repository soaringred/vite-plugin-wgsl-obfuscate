import { assert } from "vitest";
import { obfuscate, obfuscateProject } from "@/index";
import type { ObfuscateOptions, ProjectResult } from "@/index";
import { expectSameSpirv, expectValid, nagaErrors, nagaSpirv, skipTintAssertion, tintErrors } from "@tests/helpers/compilers";

// The compilers judge an output: valid wherever the input is, with the same SPIR-V.
// A project is judged per link set, the files linked together at runtime, in order.

/** Obfuscate one source that both compilers accept, and check the output on both. Returns the output. */
export async function expectSafeRename(src: string, options: ObfuscateOptions = {}): Promise<string> {
  await expectValid(src, "input");
  const out = obfuscate(src, options);
  await expectValid(out, "output");
  expectSameSpirv(src, out);
  return out;
}

/** Option sets every adversarial input runs under. */
export const OPTION_SETS: ObfuscateOptions[] = [
  {},
  { collapseWhitespace: false },
  { topLevel: "keep" },
  { wgslFnParams: "rename" },
  { prefix: "q" },
];

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/** Assert the three properties for one link set. */
export async function expectSameProgram(before: string, after: string, label = "output", nagaOnly = false): Promise<void> {
  const naga = nagaErrors(before) === null;
  const tint = nagaOnly ? null : await tintErrors(before);
  const tintAccepts = tint !== null && tint.length === 0;
  if (!naga && !tintAccepts) {
    if (tint === null) {
      skipTintAssertion("No compiler comparison: Naga rejected the input and Tint is unavailable");
      return;
    }
    assert.fail(`no compiler accepts the input (a broken test):\n${nagaErrors(before)}\n${tint.join("\n")}`);
  }
  if (naga) {
    const errors = nagaErrors(after);
    if (errors !== null) assert.fail(`naga rejects the ${label}:\n${errors}\n\n${after}`);
    let spirv: Uint8Array | null = null;
    try {
      spirv = nagaSpirv(before);
    } catch {
      // naga validates the input but cannot write SPIR-V for it
    }
    if (spirv && !sameBytes(spirv, nagaSpirv(after))) assert.fail(`the ${label} compiles to different SPIR-V:\n${after}`);
  }
  if (tintAccepts) {
    const errors = await tintErrors(after);
    if (errors && errors.length > 0) assert.fail(`Tint rejects the ${label}:\n${errors.join("\n")}\n\n${after}`);
  }
}

/**
 * Obfuscate `files` (or one source) under `options` and assert the three
 * properties for each link set (default: all files, in order).
 */
export async function expectSafe(
  files: Record<string, string> | string,
  options: ObfuscateOptions = {},
  linkSets?: string[][],
): Promise<ProjectResult> {
  const project = typeof files === "string" ? { "shader.wgsl": files } : files;
  const result = obfuscateProject(project, options);
  for (const set of linkSets ?? [Object.keys(project)]) {
    const before = set.map((id) => project[id]).join("\n");
    const after = set.map((id) => result.files[id]).join("\n");
    await expectSameProgram(before, after, `output of [${set.join(", ")}] with ${JSON.stringify(options)}`);
  }
  return result;
}

/** `expectSafe` under every option set. */
export async function expectSafeEverywhere(
  files: Record<string, string> | string,
  linkSets?: string[][],
  extra: ObfuscateOptions = {},
): Promise<void> {
  for (const options of OPTION_SETS) await expectSafe(files, { ...options, ...extra }, linkSets);
}
