import { createHash } from "node:crypto";
import MagicString from "magic-string";
import type { SourceMap } from "magic-string";

// Names depend on every module, so `transform` writes a placeholder and `renderChunk` puts the final text
// in its place. A placeholder derives from the module id, so a module cached in watch mode still matches,
// and holds identifier characters only, so it survives until `renderChunk` as one piece of a string literal.

export const PLACEHOLDER_PREFIX = "__WGSL_OBFUSCATE_";

/** A whole placeholder: the prefix, 32 lowercase hex digits, `__`. */
const PLACEHOLDER = /__WGSL_OBFUSCATE_[0-9a-f]{32}__/g;

/** The shader module that a placeholder stands for. */
export interface Slot {
  placeholder: string;
  /** Id of the module whose code carries the placeholder. */
  module: string;
  /** The text the placeholder replaced, exactly as it was. */
  original: string;
}

/** The same module id gives the same placeholder across watch builds. */
export function placeholderFor(module: string): string {
  const hash = createHash("sha256").update(module).digest("hex");
  return `${PLACEHOLDER_PREFIX}${hash.slice(0, 32)}__`;
}

/** Every placeholder in `text`, in order, with its offsets. */
export function findPlaceholders(text: string): { placeholder: string; start: number; end: number }[] {
  if (!text.includes(PLACEHOLDER_PREFIX)) return [];
  const found: { placeholder: string; start: number; end: number }[] = [];
  for (const match of text.matchAll(PLACEHOLDER)) {
    found.push({ placeholder: match[0], start: match.index, end: match.index + match[0].length });
  }
  return found;
}

/** `text` with every placeholder in it replaced by `replace(placeholder)`. */
export function replacePlaceholders(text: string, replace: (placeholder: string) => string): string {
  if (!text.includes(PLACEHOLDER_PREFIX)) return text;
  return text.replace(PLACEHOLDER, replace);
}

/** Slots of one build environment. It outlives a build: in watch mode an unchanged module is not transformed again. */
export class PlaceholderStore {
  private readonly slots = new Map<string, Slot>();
  private readonly byModule = new Map<string, Slot>();

  /** Store a module's shader text, replacing the text from an earlier transform. */
  put(module: string, original: string): Slot {
    const slot: Slot = { placeholder: placeholderFor(module), module, original };
    this.byModule.set(module, slot);
    this.slots.set(slot.placeholder, slot);
    return slot;
  }

  /** Forget a module that no longer exports a shader string. */
  clear(module: string): void {
    const slot = this.byModule.get(module);
    if (!slot) return;
    this.slots.delete(slot.placeholder);
    this.byModule.delete(module);
  }

  get(placeholder: string): Slot | undefined {
    return this.slots.get(placeholder);
  }

  of(module: string): Slot | undefined {
    return this.byModule.get(module);
  }
}

/** `text` escaped to mean the same between any quotes or backticks (hence `$`), and to stay on one line. */
export function escapeForStringLiteral(text: string): string {
  let out = "";
  for (const char of text) {
    switch (char) {
      case "\\":
      case '"':
      case "'":
      case "`":
      case "$":
        out += `\\${char}`;
        break;
      case "\n":
        out += "\\n";
        break;
      case "\r":
        out += "\\r";
        break;
      case "\t":
        out += "\\t";
        break;
      default: {
        const code = char.codePointAt(0)!;
        const escape =
          code < 0x20 ||
          (code >= 0x7f && code <= 0x9f) ||
          code === 0x2028 ||
          code === 0x2029 ||
          (code >= 0xd800 && code <= 0xdfff);
        out += escape ? `\\u${code.toString(16).padStart(4, "0")}` : char;
      }
    }
  }
  return out;
}

/** Replace each placeholder `resolve` knows with its escaped text; unknown ones stay for the leftover check. */
export function substitutePlaceholders(
  code: string,
  resolve: (placeholder: string) => string | undefined,
  sourcemap: boolean,
): { code: string; map: SourceMap | null } | null {
  const found = findPlaceholders(code);
  if (found.length === 0) return null;
  const s = new MagicString(code);
  for (const { placeholder, start, end } of found) {
    const text = resolve(placeholder);
    if (text !== undefined) s.overwrite(start, end, escapeForStringLiteral(text));
  }
  if (!s.hasChanged()) return null;
  return { code: s.toString(), map: sourcemap ? s.generateMap({ hires: "boundary" }) : null };
}
