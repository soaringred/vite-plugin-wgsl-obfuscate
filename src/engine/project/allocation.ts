import type { FileAnalysis, FunctionInfo, SymbolInfo } from "@/analysis/resolver";
import type { KeepRule } from "@/engine/project/report-types";
import type { ProjectSettings } from "@/engine/project/build-types";
import { textAt } from "@/engine/project/project-file";
import { localKeepRule } from "@/engine/project/keep-rules";

// Allocation: generated names, handed out most used first.

/** The n-th generated name: `_a` ... `_z`, `_aa`, `_ba`, ... with `prefix` instead of `_`. */
export function generatedName(n: number, prefix = "_"): string {
  let name = prefix;
  do {
    name += String.fromCharCode(97 + (n % 26));
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return name;
}

/** Hands out generated names in order, skipping every name `taken` rejects. */
export class NameSequence {
  private n = 0;

  constructor(
    private readonly prefix: string,
    private readonly taken: (name: string) => boolean,
  ) {}

  next(): string {
    for (;;) {
      const name = generatedName(this.n++, this.prefix);
      if (!this.taken(name)) return name;
    }
  }
}

/** Order for allocation: most used first, then by name. */
function byUse<T extends { name: string; uses: number }>(a: T, b: T): number {
  if (a.uses !== b.uses) return b.uses - a.uses;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** Give every name that is not kept the next name from `sequence`, most used first. */
export function allocate(
  names: string[],
  kept: Map<string, KeepRule>,
  uses: Map<string, number>,
  map: Map<string, string>,
  sequence: NameSequence,
): void {
  const ranked = names
    .filter((name) => !kept.has(name))
    .map((name) => ({ name, uses: uses.get(name) ?? 0 }))
    .sort(byUse);
  for (const { name } of ranked) map.set(name, sequence.next());
}

/** Name one function's parameters and locals, each unique in it and unlike the output name of every other
 * identifier in it, so no local captures a reference. Locals an unknown attribute could name are kept. */
export function nameLocals(
  analysis: FileAnalysis,
  fn: FunctionInfo,
  settings: ProjectSettings,
  taken: (name: string) => boolean,
  nameOf: (k: number) => string | undefined,
  localKept: Map<number, KeepRule>,
  localOut: Map<number, string>,
  onUnknown: (symbol: SymbolInfo) => boolean,
): void {
  const own = new Set(fn.locals);
  const outside = new Set<string>();
  for (let k = fn.start; k <= fn.end; k++) {
    const cls = analysis.classes[k];
    if (cls === undefined || cls === "member-decl" || cls === "member-ref") continue;
    if ((cls === "decl" || cls === "ref") && own.has(analysis.bindings[k])) continue;
    outside.add(nameOf(k) ?? textAt(analysis, k));
  }

  const uses = new Map<number, number>();
  for (let k = fn.start; k <= fn.end; k++) {
    if (own.has(analysis.bindings[k])) uses.set(analysis.bindings[k], (uses.get(analysis.bindings[k]) ?? 0) + 1);
  }

  const renamed: { id: number; name: string; uses: number; decl: number }[] = [];
  for (const id of fn.locals) {
    const symbol = analysis.symbols[id];
    let rule = localKeepRule(analysis, symbol, settings);
    if (!rule && onUnknown(symbol)) rule = "unknown-attribute";
    if (rule) localKept.set(id, rule);
    else renamed.push({ id, name: symbol.name, uses: uses.get(id) ?? 0, decl: symbol.decl });
  }
  renamed.sort((a, b) => byUse(a, b) || a.decl - b.decl);

  const sequence = new NameSequence(settings.prefix, (name) => taken(name) || outside.has(name));
  for (const { id } of renamed) localOut.set(id, sequence.next());
}
