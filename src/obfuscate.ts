import type { Token } from "./tokenizer";
import { tokenize, extractEntryPoints } from "./tokenizer";
import { buildRenameMap, inlineConsts } from "./transforms";

export interface ObfuscateOptions {
  /** Identifiers to preserve from renaming */
  preserve?: string[];
  /** Rename user-defined identifiers (default: true) */
  renameIdents?: boolean;
  /** Collapse whitespace (default: true) */
  collapseWhitespace?: boolean;
  /** Inline const declarations at usage sites (default: true) */
  inlineConsts?: boolean;
}

const DEFAULTS: Required<Omit<ObfuscateOptions, "preserve">> = {
  renameIdents: true,
  collapseWhitespace: true,
  inlineConsts: true,
};

/**
 * Obfuscate a WGSL source string.
 *
 * Entry points (@compute, @vertex, @fragment functions) are automatically
 * detected and preserved. Additional identifiers can be preserved via options.
 *
 * Can be used standalone (without the Vite plugin) for CLI tools,
 * Webpack loaders, or any other build pipeline.
 */
export function obfuscate(src: string, options: ObfuscateOptions = {}): string {
  const flags = { ...DEFAULTS, ...options };

  // Strip comments as a first pass so no downstream transform has to
  // reason about them. Comments carry no semantic weight and have no place
  // in obfuscated output.
  let tokens = tokenize(src).filter((t) => t.type !== "comment");

  // Auto-detect entry points and merge with manual preserve list
  const entryPoints = extractEntryPoints(tokens);
  const preserve = new Set([...(options.preserve ?? []), ...entryPoints]);

  // Inline const declarations before renaming
  if (flags.inlineConsts) {
    tokens = inlineConsts(tokens);
  }

  // Build rename map
  const renameMap = flags.renameIdents
    ? buildRenameMap(tokens, preserve)
    : new Map<string, string>();

  // Rebuild source with transforms applied
  let out = "";
  let prevType: Token["type"] | null = null;

  for (const tok of tokens) {
    if (tok.type === "whitespace") {
      if (flags.collapseWhitespace) {
        if (
          prevType === "ident" ||
          prevType === "number" ||
          prevType === "attribute"
        ) {
          out += " ";
        }
      } else {
        out += tok.value;
      }
      prevType = tok.type;
      continue;
    }

    if (tok.type === "ident") {
      out += renameMap.get(tok.value) ?? tok.value;
      prevType = tok.type;
      continue;
    }

    out += tok.value;
    prevType = tok.type;
  }

  return out;
}
