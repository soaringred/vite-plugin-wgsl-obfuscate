import { buildProject } from "@/engine/project";
import type { Doubt, ProjectReport, ProjectSettings } from "@/engine/project";
import { verifyBuild } from "@/engine/verify";

export type {
  ProjectReport,
  FileReport,
  KeptName,
  CrossFileLink,
  KeepRule,
  DoubtRule,
  Doubt,
  SourcePosition,
  NameSpace,
} from "@/engine/project";

export interface ObfuscateOptions {
  /** Names never renamed, in any role. */
  preserve?: string[];
  /** Rename identifiers. Default true; false only strips comments and collapses whitespace. */
  renameIdents?: boolean;
  /** Collapse whitespace. Default true. */
  collapseWhitespace?: boolean;
  /** "keep" leaves module-scope names and struct fields as written. Default "rename". */
  topLevel?: "rename" | "keep";
  /**
   * "keep" leaves the parameters of a file's leading function (a three.js `wgslFn` body) as written, since JS passes
   * arguments by those names; "rename" is safe only if every call passes them by position. Default "keep".
   */
  wgslFnParams?: "keep" | "rename";
  /** Prefix of generated names: `_` or a letter, then identifier characters, not `__`. Default "_". */
  prefix?: string;
  /** Throw a `StrictError` when a name is kept by `unproven-access` or `unknown-attribute`. Default false. */
  strict?: boolean;
  /** Run the self-checks and throw on a violation. Default true. */
  verify?: boolean;
}

export interface ProjectResult {
  /** Obfuscated sources, under the same ids as the input. */
  files: Record<string, string>;
  report: ProjectReport;
}

/** Thrown under `strict` when names were kept because renaming them could not be proven safe. */
export class StrictError extends Error {
  constructor(readonly doubts: Doubt[]) {
    const lines = doubts.map(
      (d) =>
        `  - ${d.name} (${d.space === "member" ? "struct field" : d.space === "local" ? "local" : "module scope"}, ` +
        `${d.rule}) in ${d.files.join(", ")}` +
        `${d.sites.length > 0 ? `, at ${d.sites.map((s) => `${s.file}:${s.line}:${s.column}`).join(", ")}` : ""}: ` +
        `${d.reason}. To rename it: ${d.action}.`,
    );
    super(
      `WGSL obfuscation (strict): ${doubts.length === 1 ? "1 name was" : `${doubts.length} names were`} ` +
        `kept because renaming ${doubts.length === 1 ? "it" : "them"} could not be proven safe:\n` +
        `${lines.join("\n")}\n` +
        "To accept a name as written instead, add it to `preserve`.",
    );
    this.name = "StrictError";
  }
}

/** File id that `obfuscate()` gives its source, as seen in error messages. */
const SOURCE_ID = "source";

/** `_` or a letter, then identifier characters. */
const PREFIX = /^[\p{XID_Start}_]\p{XID_Continue}*$/u;

const BOOLEAN_OPTIONS = ["renameIdents", "collapseWhitespace", "strict", "verify"] as const;

let warnedInlineConsts = false;

/** How a rejected option value reads in a message. */
function shown(value: unknown): string {
  return JSON.stringify(value) ?? String(value);
}

/** Throw unless `value` is absent or one of `allowed`, so a typo cannot fall back to the default unnoticed. */
function checkChoice(option: string, value: unknown, allowed: readonly string[]): void {
  if (value === undefined || allowed.includes(value as string)) return;
  throw new TypeError(
    `vite-plugin-wgsl-obfuscate: \`${option}\` must be ${allowed.map((a) => `"${a}"`).join(" or ")}, not ${shown(value)}.`,
  );
}

/** Apply defaults and check the options. Warns once per process about the removed `inlineConsts`. */
function settingsFrom(options: ObfuscateOptions): ProjectSettings {
  if ((options as { inlineConsts?: unknown }).inlineConsts !== undefined && !warnedInlineConsts) {
    warnedInlineConsts = true;
    console.warn(
      "vite-plugin-wgsl-obfuscate: the `inlineConsts` option was removed in 0.2.0 and is ignored; consts are now " +
        "kept and renamed. Remove the option from your config.",
    );
  }

  for (const option of BOOLEAN_OPTIONS) {
    const value: unknown = options[option];
    if (value !== undefined && typeof value !== "boolean") {
      throw new TypeError(`vite-plugin-wgsl-obfuscate: \`${option}\` must be true or false, not ${shown(value)}.`);
    }
  }
  checkChoice("topLevel", options.topLevel, ["rename", "keep"]);
  checkChoice("wgslFnParams", options.wgslFnParams, ["keep", "rename"]);

  // A bare string would be read as a set of single characters
  const preserve: unknown = options.preserve ?? [];
  if (!Array.isArray(preserve) || !preserve.every((name) => typeof name === "string")) {
    throw new TypeError(
      `vite-plugin-wgsl-obfuscate: \`preserve\` must be an array of names, such as \`["main"]\`, not ${shown(preserve)}.`,
    );
  }

  const prefix = options.prefix ?? "_";
  if (typeof prefix !== "string" || !PREFIX.test(prefix) || prefix.startsWith("__")) {
    throw new TypeError(
      `vite-plugin-wgsl-obfuscate: invalid \`prefix\` ${JSON.stringify(prefix)}. A prefix must start with \`_\` ` +
        "or a letter, contain only identifier characters, and not start with `__`.",
    );
  }

  return {
    preserve: new Set(preserve),
    renameIdents: options.renameIdents ?? true,
    collapseWhitespace: options.collapseWhitespace ?? true,
    topLevel: options.topLevel === "keep" ? "keep" : "rename",
    wgslFnParams: options.wgslFnParams === "rename" ? "rename" : "keep",
    prefix,
  };
}

/**
 * Obfuscate WGSL sources that are linked together, keyed by id (usually the path), so a shared name gets the same
 * new name in every file. WGSL outside the set that uses these names must list them in `preserve`.
 */
export function obfuscateProject(files: Record<string, string>, options: ObfuscateOptions = {}): ProjectResult {
  const build = buildProject(files, settingsFrom(options));
  if (options.verify !== false) verifyBuild(build);
  if (options.strict && build.report.doubts.length > 0) throw new StrictError(build.report.doubts);
  return {
    files: Object.fromEntries(build.files.map((file) => [file.id, file.output])),
    report: build.report,
  };
}

/** Obfuscate one WGSL source. Sources linked at runtime must go through `obfuscateProject` together. */
export function obfuscate(source: string, options: ObfuscateOptions = {}): string {
  return obfuscateProject({ [SOURCE_ID]: source }, options).files[SOURCE_ID];
}
