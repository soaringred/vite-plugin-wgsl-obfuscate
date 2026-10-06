import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { randomBytes } from "node:crypto";
import vm from "node:vm";
import type { Plugin } from "vite";
import { wgslObfuscate, type PluginOptions } from "@/index";

// Real builds of the apps in tests/fixtures/plugin-apps on every Vite in the peer range,
// with `write: false`. Watch builds write, so they work on a copy under tests/.tmp.

export const VITE_LINES = ["vite-8", "vite-7", "vite-6", "vite-5"] as const;
export type ViteLine = (typeof VITE_LINES)[number];

/** True when the line has the environment API (`createBuilder`, `this.environment`): Vite 6 and later. */
export function hasEnvironments(line: ViteLine): boolean {
  return line !== "vite-5";
}

/** The `build` key for bundler options: Vite 8 reads `rolldownOptions`, earlier lines `rollupOptions`. */
function bundlerKey(line: ViteLine): "rolldownOptions" | "rollupOptions" {
  return line === "vite-8" ? "rolldownOptions" : "rollupOptions";
}

export const APPS_DIR = join(__dirname, "..", "..", "fixtures", "plugin-apps");
const TMP_DIR = join(__dirname, "..", "..", ".tmp");

type Vite = typeof import("vite");

async function loadVite(line: ViteLine): Promise<Vite> {
  switch (line) {
    case "vite-8":
      return await import("vite");
    case "vite-7":
      return (await import("vite-7")) as unknown as Vite;
    case "vite-6":
      return (await import("vite-6")) as unknown as Vite;
    case "vite-5":
      return (await import("vite-5")) as unknown as Vite;
  }
}

/** The version of Vite that a line loads. */
export async function viteVersion(line: ViteLine): Promise<string> {
  return (await loadVite(line)).version;
}

export interface BuildOptions {
  /** Options for the plugin under test. */
  plugin?: PluginOptions;
  /** An instance of the plugin under test to use instead of a new one; `plugin` is then ignored. */
  instance?: Plugin;
  /** Entry module, relative to the app. Default "main.js". */
  entry?: string;
  minify?: boolean;
  sourcemap?: boolean;
  /** Plugins listed before the plugin under test. With `enforce: "post"` their hooks run before its hooks. */
  before?: Plugin[];
  /** Plugins listed after the plugin under test. */
  after?: Plugin[];
  /** Plugins for worker bundles (`worker.plugins`). */
  workerPlugins?: () => Plugin[];
  /** More `build` options, e.g. `assetsInlineLimit`. */
  build?: Record<string, unknown>;
  /** `output` options, one object or several outputs. */
  output?: Record<string, unknown> | Record<string, unknown>[];
}

export interface OutputFile {
  fileName: string;
  type: "chunk" | "asset";
  /** A chunk's code, or an asset's text. */
  text: string;
  isEntry: boolean;
  map?: { mappings: string; sources: string[] } | null;
}

export interface BuiltApp {
  /** Every chunk and asset of every output. */
  files: OutputFile[];
  /** The build's warnings, one message each, without colours. */
  warnings: string[];
}

/** Warnings from the plugin under test, without the `[plugin ...]` prefix. */
export function pluginWarnings(app: BuiltApp): string[] {
  return app.warnings
    .filter((w) => w.includes("[plugin vite-plugin-wgsl-obfuscate]"))
    .map((w) => w.replace(/^.*?\[plugin vite-plugin-wgsl-obfuscate\]\s*/s, ""));
}

/** Terminal colour codes. */
const ANSI = /\u001b\[[0-9;]*m/g;

/** A logger that records warnings and prints nothing. Errors reach the caller as the build's rejection. */
function recordingLogger(vite: Vite, warnings: string[]) {
  const logger = vite.createLogger("warn", { allowClearScreen: false });
  return {
    ...logger,
    info: () => {},
    warn: (message: string) => void warnings.push(message.replace(ANSI, "")),
    warnOnce: (message: string) => void warnings.push(message.replace(ANSI, "")),
    error: () => {},
  };
}

function inlineConfig(
  line: ViteLine,
  vite: Vite,
  root: string,
  options: BuildOptions,
  warnings: string[],
  extra: Record<string, unknown> = {},
) {
  const input = join(root, options.entry ?? "main.js");
  const bundlerOptions = { input, ...(options.output ? { output: options.output } : {}) };
  return {
    root,
    configFile: false as const,
    logLevel: "warn" as const,
    customLogger: recordingLogger(vite, warnings),
    plugins: [...(options.before ?? []), options.instance ?? wgslObfuscate(options.plugin), ...(options.after ?? [])],
    ...(options.workerPlugins ? { worker: { plugins: options.workerPlugins } } : {}),
    build: {
      write: false,
      minify: options.minify ?? false,
      sourcemap: options.sourcemap ?? false,
      emptyOutDir: false,
      reportCompressedSize: false,
      ...options.build,
      ...extra,
      [bundlerKey(line)]: bundlerOptions,
    },
  };
}

type RawOutput = {
  fileName: string;
  type: "chunk" | "asset";
  code?: string;
  source?: string | Uint8Array;
  isEntry?: boolean;
  map?: { mappings: string; sources: string[] } | null;
};

function toFile(output: RawOutput): OutputFile {
  const text =
    output.type === "chunk" ? output.code! : typeof output.source === "string" ? output.source : Buffer.from(output.source!).toString("utf8");
  return { fileName: output.fileName, type: output.type, text, isEntry: !!output.isEntry, map: output.map };
}

/** Build a fixture app, by name or by absolute path. Rejects when the build fails. */
export async function buildApp(line: ViteLine, app: string, options: BuildOptions = {}): Promise<BuiltApp> {
  const vite = await loadVite(line);
  const warnings: string[] = [];
  const root = isAbsolute(app) ? app : join(APPS_DIR, app);
  const result = (await vite.build(inlineConfig(line, vite, root, options, warnings) as never)) as unknown as
    | { output: RawOutput[] }
    | { output: RawOutput[] }[];
  const outputs = Array.isArray(result) ? result : [result];
  return { files: outputs.flatMap((o) => o.output.map(toFile)), warnings };
}

/**
 * Build a fixture app in two environments at once, `client` and `ssr`, with
 * one instance of the plugin, and return the output of each.
 */
export async function buildEnvironments(
  line: ViteLine,
  app: string,
  entries: { client: string; ssr: string },
  plugin: PluginOptions = {},
): Promise<{ client: BuiltApp; ssr: BuiltApp }> {
  const vite = await loadVite(line);
  const root = join(APPS_DIR, app);
  const key = bundlerKey(line);
  const warnings: string[] = [];
  const built: Partial<Record<"client" | "ssr", BuiltApp>> = {};
  const environment = (entry: string, ssr: boolean) => ({
    build: { write: false, minify: false, ssr, [key]: { input: join(root, entry) } },
  });
  const builder = await vite.createBuilder({
    root,
    configFile: false,
    logLevel: "warn",
    customLogger: recordingLogger(vite, warnings),
    plugins: [wgslObfuscate(plugin)],
    environments: { client: environment(entries.client, false), ssr: environment(entries.ssr, true) },
    builder: {
      // Both at once, so that their hooks interleave
      buildApp: async (b: { build(environment: unknown): Promise<unknown>; environments: Record<string, unknown> }) => {
        const results = await Promise.all([b.build(b.environments.client), b.build(b.environments.ssr)]);
        results.forEach((result, i) => {
          const outputs = (Array.isArray(result) ? result : [result]) as { output: RawOutput[] }[];
          built[i === 0 ? "client" : "ssr"] = { files: outputs.flatMap((o) => o.output.map(toFile)), warnings };
        });
      },
    },
  } as never);
  await builder.buildApp();
  return built as { client: BuiltApp; ssr: BuiltApp };
}

/**
 * Several entries built at once with one plugin instance. Every `renderChunk` waits for
 * every `buildEnd`, so each build renders after the others have their results.
 */
export async function buildTogether(line: ViteLine, app: string, entries: string[], plugin: PluginOptions = {}): Promise<BuiltApp[]> {
  const instance = wgslObfuscate(plugin);
  let ended = 0;
  let release!: () => void;
  const allEnded = new Promise<void>((resolve) => (release = resolve));
  // Listed after the plugin under test: its `buildEnd` has run by then
  const countEnd: Plugin = {
    name: "test:count-build-end",
    enforce: "post",
    buildEnd() {
      if (++ended === entries.length) release();
    },
  };
  // Listed before the plugin under test: its `renderChunk` runs first
  const holdRender: Plugin = {
    name: "test:hold-render-chunk",
    enforce: "post",
    async renderChunk() {
      await allEnded;
      return null;
    },
  };
  return Promise.all(entries.map((entry) => buildApp(line, app, { entry, instance, before: [holdRender], after: [countEnd] })));
}

/** Build a fixture app that must fail, and return the error with its message without colours. */
export async function buildError(line: ViteLine, app: string, options: BuildOptions = {}): Promise<Error> {
  try {
    await buildApp(line, app, options);
  } catch (error) {
    (error as Error).message = (error as Error).message.replace(ANSI, "");
    return error as Error;
  }
  throw new Error(`the build of ${app} on ${line} succeeded, but it should have failed`);
}

/** The entry chunk. */
export function entryChunk(app: BuiltApp): OutputFile {
  const entries = app.files.filter((f) => f.type === "chunk" && f.isEntry);
  if (entries.length !== 1) throw new Error(`expected one entry chunk, found ${entries.length}`);
  return entries[0];
}

/**
 * Run a chunk as a script and return its global object, where the apps put what tests
 * read. `import.meta` gets a stub and a trailing `export {}` is dropped.
 */
export function run(chunk: OutputFile): Record<string, unknown> {
  const context = vm.createContext({ __importMeta: { url: "file:///app/assets/main.js" } });
  const script = chunk.text.replace(/\bimport\.meta\b/g, "__importMeta").replace(/^export\s*\{\s*\};?\s*$/gm, "");
  vm.runInContext(script, context);
  return context as Record<string, unknown>;
}

/** The shader texts an app put on `globalThis.shaders`. */
export function shadersOf(app: BuiltApp): Record<string, string> {
  return run(entryChunk(app)).shaders as Record<string, string>;
}

// ── Reading strings out of a chunk ──────────────────────────────────

/** The value of every string literal and template text part in `code`, parsed with the Vite line's parser. */
export async function stringsIn(line: ViteLine, code: string): Promise<string[]> {
  const vite = await loadVite(line);
  const found: string[] = [];
  const stack: unknown[] = [vite.parseAst(code)];
  while (stack.length > 0) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      stack.push(...node);
    } else if (node && typeof node === "object") {
      const n = node as { type?: string; value?: unknown };
      if (n.type === "Literal" && typeof n.value === "string") found.push(n.value);
      if (n.type === "TemplateElement") found.push((n.value as { cooked: string }).cooked);
      for (const value of Object.values(node)) if (value && typeof value === "object") stack.push(value);
    }
  }
  return found;
}

// ── Watch mode ──────────────────────────────────────────────────────

/** A writable copy of a fixture app under tests/.tmp. */
export function copyApp(app: string): { root: string; write(file: string, text: string): void; read(file: string): string; remove(): void } {
  const root = join(TMP_DIR, `${app}-${randomBytes(6).toString("hex")}`);
  mkdirSync(TMP_DIR, { recursive: true });
  cpSync(join(APPS_DIR, app), root, { recursive: true });
  return {
    root,
    write: (file, text) => writeFileSync(join(root, file), text),
    read: (file) => readFileSync(join(root, file), "utf8"),
    remove: () => rmSync(root, { recursive: true, force: true }),
  };
}

export interface WatchStep {
  /** Change files before the next rebuild. Not called for the first build. */
  change?: () => void;
  /** Check the result of the build. */
  check: (result: BuiltApp | Error) => void | Promise<void>;
}

/**
 * Build in watch mode: the first step checks the initial build, each later one changes
 * files and checks the rebuild, as the last plugin's `generateBundle` sees it.
 */
export async function watchApp(line: ViteLine, root: string, options: BuildOptions, steps: WatchStep[]): Promise<void> {
  const vite = await loadVite(line);
  let warnings: string[] = [];
  let files: OutputFile[] = [];
  const capture: Plugin = {
    name: "test:capture",
    enforce: "post",
    generateBundle(_, bundle) {
      files.push(...Object.values(bundle).map((output) => toFile(output as unknown as RawOutput)));
    },
  };
  const logged: string[] = [];
  const config = inlineConfig(line, vite, root, { ...options, after: [...(options.after ?? []), capture] }, logged, {
    watch: {},
    outDir: join(root, "dist"),
  });
  const watcher = (await vite.build(config as never)) as unknown as {
    on(event: "event", listener: (e: { code: string; error?: Error; result?: { close(): Promise<void> } }) => void): void;
    close(): Promise<void>;
  };

  try {
    await new Promise<void>((resolve, reject) => {
      let step = 0;
      let busy = false;
      let settled = false;
      const timer = setTimeout(() => finish(new Error(`watch build timed out at step ${step}`)), 30_000);
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(retry);
        if (error) reject(error);
        else resolve();
      };
      // A change the file watcher missed is written again
      let retry: ReturnType<typeof setInterval> | undefined;
      watcher.on("event", (event) => {
        if (event.code === "BUNDLE_END") void event.result?.close();
        if (event.code === "START") {
          clearInterval(retry);
          files = [];
          logged.length = 0;
        }
        if (event.code !== "END" && event.code !== "ERROR") return;
        if (busy || settled) return;
        busy = true;
        warnings = [...logged];
        const result: BuiltApp | Error = event.code === "ERROR" ? event.error! : { files, warnings };
        Promise.resolve(steps[step].check(result))
          .then(() => {
            step++;
            if (step === steps.length) return finish();
            // Give the file watcher a moment before changing files
            setTimeout(() => {
              busy = false;
              steps[step].change?.();
              retry = setInterval(() => steps[step].change?.(), 5_000);
            }, 300);
          })
          .catch((error: Error) => finish(error));
      });
    });
  } finally {
    await watcher.close();
  }
}
