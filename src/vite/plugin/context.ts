import type { PlaceholderStore } from "@/vite/placeholders";
import type { ShaderCall } from "@/vite/calls/check";

// The plugin context as the hooks use it, and what the plugin keeps between hooks.

/** The plugin context as Rollup (Vite 5 to 7) and Rolldown (Vite 8) both provide it. Rolldown's module info has
 * no `isExternal` and a null `code` for an external module. `environment` is missing before Vite 6. */
export interface BuildContext {
  environment?: object;
  parse(code: string): unknown;
  warn(message: string): void;
  error(error: string | Error): never;
  getModuleIds(): IterableIterator<string>;
  getModuleInfo(id: string): { code: string | null; isExternal?: boolean } | null;
  /** In `transform`: the map from the module as written to the code it receives. */
  getCombinedSourcemap?(): { mappings: string; sources: string[] };
}

/** What one build's `buildEnd` computed, for its `renderChunk` and `generateBundle`. */
export interface BuildOutput {
  /** The final text of every placeholder in the graph. */
  resolved: Map<string, string>;
  /** Names the project renamed, less `leakIgnore`: what the checks in `generateBundle` look for. */
  renamed: ReadonlySet<string>;
}

/** What the plugin keeps per build environment. It outlives a build: watch mode skips `transform` for unchanged modules. */
export interface EnvironmentState {
  /** Placeholders and the texts they stand for. */
  store: PlaceholderStore;
  /** WGSL modules obfuscated alone in `transform`, because they arrived as bare WGSL text, with that text. */
  bare: Map<string, string>;
  /** Modules that `include` matches but that are neither a string module nor WGSL text. */
  unrecognised: Set<string>;
  /** The literals each JS module hands to shader calls. */
  calls: Map<string, ShaderCall[]>;
  /** From the last `buildEnd`. */
  last: BuildOutput;
  /** From each build's `buildEnd`, by `buildKey`, where the bundler provides one. */
  builds: WeakMap<object, BuildOutput>;
}

export function emptyOutput(): BuildOutput {
  return { resolved: new Map(), renamed: new Set() };
}

/** An object that is the same in every hook of one build and differs between builds, or null. Rollup binds
 * `getModuleInfo` to each build's graph, which separates builds sharing one state before Vite 6. Rolldown
 * does not, but Vite 8 always has `this.environment`. */
export function buildKey(ctx: BuildContext): object | null {
  return typeof ctx.getModuleInfo === "function" ? ctx.getModuleInfo : null;
}
