import type { FileAnalysis, SymbolInfo } from "@/analysis/resolver";

// Types of the member proof, and `unknown` and `merge`, which every part of it builds types with.

/** Why an access is not proven, and what would prove it. */
export interface Unproven {
  reason: string;
  action: string;
}

/** A type as far as the proof needs it. A `union` is the type of a name several project files declare:
 * a use links to one of them, so a step is proven only if it is proven on every option. */
export type ProofType =
  | { kind: "struct"; file: number; symbol: number }
  | { kind: "array"; element: ProofType }
  | { kind: "ptr"; pointee: ProofType }
  | { kind: "union"; options: ProofType[] }
  | { kind: "unknown"; why: Unproven };

export interface ProofFile {
  id: string;
  analysis: FileAnalysis;
}

/** A module-scope declaration somewhere in the project. */
export interface ProjectDeclaration {
  file: number;
  symbol: SymbolInfo;
}

/** The action that proves most unproven accesses. */
export const ASSIGN_FIRST = "assign the value to a `let` with an explicit type, and access the field on that";

export function unknown(reason: string, action: string): ProofType {
  return { kind: "unknown", why: { reason, action } };
}

/** A key that is equal for equal types. */
function keyOf(type: ProofType): string {
  switch (type.kind) {
    case "struct":
      return `s${type.file}:${type.symbol}`;
    case "array":
      return `a(${keyOf(type.element)})`;
    case "ptr":
      return `p(${keyOf(type.pointee)})`;
    case "union":
      return `u(${type.options.map(keyOf).sort().join(",")})`;
    case "unknown":
      return "?";
  }
}

/** Type of something with one of `types`: unknown if any is, else the one type they share, else their union. */
export function merge(types: ProofType[]): ProofType {
  const unproven = types.find((type) => type.kind === "unknown");
  if (unproven) return unproven;
  const unique = new Map<string, ProofType>();
  for (const type of types.flatMap((t) => (t.kind === "union" ? t.options : [t]))) unique.set(keyOf(type), type);
  const options = [...unique.values()];
  return options.length === 1 ? options[0] : { kind: "union", options };
}
