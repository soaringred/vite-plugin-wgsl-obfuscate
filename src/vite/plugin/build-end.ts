import { obfuscateProject } from "@/engine/obfuscate";
import type { ObfuscateOptions, ProjectResult } from "@/engine/obfuscate";
import { findPlaceholders } from "@/vite/placeholders";
import type { Slot } from "@/vite/placeholders";
import { renamedUses } from "@/vite/bundle";
import { checkCalls } from "@/vite/calls/check";
import { bareLeakMessage, bareWarning, doubtWarnings, unrecognisedWarning } from "@/vite/report";
import { buildKey, emptyOutput } from "@/vite/plugin/context";
import type { BuildContext, EnvironmentState } from "@/vite/plugin/context";
import { PLUGIN_NAME, fail } from "@/vite/plugin/errors";
import { fileOf } from "@/vite/plugin/modules";

// `buildEnd`: obfuscate the project and resolve every placeholder for `renderChunk`. Then check the WGSL that
// the plugin knows is WGSL but does not obfuscate with the project: literals handed to shader calls, and
// modules obfuscated alone. Renaming never waits for these; a name they use fails the build instead.

/** What `buildEnd` reads from the plugin instance (plugin.ts). */
export interface BuildEndSetup {
  /** The plugin's options less its own: the engine's options. */
  engineOptions: ObfuscateOptions;
  stateOf: (ctx: BuildContext) => EnvironmentState;
  displayOf: (id: string) => string;
  leakCheck: "off" | "warn" | "error";
  /** Names the leak check ignores. */
  ignored: ReadonlySet<string>;
}

/** The `buildEnd` of one plugin instance. */
export function createBuildEnd({
  engineOptions,
  stateOf,
  displayOf,
  leakCheck,
  ignored,
}: BuildEndSetup): (ctx: BuildContext) => void {
  /** Every WGSL module in the graph that still carries its placeholder, by file name (plus query if two share a file). */
  function collectProject(state: EnvironmentState, ids: string[], codeOf: Map<string, string | null>): Map<string, Slot> {
    const project = new Map<string, Slot>();
    for (const id of ids) {
      const slot = state.store.of(id);
      if (!slot) continue;
      const code = codeOf.get(id);
      if (typeof code === "string" && !code.includes(slot.placeholder)) continue;
      let file = displayOf(fileOf(id));
      if (project.has(file)) file = displayOf(id);
      if (project.has(file)) file = id;
      project.set(file, slot);
    }
    return project;
  }

  /** The leak check's findings in the graph: `broken` fail the build (warn under "warn"), `notes` warn. */
  function leaks(state: EnvironmentState, ids: string[], renamed: ReadonlySet<string>) {
    const broken: string[] = [];
    const notes: string[] = [];
    if (leakCheck === "off" || renamed.size === 0) return { broken, notes };
    const isRenamed = (name: string) => renamed.has(name);

    const modules = ids.filter((id) => state.calls.has(id)).sort((a, b) => (displayOf(a) < displayOf(b) ? -1 : 1));
    const calls = checkCalls(modules.flatMap((id) => state.calls.get(id)!), isRenamed);
    if (calls.broken) broken.push(calls.broken);
    if (calls.unchecked) notes.push(calls.unchecked);

    const bare: string[] = [];
    for (const id of ids) {
      const text = state.bare.get(id);
      const uses = text === undefined ? [] : renamedUses(text, isRenamed);
      if (uses.length > 0) bare.push(`  - ${displayOf(fileOf(id))}: ${uses.join(", ")}`);
    }
    if (bare.length > 0) broken.push(bareLeakMessage(bare, PLUGIN_NAME));
    return { broken, notes };
  }

  function buildEnd(ctx: BuildContext): void {
    const state = stateOf(ctx);
    const output = emptyOutput();
    state.last = output;
    const key = buildKey(ctx);
    if (key) state.builds.set(key, output);

    const ids = [...ctx.getModuleIds()];
    const codeOf = new Map<string, string | null>();
    for (const id of ids) {
      const info = ctx.getModuleInfo(id);
      codeOf.set(id, info && !info.isExternal ? info.code : null);
    }

    // A placeholder this plugin did not make comes from a transform cache it never saw
    for (const id of ids) {
      for (const { placeholder } of findPlaceholders(codeOf.get(id) ?? "")) {
        if (state.store.get(placeholder)) continue;
        ctx.error(
          `${displayOf(id)} contains the placeholder ${placeholder}, which this build of ${PLUGIN_NAME} did not make. ` +
            "It most likely comes from a transform result that another process cached. Clear the build cache and " +
            "build again.",
        );
      }
    }

    // Modules the plugin could not bind late
    const inGraph = new Set(ids);
    const bare = [...state.bare.keys()].filter((id) => inGraph.has(id)).map(displayOf).sort();
    const unrecognised = [...state.unrecognised].filter((id) => inGraph.has(id)).map(displayOf).sort();
    const notices = [
      ...(bare.length > 0 ? [bareWarning(bare, PLUGIN_NAME)] : []),
      ...(unrecognised.length > 0 ? [unrecognisedWarning(unrecognised)] : []),
    ];
    if (engineOptions.strict && notices.length > 0) ctx.error(`WGSL obfuscation (strict): ${notices.join("\n\n")}`);

    const project = collectProject(state, ids, codeOf);
    const files = Object.fromEntries([...project].map(([file, slot]) => [file, slot.original]));

    const warnings: string[] = [];
    if (project.size > 0) {
      let result: ProjectResult;
      try {
        result = obfuscateProject(files, engineOptions);
      } catch (error) {
        fail(ctx, error);
      }
      for (const [file, slot] of project) output.resolved.set(slot.placeholder, result.files[file]);
      const renamed = [...result.report.moduleMap.keys(), ...result.report.memberMap.keys()];
      output.renamed = new Set(renamed.filter((name) => !ignored.has(name)));
      warnings.push(...doubtWarnings(result.report.doubts));
    }

    // Every other placeholder stands for its original text
    for (const id of ids) {
      const slot = state.store.of(id);
      if (slot && !output.resolved.has(slot.placeholder)) {
        output.resolved.set(slot.placeholder, slot.original);
      }
    }

    const { broken, notes } = leaks(state, ids, output.renamed);
    for (const message of [...warnings, ...notices, ...notes]) ctx.warn(message);
    if (broken.length > 0 && leakCheck === "error") ctx.error(broken.join("\n\n"));
    for (const message of broken) ctx.warn(message);
  }

  return buildEnd;
}
