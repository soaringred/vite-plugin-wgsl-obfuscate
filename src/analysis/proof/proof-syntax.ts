import type { Token } from "@/wgsl/tokenizer";
import { RESERVED } from "@/wgsl/grammar";
import type { ProofFile } from "@/analysis/proof/proof-types";

// The syntax the member proof reads: tokens, bracket partners, access chains, template lists
// and written types. Nothing here looks up what a name refers to.

/** A parsed type: a name, with template arguments when it has a `<...>` list. */
export interface TypeNode {
  /** Significant-token index of the name. */
  k: number;
  /** Template arguments; null for an argument that is not a type, e.g. `4`. */
  args: (TypeNode | null)[] | null;
}

export class ProofSyntax {
  /** Bracket partner of every `(`, `)`, `[`, `]`, `{`, `}` per file; -1 otherwise. */
  private readonly matches: number[][] = [];
  /** `chainStart` answers per file, by the position asked about or passed. */
  private readonly chainStarts: Map<number, number>[] = [];

  constructor(protected readonly files: ProofFile[]) {}

  // ── Tokens ────────────────────────────────────────────────────────

  private token(f: number, k: number): Token | undefined {
    const analysis = this.files[f].analysis;
    const index = analysis.sig[k];
    return index === undefined ? undefined : analysis.tokens[index];
  }

  protected text(f: number, k: number): string {
    return this.token(f, k)?.value ?? "";
  }

  protected isOp(f: number, k: number, value: string): boolean {
    const t = this.token(f, k);
    return t !== undefined && t.type === "op" && t.value === value;
  }

  protected isIdent(f: number, k: number): boolean {
    return this.token(f, k)?.type === "ident";
  }

  protected match(f: number, k: number): number {
    let table = this.matches[f];
    if (!table) {
      const { analysis } = this.files[f];
      table = new Array(analysis.sig.length).fill(-1);
      const open: number[] = [];
      const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
      analysis.sig.forEach((index, i) => {
        const t = analysis.tokens[index];
        if (t.type !== "op") return;
        if (t.value === "(" || t.value === "[" || t.value === "{") open.push(i);
        else if (pairs[t.value]) {
          const top = open.pop();
          if (top === undefined || analysis.tokens[analysis.sig[top]].value !== pairs[t.value]) return;
          table![top] = i;
          table![i] = top;
        }
      });
      this.matches[f] = table;
    }
    return table[k] ?? -1;
  }

  // ── Finding the base of an access ─────────────────────────────────

  /** First token of the chain ending at `end`: a name, call or parenthesised expression, then steps. -1 otherwise. */
  protected chainStart(f: number, end: number): number {
    // Every access in a chain walks back over the same tokens, so keep the answer for each one passed
    const table = (this.chainStarts[f] ??= new Map());
    const passed: number[] = [];
    const start = this.walkToChainStart(f, end, table, passed);
    for (const j of passed) table.set(j, start);
    return start;
  }

  private walkToChainStart(f: number, end: number, table: Map<number, number>, passed: number[]): number {
    let j = end;
    for (;;) {
      const known = table.get(j);
      if (known !== undefined) return known;
      passed.push(j);
      const t = this.token(f, j);
      if (t === undefined) return -1;
      if (t.type === "op" && t.value === "]") {
        const open = this.match(f, j);
        if (open < 0) return -1;
        j = open - 1;
        continue;
      }
      if (t.type === "ident") {
        if (this.isOp(f, j - 1, ".")) {
          j -= 2;
          continue;
        }
        return RESERVED.has(t.value) ? -1 : j;
      }
      if (t.type === "op" && t.value === ")") {
        const open = this.match(f, j);
        if (open < 0) return -1;
        const before = this.token(f, open - 1);
        if (before?.type === "ident" && !RESERVED.has(before.value)) {
          // A call. `a.f(...)` is not WGSL.
          return this.isOp(f, open - 2, ".") ? -1 : open - 1;
        }
        const lt = this.templateOpenedBefore(f, open);
        if (lt !== undefined) {
          // A call with a template list: `array<S, 4>(...)`
          if (!this.isIdent(f, lt - 1) || this.isOp(f, lt - 2, ".")) return -1;
          return lt - 1;
        }
        // A parenthesised expression, unless the `(` follows what cannot precede one.
        // A `>` that closes no template list is an operator, as in `x > (s).m`.
        if (before?.type === "number" || (before?.type === "op" && (before.value === ")" || before.value === "]"))) {
          return -1;
        }
        return open;
      }
      return -1;
    }
  }

  /** The `<` whose template list closes on the last character of the token before `k`, as in `array<S, 4>(`. */
  private templateOpenedBefore(f: number, k: number): number | undefined {
    const closed = this.files[f].analysis.templates.closes.get(k - 1);
    if (!closed || closed.length !== this.text(f, k - 1).length) return undefined;
    return closed[closed.length - 1];
  }

  /** The token whose last character closes the template list opened at `open`; -1 otherwise. */
  protected templateClose(f: number, open: number): number {
    const close = this.files[f].analysis.templates.closeOf.get(open);
    if (close === undefined || this.templateOpenedBefore(f, close + 1) !== open) return -1;
    return close;
  }

  // ── Types ─────────────────────────────────────────────────────────

  /** Parse [start, end) as `name` or `name<arg, ...>`, each argument a type or an expression; null unless the
   * range is one type. Its last token may hold more after the `>`s, like the `=` of `array<S, 2>= x`. */
  protected parseType(f: number, start: number, end: number): TypeNode | null {
    const { closes, closeOf } = this.files[f].analysis.templates;
    const toks: { k: number; value: string; ident: boolean }[] = [];
    for (let k = start; k < end; k++) {
      const t = this.token(f, k);
      if (!t) return null;
      const closed = closes.get(k)?.length ?? 0;
      if (closed > 0) {
        if (closed < t.value.length && k !== end - 1) return null;
        for (let i = 0; i < closed; i++) toks.push({ k, value: ">", ident: false });
      } else if (t.type === "op" && (t.value.startsWith(">") || (t.value.startsWith("<") && !closeOf.has(k)))) {
        // A `<` or `>` that delimits no template list is not part of a type
        return null;
      } else {
        toks.push({ k, value: t.value, ident: t.type === "ident" });
      }
    }

    // Deeper template lists than this are not followed; the type is then unknown
    let depth = 0;
    const parseAt = (i: number): [TypeNode, number] | null => {
      if (!toks[i]?.ident || depth > 64) return null;
      const k = toks[i].k;
      if (toks[i + 1]?.value !== "<") return [{ k, args: null }, i + 1];
      const args: (TypeNode | null)[] = [];
      let j = i + 2;
      for (;;) {
        if (toks[j]?.value === ">") return [{ k, args }, j + 1];
        depth++;
        const typed = parseAt(j);
        depth--;
        if (typed && (toks[typed[1]]?.value === "," || toks[typed[1]]?.value === ">")) {
          args.push(typed[0]);
          j = typed[1];
        } else {
          // An expression argument: skip it
          args.push(null);
          let depth = 0;
          for (; j < toks.length; j++) {
            const v = toks[j].value;
            if (depth === 0 && (v === "," || v === ">")) break;
            if (v === "(" || v === "[") depth++;
            else if (v === ")" || v === "]") depth--;
            else if (v === "<") return null;
          }
        }
        if (toks[j]?.value === ",") j++;
        else if (toks[j]?.value !== ">") return null;
      }
    };

    const parsed = parseAt(0);
    return parsed && parsed[1] === toks.length ? parsed[0] : null;
  }
}
