import { describe, it, expect } from "vitest";
import { obfuscateProject } from "@/index";
import type { ObfuscateOptions } from "@/index";
import { nagaErrors, tintErrors } from "@tests/helpers/compilers";
import { NAGA_ONLY, corpusFiles, hasCorpus, readCorpus } from "@tests/helpers/corpus/files";
import { expectSameProgram } from "@tests/helpers/differential";

// The corpus as one project: names like `main` or `.color` are declared in many
// files, so every keep rule is decided across all of them. Skipped without the corpus.

const OPTION_SETS: ObfuscateOptions[] = [{}, { wgslFnParams: "rename", prefix: "q" }];

describe.skipIf(!hasCorpus)("the corpus as one project", () => {
  it.each(OPTION_SETS)("every file stays valid with the same SPIR-V, with %o", async (options) => {
    const accepted: Record<string, string> = {};
    for (const id of corpusFiles()) {
      const source = readCorpus(id);
      const tint = NAGA_ONLY.has(id) ? null : await tintErrors(source);
      if (nagaErrors(source) === null || (tint !== null && tint.length === 0)) accepted[id] = source;
    }
    const { files, report } = obfuscateProject(accepted, options);
    // Names shared by hundreds of files are still renamed
    expect(report.moduleMap.size).toBeGreaterThan(1000);
    expect(report.memberMap.size).toBeGreaterThan(400);
    for (const id of Object.keys(accepted)) await expectSameProgram(accepted[id], files[id], id, NAGA_ONLY.has(id));
  }, 120_000);
});
