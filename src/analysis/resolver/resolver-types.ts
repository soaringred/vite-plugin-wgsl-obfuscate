import type { Token } from "@/wgsl/tokenizer";
import type { TemplateLists } from "@/analysis/template-lists";

// What the resolver records for one file.

/** What an identifier is. `decl` and `ref` (to this file) rename with their symbol, `member-*` by the member map, and
 * `unresolved` (a builtin or another file's name) only if the project declares it. `keyword` and `context` never do. */
export type IdentClass =
  | "keyword"
  | "decl"
  | "ref"
  | "unresolved"
  | "member-decl"
  | "member-ref"
  | "context";

export type SymbolKind =
  // Module scope
  | "fn" | "const" | "override" | "var" | "struct" | "alias"
  // Function scope
  | "param" | "let" | "local-var" | "local-const";

/** A range of significant tokens, [start, end). */
export type TokenRange = [number, number];

export interface FieldInfo {
  name: string;
  /** Significant-token index of the field name. */
  decl: number;
  type: TokenRange;
  unknownAttributes: string[];
}

export interface SymbolInfo {
  id: number;
  name: string;
  kind: SymbolKind;
  /** Index, among the significant tokens, of the identifier that declares it. */
  decl: number;
  /** Declaring function's symbol id for parameters and locals; -1 at module scope. */
  fn: number;
  /** Function with a stage attribute (`STAGE_ATTRIBUTES`). */
  stage: boolean;
  /** Function with a stage attribute, or an unknown attribute in front of `fn`. */
  entryPoint: boolean;
  /** Unknown attributes on the declaration, or on a function's return type or body. They keep its name. */
  unknownAttributes: string[];
  /** Override with an `@id(...)` attribute. */
  overrideId: boolean;
  /** Written type of a value or parameter, return type of a function, or aliased type of an alias. */
  type?: TokenRange;
  init?: TokenRange;
  /** Fields of a struct, in declaration order. */
  fields?: FieldInfo[];
}

/** An identifier in the arguments of an attribute the plugin does not know. */
export interface UnknownArgument {
  /** Significant-token index of the identifier. */
  k: number;
  attribute: string;
}

export interface FunctionInfo {
  /** Symbol id of the function. */
  symbol: number;
  /** Significant-token range, from the first attribute to the closing brace, inclusive. */
  start: number;
  end: number;
  /** Symbol ids of the parameters and locals, in declaration order. */
  locals: number[];
}

export interface FileAnalysis {
  /** The full `tokenize()` output, whitespace and comments included. */
  tokens: Token[];
  /** Indices into `tokens` of the significant tokens (everything but gaps). */
  sig: number[];
  /** Per significant token: the class of an identifier, undefined otherwise. */
  classes: (IdentClass | undefined)[];
  /** Per significant token: the symbol a `decl` or `ref` binds to, -1 otherwise. */
  bindings: number[];
  symbols: SymbolInfo[];
  functions: FunctionInfo[];
  /** The first module-scope item (directives aside) if it is a `fn` and not an entry point, else -1.
   * three.js `wgslFn` reads that function's signature from the source. */
  leadingFunction: number;
  /** Identifiers in the arguments of unknown attributes. They are left as written. */
  unknownArguments: UnknownArgument[];
  /** The template lists of the file, by significant-token index. */
  templates: TemplateLists;
}
