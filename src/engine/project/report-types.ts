// The report of a project build: what each file links, keeps and leaves unresolved, and every
// name kept in doubt. These types are public API.

/** Keep rules for names the plugin cannot prove safe to rename. `strict` turns each into a failure. */
export type DoubtRule =
  /** Member map: an access to the field whose base type is not proven. */
  | "unproven-access"
  /** Any space: the name appears in the arguments of an attribute the plugin does not know. */
  | "unknown-attribute";

/** Why a name was left as written. */
export type KeepRule =
  /** Module map: the name of an entry point, which JS selects by name. */
  | "entry-point"
  /** Module map: an `override` without `@id`, which JS sets by name. */
  | "override"
  /** Module map: also a predeclared type, builtin function or enumerant. */
  | "predeclared"
  /** Locals: an enumerant name (address space, access mode, texel format). */
  | "enumerant"
  /** Member map: a swizzle-like name (`x`, `rgb`, ...). */
  | "swizzle"
  /** Member map: a member of a builtin result struct (`fract`, `old_value`, ...). */
  | "builtin-member"
  /** Locals: a parameter of the file's leading function (three.js `wgslFn`). */
  | "wgsl-fn-param"
  /** Any space: listed in `preserve`. */
  | "preserve"
  /** Module map and member map: `topLevel` is "keep". */
  | "top-level"
  | DoubtRule;

/** Where a name lives: module scope, struct fields, or a function's locals. */
export type NameSpace = "module" | "member" | "local";

export interface KeptName {
  name: string;
  space: NameSpace;
  rule: KeepRule;
}

/** A place in a project file. */
export interface SourcePosition {
  file: string;
  /** 1-based. */
  line: number;
  /** 1-based, in UTF-16 code units. */
  column: number;
}

/** A name kept by a `DoubtRule`, as written in every file. One entry per name, space and rule. */
export interface Doubt {
  name: string;
  space: NameSpace;
  rule: DoubtRule;
  /** Project files that declare or use the name in this space, sorted. */
  files: string[];
  /** Each unproven access, or each use in or declaration carrying an unknown attribute. */
  sites: SourcePosition[];
  /** Why the name is kept, in one sentence. */
  reason: string;
  /** What would let the plugin rename it, worded without the name where possible so that actions group. */
  action: string;
}

export interface CrossFileLink {
  /** A name this file uses without declaring it. */
  name: string;
  /** The other project files that declare it at module scope. */
  declaredIn: string[];
}

export interface FileReport {
  /** Names this file uses that other project files declare at module scope. */
  links: CrossFileLink[];
  /** Names in this file left as written by a keep rule, with the rule. */
  kept: KeptName[];
  /** Names used here that neither the project nor WGSL declares. They stay as written for linked code to declare. */
  unresolved: string[];
}

export interface ProjectReport {
  /** One entry per input file, under the same id. */
  files: Record<string, FileReport>;
  /** Original to new name for every renamed module-scope name. The plugin's leak check looks for these keys. */
  moduleMap: Map<string, string>;
  /** Original to new name for every renamed struct field. */
  memberMap: Map<string, string>;
  /** Every name kept by a `DoubtRule`, sorted by space, name, then rule. `strict` fails when this is not empty. */
  doubts: Doubt[];
}
