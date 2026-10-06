import type { Token } from "@/wgsl/tokenizer";
import { STAGE_ATTRIBUTES, DIRECTIVES, attributeArguments } from "@/wgsl/grammar";
import { ResolverState, PARAM_TYPE_END, FIELD_TYPE_END } from "@/analysis/resolver/resolver-state";
import type { Scope } from "@/analysis/resolver/resolver-state";
import type { FieldInfo, FileAnalysis, FunctionInfo, SymbolInfo, SymbolKind } from "@/analysis/resolver/resolver-types";

// Scope-aware classification of every identifier in one WGSL source. Not a parser: types and
// expressions stay flat token runs. It finds declarations, the scope each identifier is looked up
// in, and each declared type and initializer, which is all renaming and the member proof need.

export type {
  IdentClass,
  SymbolKind,
  TokenRange,
  FieldInfo,
  SymbolInfo,
  UnknownArgument,
  FunctionInfo,
  FileAnalysis,
} from "@/analysis/resolver/resolver-types";

/** Resolve every identifier in `tokens` (the full `tokenize()` output). */
export function resolve(tokens: Token[]): FileAnalysis {
  return new Resolver(tokens).run();
}

/** True when the symbol is declared at module scope. */
export function isModuleSymbol(symbol: SymbolInfo): boolean {
  return symbol.fn < 0;
}

/** The attributes in `names` that the plugin does not know. */
function unknownOf(names: string[]): string[] {
  return names.filter((name) => attributeArguments(name) === "unknown");
}

class Resolver extends ResolverState {
  run(): FileAnalysis {
    this.moduleLevel();

    // Module-scope names are visible before their declaration, so these lookups wait for all of them
    for (const k of this.deferred) {
      const symbol = this.moduleScope.get(this.toks[k].value);
      if (symbol === undefined) {
        this.classes[k] = "unresolved";
      } else {
        this.classes[k] = "ref";
        this.bindings[k] = symbol;
      }
    }

    return {
      tokens: this.tokens,
      sig: this.sig,
      classes: this.classes,
      bindings: this.bindings,
      symbols: this.symbols,
      functions: this.functions,
      leadingFunction: this.leadingFunction,
      unknownArguments: this.unknownArguments,
      templates: this.templates,
    };
  }

  // ── Module scope ──────────────────────────────────────────────────

  private moduleLevel(): void {
    let attributes: string[] = [];
    let attributesStart = -1;
    let firstItem = true;

    while (this.i < this.toks.length) {
      const t = this.toks[this.i];

      if (t.type === "attribute") {
        if (attributesStart < 0) attributesStart = this.i;
        attributes.push(this.attribute(false));
        continue;
      }

      if (t.type === "ident" && DIRECTIVES.has(t.value)) {
        // enable, requires and diagnostic: context up to the `;`
        const end = this.semicolonFrom(this.i);
        this.keyword(this.i);
        this.context(this.i + 1, end);
        this.i = end + 1;
      } else if (t.type === "op" && t.value === ";") {
        this.i++;
      } else {
        if (t.type === "ident" && t.value === "fn") {
          const symbol = this.function(attributes, attributesStart);
          if (firstItem && symbol >= 0 && !this.symbols[symbol].entryPoint) this.leadingFunction = symbol;
        } else if (t.type === "ident" && (t.value === "const" || t.value === "override" || t.value === "var")) {
          this.moduleValue(attributes);
        } else if (t.type === "ident" && t.value === "struct") {
          this.struct(attributes);
        } else if (t.type === "ident" && t.value === "alias") {
          this.alias(attributes);
        } else if (t.type === "ident" && t.value === "const_assert") {
          this.keyword(this.i);
          const end = this.semicolonFrom(this.i);
          for (this.i++; this.i < end; this.i++) this.use(this.i, false);
          this.i = end + 1;
        } else {
          // Anything this pass does not know. Validation rejects it first.
          this.use(this.i, false);
          this.i++;
        }
        firstItem = false;
      }
      attributes = [];
      attributesStart = -1;
    }
  }

  /** `const`, `override` or `var` at module scope, up to its `;`. */
  private moduleValue(attributes: string[]): void {
    const keyword = this.toks[this.i].value;
    this.keyword(this.i);
    this.i++;
    if (keyword === "var") this.varTemplate();
    if (this.isName(this.i)) {
      const id = this.declare(this.i, keyword as SymbolKind);
      const symbol = this.symbols[id];
      if (keyword === "override") symbol.overrideId = attributes.includes("id");
      symbol.unknownAttributes = unknownOf(attributes);
      this.valueShape(id, this.i);
      this.i++;
    }
    const end = this.semicolonFrom(this.i);
    for (; this.i < end; this.i++) this.use(this.i, false);
    this.i = end + 1;
  }

  /** `alias Name = type;` */
  private alias(attributes: string[]): void {
    this.keyword(this.i);
    this.i++;
    if (this.isName(this.i)) {
      const id = this.declare(this.i, "alias");
      this.symbols[id].unknownAttributes = unknownOf(attributes);
      if (this.isOp(this.i + 1, "=")) this.symbols[id].type = [this.i + 2, this.semicolonFrom(this.i + 2)];
      this.i++;
    }
    const end = this.semicolonFrom(this.i);
    for (; this.i < end; this.i++) this.use(this.i, false);
    this.i = end + 1;
  }

  /** `struct Name { [attributes] field: type, ... }` */
  private struct(attributes: string[]): void {
    this.keyword(this.i);
    this.i++;
    const fields: FieldInfo[] = [];
    if (this.isName(this.i)) {
      const symbol = this.symbols[this.declare(this.i++, "struct")];
      symbol.fields = fields;
      symbol.unknownAttributes = unknownOf(attributes);
    }
    if (!this.isOp(this.i, "{")) return;
    this.i++;

    // Attributes since the last field, which belong to the next one
    let fieldAttributes: string[] = [];
    while (this.i < this.toks.length && !this.isOp(this.i, "}")) {
      if (this.toks[this.i].type === "attribute") {
        fieldAttributes.push(this.attribute(false));
        continue;
      }
      if (this.isName(this.i) && this.isOp(this.i + 1, ":")) {
        this.classes[this.i] = "member-decl";
        fields.push({
          name: this.toks[this.i].value,
          decl: this.i,
          type: [this.i + 2, this.typeEnd(this.i + 2, FIELD_TYPE_END).end],
          unknownAttributes: unknownOf(fieldAttributes),
        });
        fieldAttributes = [];
      } else {
        this.use(this.i, false);
      }
      this.i++;
    }
    this.i++;
  }

  // ── Functions ─────────────────────────────────────────────────────

  /** `fn name(params) [-> [attributes] type] { body }`. Returns its symbol id, or -1 when it has no name. */
  private function(attributes: string[], attributesStart: number): number {
    const start = attributesStart >= 0 ? attributesStart : this.i;
    this.keyword(this.i);
    this.i++;
    if (!this.isName(this.i)) return -1;

    const symbol = this.declare(this.i++, "fn");
    const info: FunctionInfo = { symbol, start, end: start, locals: [] };
    const fnSymbol = this.symbols[symbol];
    fnSymbol.stage = attributes.some((a) => STAGE_ATTRIBUTES.has(a));
    fnSymbol.unknownAttributes = unknownOf(attributes);
    // Only an attribute before `fn` makes an entry point; unknown ones on its return type or body still keep its name
    fnSymbol.entryPoint = fnSymbol.stage || fnSymbol.unknownAttributes.length > 0;
    this.functions.push(info);
    this.fn = symbol;
    this.fnInfo = info;

    // Parameter types and attributes resolve at module scope; parameters are in scope in the body only
    const params: Scope = new Map();
    if (this.isOp(this.i, "(")) {
      let depth = 0;
      // Attributes since the last parameter, which belong to the next one
      let paramAttributes: string[] = [];
      while (this.i < this.toks.length) {
        if (this.toks[this.i].type === "attribute") {
          paramAttributes.push(this.attribute(false));
          continue;
        }
        if (this.isOp(this.i, "(")) depth++;
        else if (this.isOp(this.i, ")") && --depth === 0) {
          this.i++;
          break;
        } else if (depth === 1 && this.isName(this.i) && this.isOp(this.i + 1, ":")) {
          const id = this.declare(this.i, "param");
          this.symbols[id].type = [this.i + 2, this.typeEnd(this.i + 2, PARAM_TYPE_END).end];
          this.symbols[id].unknownAttributes = unknownOf(paramAttributes);
          paramAttributes = [];
          params.set(this.toks[this.i].value, id);
        } else {
          this.use(this.i, false);
        }
        this.i++;
      }
    }

    // Return type at module scope; body attributes, as in `fn f() -> f32 @diagnostic(off, rule) { }`, end it
    let returnType = -1;
    let returnTypeEnd = -1;
    while (this.i < this.toks.length && !this.isOp(this.i, "{")) {
      if (this.toks[this.i].type === "attribute") {
        if (returnType >= 0 && returnTypeEnd < 0) returnTypeEnd = this.i;
        fnSymbol.unknownAttributes.push(...unknownOf([this.attribute(false)]));
        continue;
      }
      if (returnType < 0 && !this.isOp(this.i, "->")) returnType = this.i;
      this.use(this.i, false);
      this.i++;
    }
    if (returnType >= 0) fnSymbol.type = [returnType, returnTypeEnd >= 0 ? returnTypeEnd : this.i];

    this.scopes = [params];
    this.pending = [];
    this.body();
    info.end = Math.min(this.i, this.toks.length) - 1;
    this.scopes = [];
    this.pending = [];
    this.fn = -1;
    this.fnInfo = null;
    return symbol;
  }

  /** The body from `{` to its `}`. Every `{` opens a scope, and a local enters it at the `;` ending its statement,
   * so `let x = x + 1;` reads the outer `x`. A `for` opens a scope around its header and body. */
  private body(): void {
    // Per open block: does closing it also close a `for` scope?
    const blocks: boolean[] = [];
    let forAwaitingBody = false;
    // Attributes in front of the current token, for a declaration
    let attributes: string[] = [];

    while (this.i < this.toks.length) {
      const t = this.toks[this.i];

      if (t.type === "attribute") {
        attributes.push(this.attribute(true));
        continue;
      }
      const statementAttributes = attributes;
      attributes = [];

      if (t.type === "op") {
        if (t.value === "{") {
          this.scopes.push(new Map());
          blocks.push(forAwaitingBody);
          forAwaitingBody = false;
        } else if (t.value === "}") {
          // A declaration without its `;` never came into scope
          this.pending = [];
          this.scopes.pop();
          if (blocks.pop()) this.scopes.pop();
          if (blocks.length === 0) {
            this.i++;
            return;
          }
        } else if (t.value === ";") {
          this.commitPending();
        }
        this.i++;
        continue;
      }

      if (t.type === "ident") {
        if (t.value === "let" || t.value === "var" || t.value === "const") {
          this.keyword(this.i);
          this.i++;
          if (t.value === "var") this.varTemplate();
          if (this.isName(this.i)) {
            const kind: SymbolKind = t.value === "let" ? "let" : t.value === "var" ? "local-var" : "local-const";
            const id = this.declare(this.i, kind);
            this.symbols[id].unknownAttributes = unknownOf(statementAttributes);
            this.valueShape(id, this.i);
            this.pending.push(id);
            this.i++;
          }
          continue;
        }
        if (t.value === "for") {
          this.keyword(this.i);
          this.scopes.push(new Map());
          forAwaitingBody = true;
          this.i++;
          continue;
        }
        this.use(this.i, true);
      }
      this.i++;
    }
  }

  /** Bring the locals whose statement just ended into the innermost scope. */
  private commitPending(): void {
    const scope = this.scopes[this.scopes.length - 1];
    for (const id of this.pending) {
      if (scope) scope.set(this.symbols[id].name, id);
    }
    this.pending = [];
  }
}
