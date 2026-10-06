import path from "node:path";
import type { Plugin } from "vite";
import { obfuscateProject } from "@/engine/obfuscate";
import type { ObfuscateOptions, ProjectResult } from "@/engine/obfuscate";
import { validate } from "@/wgsl/validate";
import { PlaceholderStore, substitutePlaceholders } from "@/vite/placeholders";
import { leftoverMessage, leftoverPlaceholders, wgslFileLeaks } from "@/vite/bundle";
import type { BundleFile } from "@/vite/bundle";
import { mayCallShader } from "@/vite/calls/lexer";
import { shaderCalls, shaderLiterals } from "@/vite/calls/find";
import { originalPositionFor, positionOf } from "@/vite/calls/source-map";
import { buildKey, emptyOutput } from "@/vite/plugin/context";
import type { BuildContext, BuildOutput, EnvironmentState } from "@/vite/plugin/context";
import { PLUGIN_NAME, fail } from "@/vite/plugin/errors";
import { fileOf, isWgsl, queryOf, stringModuleText } from "@/vite/plugin/modules";
import { createBuildEnd } from "@/vite/plugin/build-end";

// The Vite plugin: options, state per build environment, `transform` and the hooks.

export interface PluginOptions extends ObfuscateOptions {
  /** Modules to obfuscate, tested against the module id, query included. Default `/\.wgsl($|\?)/`. */
  include?: RegExp;
  /**
   * Look for renamed names in WGSL that the plugin does not obfuscate: literals handed to `wgslCalls`, modules
   * obfuscated alone, and WGSL files that ship as written. A literal or module fails the build, or warns under
   * "warn"; a file always fails. Default "error".
   */
  leakCheck?: "off" | "warn" | "error";
  /** Names the leak check ignores. */
  leakIgnore?: string[];
  /** Calls whose literal argument is WGSL, for the leak check; `[]` turns that part off. Default `["wgslFn", "wgsl", "createShaderModule"]`. */
  wgslCalls?: string[];
}

const DEFAULT_INCLUDE = /\.wgsl($|\?)/;
const DEFAULT_CALLS = ["wgslFn", "wgsl", "createShaderModule"];
/** A JS identifier. */
const JS_NAME = /^[\p{ID_Start}$_][\p{ID_Continue}$]*$/u;

// ── Helpers ─────────────────────────────────────────────────────────

function matches(pattern: RegExp, text: string): boolean {
  // A global or sticky pattern keeps state between calls
  pattern.lastIndex = 0;
  return pattern.test(text);
}

// ── Plugin ──────────────────────────────────────────────────────────

/**
 * Vite plugin that obfuscates WGSL in `vite build`; dev mode serves readable source. All WGSL modules in
 * the build form one project.
 */
export function wgslObfuscate(options: PluginOptions = {}): Plugin {
  const {
    include = DEFAULT_INCLUDE,
    leakCheck = "error",
    leakIgnore = [],
    wgslCalls = DEFAULT_CALLS,
    ...engineOptions
  } = options;

  if (!(include instanceof RegExp)) {
    throw new TypeError(`${PLUGIN_NAME}: \`include\` must be a regular expression.`);
  }
  if (leakCheck !== "off" && leakCheck !== "warn" && leakCheck !== "error") {
    throw new TypeError(`${PLUGIN_NAME}: \`leakCheck\` must be "off", "warn" or "error".`);
  }
  if (!Array.isArray(leakIgnore) || !leakIgnore.every((name) => typeof name === "string")) {
    throw new TypeError(`${PLUGIN_NAME}: \`leakIgnore\` must be an array of names.`);
  }
  if (!Array.isArray(wgslCalls) || !wgslCalls.every((name) => typeof name === "string" && JS_NAME.test(name))) {
    throw new TypeError(`${PLUGIN_NAME}: \`wgslCalls\` must be an array of function names, such as \`["wgslFn"]\`.`);
  }
  // Check the engine options now rather than at the end of the build
  obfuscateProject({}, engineOptions);

  const ignored = new Set(leakIgnore);
  const calls = leakCheck !== "off" && wgslCalls.length > 0 ? shaderCalls(wgslCalls) : null;

  let root = process.cwd();

  /** A module id as the reader knows it: relative to the root, with its query. */
  const displayOf = (id: string): string => {
    const clean = id.startsWith("\0") ? id.slice(1) : id;
    const file = fileOf(clean);
    if (!path.isAbsolute(file)) return clean;
    return path.relative(root, file).split(path.sep).join("/") + clean.slice(file.length);
  };

  // One state per environment object, not name: two concurrent builds may both be called "client".
  // Before Vite 6 there is no environment, and every build shares one state.
  const newState = (): EnvironmentState => ({
    store: new PlaceholderStore(),
    bare: new Map(),
    unrecognised: new Set(),
    calls: new Map(),
    last: emptyOutput(),
    builds: new WeakMap(),
  });
  let states = new WeakMap<object, EnvironmentState>();
  let shared: EnvironmentState | null = null;
  const stateOf = (ctx: BuildContext): EnvironmentState => {
    const environment = ctx.environment;
    if (typeof environment !== "object" || environment === null) return (shared ??= newState());
    let state = states.get(environment);
    if (!state) {
      state = newState();
      states.set(environment, state);
    }
    return state;
  };
  /** The output of the build that `ctx` belongs to. */
  const outputOf = (ctx: BuildContext): BuildOutput => {
    const state = stateOf(ctx);
    const key = buildKey(ctx);
    return (key && state.builds.get(key)) ?? state.last;
  };

  /** A module that `include` matches, imported with a query other than `?raw` (e.g. `?url`): it ships as written. */
  const shippedAsWritten = (id: string) => {
    const query = queryOf(id);
    return query !== null && query !== "raw" && matches(include, id);
  };

  // ── transform ─────────────────────────────────────────────────────

  /** `transform` of a module that `include` matches, without a query or with `?raw`. */
  function transformWgsl(ctx: BuildContext, code: string, id: string) {
    const state = stateOf(ctx);
    const display = displayOf(fileOf(id));

    const text = stringModuleText(ctx, code);
    if (text !== null) {
      try {
        validate(text, display);
      } catch (error) {
        fail(ctx, error, `To ship ${display} as written instead, leave it out of the plugin's \`include\` option.`);
      }
      state.bare.delete(id);
      state.unrecognised.delete(id);
      const slot = state.store.put(id, text);
      // Empty mappings: the shader's original text must not reach the source map
      return { code: `export default ${JSON.stringify(slot.placeholder)};\n`, map: { mappings: "" } };
    }

    state.store.clear(id);
    if (isWgsl(code)) {
      // A later plugin wraps this text, so it cannot wait for the other modules
      let result: ProjectResult;
      try {
        result = obfuscateProject({ [display]: code }, { ...engineOptions, topLevel: "keep" });
      } catch (error) {
        fail(ctx, error);
      }
      state.bare.set(id, code);
      state.unrecognised.delete(id);
      return { code: result.files[display], map: { mappings: "" } };
    }

    state.bare.delete(id);
    state.unrecognised.add(id);
    return null;
  }

  /** Record the literals a JS module hands to shader calls, for the check at `buildEnd`. Most modules never
   * mention a call, and most that do (three.js among them) call none with a literal: neither is parsed. */
  function recordCalls(ctx: BuildContext, code: string, id: string): void {
    const state = stateOf(ctx);
    state.calls.delete(id);
    if (!calls || !calls.mention.test(code) || !mayCallShader(code, calls.stops)) return;
    let ast: unknown;
    try {
      ast = ctx.parse(code);
    } catch {
      return; // Not JS: the bundler reports what it cannot read
    }
    const literals = shaderLiterals(ast, calls.names);
    if (literals.length === 0) return;
    let map: { mappings: string; sources: string[] } | undefined;
    try {
      map = ctx.getCombinedSourcemap?.();
    } catch {
      // Lines are then those of the code this plugin receives
    }
    const display = displayOf(id);
    state.calls.set(
      id,
      literals.map((literal) => {
        const at = positionOf(code, literal.offset);
        const line = (map && originalPositionFor(map, at.line, at.column)?.line) ?? at.line;
        return { ...literal, place: `${display}:${line + 1}` };
      }),
    );
  }

  // ── buildEnd ──────────────────────────────────────────────────────

  const buildEnd = createBuildEnd({ engineOptions, stateOf, displayOf, leakCheck, ignored });

  return {
    name: PLUGIN_NAME,
    apply: "build",
    enforce: "post",

    configResolved(config) {
      root = config.root;
    },

    buildStart() {
      stateOf(this as unknown as BuildContext).last = emptyOutput();
    },

    transform(code, id) {
      const ctx = this as unknown as BuildContext;
      const query = queryOf(id);
      if (matches(include, id) && (query === null || query === "raw")) {
        const result = transformWgsl(ctx, code, id);
        if (result !== null) return result;
      }
      recordCalls(ctx, code, id);
      return null;
    },

    buildEnd(error) {
      if (error) return;
      buildEnd(this as unknown as BuildContext);
    },

    renderChunk(code, _chunk, outputOptions) {
      const { resolved } = outputOf(this as unknown as BuildContext);
      return substitutePlaceholders(code, (placeholder) => resolved.get(placeholder), !!outputOptions.sourcemap);
    },

    generateBundle(_outputOptions, output) {
      const ctx = this as unknown as BuildContext;
      const state = stateOf(ctx);
      const bundle = output as unknown as Record<string, BundleFile>;

      const leftovers = leftoverPlaceholders(bundle, (placeholder) => {
        const slot = state.store.get(placeholder);
        return slot && displayOf(slot.module);
      });
      if (leftovers.length > 0) ctx.error(leftoverMessage(leftovers, PLUGIN_NAME));

      const { renamed } = outputOf(ctx);
      if (leakCheck === "off" || renamed.size === 0) return;
      const isWgslAsset = (sources: string[]) =>
        sources.some((source) => matches(include, source) || matches(include, path.resolve(root, source)));
      // A small file imported with `?url` is inlined as a data URL, which the module's code holds
      const inlined = new Map<string, string>();
      for (const id of ctx.getModuleIds()) {
        const url = shippedAsWritten(id) ? ctx.getModuleInfo(id)?.code?.match(/data:text\/wgsl[^"'`\s]*/)?.[0] : undefined;
        if (url) inlined.set(url, displayOf(fileOf(id)));
      }
      // A WGSL file breaks at runtime if it is linked, so it fails even under "warn"
      const leaks = wgslFileLeaks(bundle, (name) => renamed.has(name), isWgslAsset, (url) => inlined.get(url));
      if (leaks) ctx.error(leaks);
    },

    closeWatcher() {
      states = new WeakMap();
      shared = null;
    },
  };
}
