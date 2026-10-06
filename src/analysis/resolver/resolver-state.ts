import type { Token } from "@/wgsl/tokenizer";
import { attributeName, isGap } from "@/wgsl/tokenizer";
import { RESERVED, attributeArguments } from "@/wgsl/grammar";
import { discoverTemplateLists } from "@/analysis/template-lists";
import type { TemplateLists } from "@/analysis/template-lists";
import type { FunctionInfo, IdentClass, SymbolInfo, SymbolKind, UnknownArgument } from "@/analysis/resolver/resolver-types";

// The resolver's state and the operations that record into it. The walk over the file is in resolver.ts.

export type Scope = Map<string, number>;

/** Where a declared type ends, by context. */
export const PARAM_TYPE_END = new Set([","]);
export const FIELD_TYPE_END = new Set([","]);
const VALUE_TYPE_END = new Set(["=", ";"]);

export class ResolverState {
  protected readonly sig: number[] = [];
  protected readonly toks: Token[] = [];
  protected readonly classes: (IdentClass | undefined)[];
  protected readonly bindings: number[];
  protected readonly symbols: SymbolInfo[] = [];
  protected readonly functions: FunctionInfo[] = [];
  protected readonly unknownArguments: UnknownArgument[] = [];
  protected leadingFunction = -1;

  /** Module-scope declarations by name. The first one wins. */
  protected readonly moduleScope: Scope = new Map();
  /** Identifiers looked up at module scope once the whole file is read. */
  protected readonly deferred: number[] = [];

  /** Scope stack inside a function, innermost last. Empty at module scope. */
  protected scopes: Scope[] = [];
  /** Locals whose statement has not ended yet, so they are not in scope. */
  protected pending: number[] = [];
  /** Function being read, as a symbol id, or -1. */
  protected fn = -1;
  protected fnInfo: FunctionInfo | null = null;

  /** Cursor over the significant tokens. */
  protected i = 0;

  protected readonly templates: TemplateLists;

  constructor(protected readonly tokens: Token[]) {
    tokens.forEach((token, index) => {
      if (isGap(token)) return;
      this.sig.push(index);
      this.toks.push(token);
    });
    this.classes = new Array(this.toks.length).fill(undefined);
    this.bindings = new Array(this.toks.length).fill(-1);
    this.templates = discoverTemplateLists(this.toks);
  }

  // ── Token helpers ─────────────────────────────────────────────────

  protected isOp(k: number, value: string): boolean {
    const t = this.toks[k];
    return t !== undefined && t.type === "op" && t.value === value;
  }

  private isIdent(k: number): boolean {
    return this.toks[k]?.type === "ident";
  }

  /** True when an identifier at `k` can name a declaration. */
  protected isName(k: number): boolean {
    return this.isIdent(k) && !RESERVED.has(this.toks[k].value) && this.toks[k].value !== "_";
  }

  /** Index of the next `;` from `k`, or the end of the file. */
  protected semicolonFrom(k: number): number {
    while (k < this.toks.length && !this.isOp(k, ";")) k++;
    return k;
  }

  /** End (exclusive) of the type at `k`: the first of `stops` outside brackets and template lists, an unmatched
   * closing bracket, or a token no type contains. When a list's closing token holds more than `>`s, as `>=` does
   * in `let x: array<S, 2>= y;`, the type ends with it and `rest` is what follows the `>`s. */
  protected typeEnd(k: number, stops: ReadonlySet<string>): { end: number; rest: string } {
    let depth = 0;
    for (; k < this.toks.length; k++) {
      const t = this.toks[k];
      if (t.type === "attribute") break;
      if (t.type !== "op") continue;
      const v = t.value;
      const close = v === "<" ? this.templates.closeOf.get(k) : undefined;
      if (close !== undefined) {
        const closed = this.templates.closes.get(close)?.length ?? 0;
        const rest = this.toks[close].value.slice(closed);
        if (rest !== "") return { end: close + 1, rest };
        k = close;
        continue;
      }
      if (depth === 0 && stops.has(v)) break;
      if (v === "(" || v === "[") depth++;
      else if (v === ")" || v === "]") {
        if (depth === 0) break;
        depth--;
      } else if (v === ";" || v === "{" || v === "}" || v === "<" || v.startsWith(">")) {
        break;
      }
    }
    return { end: k, rest: "" };
  }

  /** Record the type and initializer of the value named at `k`: `name [: type] [= init]` up to the `;`. */
  protected valueShape(symbol: number, k: number): void {
    let j = k + 1;
    if (this.isOp(j, ":")) {
      const { end, rest } = this.typeEnd(j + 1, VALUE_TYPE_END);
      this.symbols[symbol].type = [j + 1, end];
      if (rest === "=") {
        this.symbols[symbol].init = [end, this.semicolonFrom(end)];
        return;
      }
      if (rest !== "") return;
      j = end;
    }
    if (this.isOp(j, "=")) this.symbols[symbol].init = [j + 1, this.semicolonFrom(j + 1)];
  }

  // ── Classification ────────────────────────────────────────────────

  protected declare(k: number, kind: SymbolKind): number {
    const id = this.symbols.length;
    this.symbols.push({
      id,
      name: this.toks[k].value,
      kind,
      decl: k,
      fn: this.fn,
      stage: false,
      entryPoint: false,
      unknownAttributes: [],
      overrideId: false,
    });
    this.classes[k] = "decl";
    this.bindings[k] = id;
    if (this.fn < 0) {
      if (!this.moduleScope.has(this.toks[k].value)) this.moduleScope.set(this.toks[k].value, id);
    } else {
      this.fnInfo?.locals.push(id);
    }
    return id;
  }

  /** Classify the identifier at `k` as a use, looked up in the function's scopes first with `local`. */
  protected use(k: number, local: boolean): void {
    if (!this.isIdent(k)) return;
    const name = this.toks[k].value;
    if (this.isOp(k - 1, ".")) {
      this.classes[k] = "member-ref";
    } else if (RESERVED.has(name)) {
      this.classes[k] = "keyword";
    } else if (name === "_") {
      // The phony assignment target
      this.classes[k] = "context";
    } else {
      if (local) {
        for (let s = this.scopes.length - 1; s >= 0; s--) {
          const symbol = this.scopes[s].get(name);
          if (symbol !== undefined) {
            this.classes[k] = "ref";
            this.bindings[k] = symbol;
            return;
          }
        }
      }
      this.classes[k] = "unresolved";
      this.deferred.push(k);
    }
  }

  protected keyword(k: number): void {
    this.classes[k] = "keyword";
  }

  /** Mark every identifier from `k` up to (not including) `end` as context. */
  protected context(k: number, end: number): void {
    for (; k < end; k++) {
      if (!this.isIdent(k)) continue;
      this.classes[k] = RESERVED.has(this.toks[k].value) ? "keyword" : "context";
    }
  }

  // ── Attributes and template lists ─────────────────────────────────

  /** Read the attribute at the cursor. Expression arguments are resolved; context ones are never renamed. Those of an
   * unknown attribute, or of a no-argument one such as naga's `@mesh(output)`, are recorded so what they name is kept. */
  protected attribute(local: boolean): string {
    const name = attributeName(this.toks[this.i]);
    this.i++;
    if (!this.isOp(this.i, "(")) return name;

    const kind = attributeArguments(name);
    let depth = 0;
    for (; this.i < this.toks.length; this.i++) {
      if (this.isOp(this.i, "(")) depth++;
      else if (this.isOp(this.i, ")") && --depth === 0) {
        this.i++;
        break;
      } else if (this.isIdent(this.i)) {
        if (kind === "expression") {
          this.use(this.i, local);
        } else {
          this.context(this.i, this.i + 1);
          if (kind !== "context" && this.classes[this.i] === "context") {
            this.unknownArguments.push({ k: this.i, attribute: name });
          }
        }
      }
    }
    return name;
  }

  /** Skip the `<...>` list after `var` at the cursor, marking its names as context. */
  protected varTemplate(): void {
    if (!this.isOp(this.i, "<")) return;
    const start = this.i;
    while (this.i < this.toks.length && !this.toks[this.i].value.startsWith(">")) this.i++;
    this.context(start, this.i);
    this.i++;
  }
}
