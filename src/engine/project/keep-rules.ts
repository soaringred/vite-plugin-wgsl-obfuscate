import type { FileAnalysis, FunctionInfo, SymbolInfo } from "@/analysis/resolver";
import type { MemberProof, ProjectDeclaration, Unproven } from "@/analysis/member-proof";
import { ENUMERANTS, BUILTIN_MEMBERS, EXTENSION_PREDECLARED, isPredeclared, isSwizzle } from "@/wgsl/grammar";
import type { KeepRule, SourcePosition } from "@/engine/project/report-types";
import type { ProjectSettings } from "@/engine/project/build-types";
import type { ProjectFile } from "@/engine/project/project-file";
import { textAt } from "@/engine/project/project-file";
import type { DoubtLog } from "@/engine/project/report";

// Keep rules that follow from what a name is, and doubts from unknown attributes and unproven member accesses.

/** Words predeclared by the extensions that the project's `identifiers` mention. */
export function extensionPredeclared(identifiers: ReadonlySet<string>): Set<string> {
  const words = new Set<string>();
  for (const { extension, uses, words: predeclared } of EXTENSION_PREDECLARED) {
    const mentioned = [extension, ...uses].some((word) => identifiers.has(word));
    if (mentioned) for (const word of predeclared) words.add(word);
  }
  return words;
}

/** Keep rules for a module-scope name that do not come from doubt. */
export function moduleKeepRule(
  name: string,
  decls: ProjectDeclaration[],
  settings: ProjectSettings,
  enabledWords: ReadonlySet<string> = new Set(),
): KeepRule | undefined {
  if (decls.some((d) => d.symbol.stage)) return "entry-point";
  if (decls.some((d) => d.symbol.kind === "override" && !d.symbol.overrideId)) return "override";
  if (isPredeclared(name) || enabledWords.has(name)) return "predeclared";
  if (settings.preserve.has(name)) return "preserve";
  if (settings.topLevel === "keep") return "top-level";
  return undefined;
}

/** Keep rules for a struct field that do not come from doubt. */
export function memberKeepRule(name: string, settings: ProjectSettings): KeepRule | undefined {
  if (isSwizzle(name)) return "swizzle";
  if (BUILTIN_MEMBERS.has(name)) return "builtin-member";
  if (settings.preserve.has(name)) return "preserve";
  if (settings.topLevel === "keep") return "top-level";
  return undefined;
}

export function localKeepRule(
  analysis: FileAnalysis,
  symbol: SymbolInfo,
  settings: ProjectSettings,
): KeepRule | undefined {
  if (ENUMERANTS.has(symbol.name)) return "enumerant";
  if (symbol.kind === "param" && symbol.fn === analysis.leadingFunction && settings.wgslFnParams === "keep") {
    return "wgsl-fn-param";
  }
  if (settings.preserve.has(symbol.name)) return "preserve";
  return undefined;
}

/** A declaration of `kind` in plain words, for a message. */
const KIND_WORDS: Record<SymbolInfo["kind"], string> = {
  fn: "function",
  const: "constant",
  override: "override",
  var: "variable",
  struct: "struct",
  alias: "alias",
  param: "parameter",
  let: "local",
  "local-var": "local variable",
  "local-const": "local constant",
};

/** `parameter \`x\``: only the name is code. */
function declarationText(kind: SymbolInfo["kind"], name: string): string {
  return `${KIND_WORDS[kind]} \`${name}\``;
}

/** Reason and action for a declaration (`what`, as `declarationText` gives it) that carries unknown attributes. */
export function carriesUnknown(
  what: string,
  attribute: string,
  entryPoint: boolean,
): { reason: string; action: string } {
  return {
    reason:
      `${what} carries \`@${attribute}\`, which the plugin does not know` +
      (entryPoint ? ", so it is treated as an entry point" : ", so its name may be part of an interface"),
    action: `update the plugin to a version that knows \`@${attribute}\``,
  };
}

/** Doubts from unknown attributes at module scope: a declaration or field carrying one keeps its name, one before
 * `fn` makes an entry point, and names in its arguments are kept. Locals are in `localUnknownDoubts`. */
export function unknownAttributeDoubts(
  files: ProjectFile[],
  moduleDecls: Map<string, ProjectDeclaration[]>,
  memberNames: Set<string>,
  doubts: DoubtLog,
  siteOf: (file: ProjectFile, k: number) => SourcePosition,
): void {
  for (const [name, decls] of moduleDecls) {
    for (const { file, symbol } of decls) {
      for (const attribute of symbol.unknownAttributes) {
        const entryPoint = symbol.kind === "fn" && symbol.entryPoint && !symbol.stage;
        doubts.add("module", name, "unknown-attribute", {
          ...carriesUnknown(declarationText(symbol.kind, name), attribute, entryPoint),
          site: siteOf(files[file], symbol.decl),
        });
      }
      for (const field of symbol.fields ?? []) {
        for (const attribute of field.unknownAttributes) {
          doubts.add("member", field.name, "unknown-attribute", {
            ...carriesUnknown(`struct field \`${name}.${field.name}\``, attribute, false),
            site: siteOf(files[file], field.decl),
          });
        }
      }
    }
  }
  for (const file of files) {
    for (const { k, attribute } of file.analysis.unknownArguments) {
      const name = textAt(file.analysis, k);
      const detail = {
        reason: `used in the arguments of \`@${attribute}\`, which the plugin does not know`,
        action: `update the plugin to a version that knows \`@${attribute}\``,
        site: siteOf(file, k),
      };
      if (moduleDecls.has(name)) doubts.add("module", name, "unknown-attribute", detail);
      if (memberNames.has(name)) doubts.add("member", name, "unknown-attribute", detail);
    }
  }
}

/** Unknown attributes that keep a parameter or local: one it carries, or one whose arguments could name it. */
export function localUnknownDoubts(
  symbol: SymbolInfo,
  argumentsByName: Map<string, { k: number; attribute: string }[]>,
): { reason: string; action: string; k: number }[] {
  const found = symbol.unknownAttributes.map((attribute) => ({
    ...carriesUnknown(declarationText(symbol.kind, symbol.name), attribute, false),
    k: symbol.decl,
  }));
  for (const arg of argumentsByName.get(symbol.name) ?? []) {
    found.push({
      reason: `used in the arguments of \`@${arg.attribute}\`, which the plugin does not know`,
      action: `update the plugin to a version that knows \`@${arg.attribute}\``,
      k: arg.k,
    });
  }
  return found;
}

/** Doubts from accesses to the fields in `names` that the proof cannot prove, in one pass over the project. */
export function unprovenAccessDoubts(
  files: ProjectFile[],
  names: ReadonlySet<string>,
  proof: MemberProof,
  doubts: DoubtLog,
  siteOf: (file: ProjectFile, k: number) => SourcePosition,
): void {
  files.forEach((file, f) => {
    file.analysis.classes.forEach((cls, k) => {
      if (cls !== "member-ref") return;
      const name = textAt(file.analysis, k);
      if (!names.has(name)) return;
      const unproven: Unproven | null = proof.check(f, k);
      if (!unproven) return;
      doubts.add("member", name, "unproven-access", {
        reason: unproven.reason,
        action: unproven.action,
        site: siteOf(file, k),
      });
    });
  });
}

/** Unknown-attribute arguments inside a function's range, by name. */
export function unknownArgumentsIn(analysis: FileAnalysis, fn: FunctionInfo): Map<string, { k: number; attribute: string }[]> {
  const byName = new Map<string, { k: number; attribute: string }[]>();
  for (const arg of analysis.unknownArguments) {
    if (arg.k < fn.start || arg.k > fn.end) continue;
    const name = textAt(analysis, arg.k);
    byName.set(name, [...(byName.get(name) ?? []), arg]);
  }
  return byName;
}
