import { tokenize, isGap } from "@/wgsl/tokenizer";

// Reading names out of WGSL text, and stand-ins for syntax newer than the plugin.

/** Identifier texts of `src`, in order. */
export function identifiers(src: string): string[] {
  return tokenize(src).filter((t) => t.type === "ident").map((t) => t.value);
}

/** How often `name` appears as an identifier in `src`. */
export function count(src: string, name: string): number {
  return identifiers(src).filter((n) => n === name).length;
}

/** Member names: every identifier right after `.`. */
export function members(src: string): string[] {
  const toks = tokenize(src).filter((t) => !isGap(t));
  return toks.filter((t, i) => t.type === "ident" && toks[i - 1]?.value === ".").map((t) => t.value);
}

/** Every identifier that is not right after `.`. */
export function nonMembers(src: string): string[] {
  const toks = tokenize(src).filter((t) => !isGap(t));
  return toks.filter((t, i) => t.type === "ident" && toks[i - 1]?.value !== ".").map((t) => t.value);
}

/**
 * Run `fn` with `names` taken off a grammar list, then put them back. Stands
 * in for a word that WGSL adds after the plugin's release.
 */
export async function without<T>(list: Set<string>, names: string[], fn: () => T | Promise<T>): Promise<T> {
  const removed = names.filter((name) => list.delete(name));
  try {
    return await fn();
  } finally {
    for (const name of removed) list.add(name);
  }
}
