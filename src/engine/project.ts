import { tokenize } from "@/wgsl/tokenizer";
import { emit } from "@/wgsl/emit";
import { resolve, isModuleSymbol } from "@/analysis/resolver";
import { validateTokens } from "@/wgsl/validate";
import { positionsIn } from "@/wgsl/position";
import { MemberProof } from "@/analysis/member-proof";
import type { ProjectDeclaration } from "@/analysis/member-proof";
import { RESERVED, BUILTINS, ENUMERANTS } from "@/wgsl/grammar";
import type { FileReport, KeepRule, NameSpace, SourcePosition } from "@/engine/project/report-types";
import type { FileBuild, ProjectBuild, ProjectSettings } from "@/engine/project/build-types";
import type { ProjectFile } from "@/engine/project/project-file";
import { textAt } from "@/engine/project/project-file";
import { DoubtLog, fileReport } from "@/engine/project/report";
import {
  moduleKeepRule,
  memberKeepRule,
  unknownAttributeDoubts,
  unprovenAccessDoubts,
  unknownArgumentsIn,
  localUnknownDoubts,
  extensionPredeclared,
} from "@/engine/project/keep-rules";
import { NameSequence, allocate, nameLocals } from "@/engine/project/allocation";

// Linking and naming. All project files share one module map and one member map, keyed by original
// name, so a name declared in one file and used in another gets the same new name in both.

export type {
  DoubtRule,
  KeepRule,
  NameSpace,
  KeptName,
  SourcePosition,
  Doubt,
  CrossFileLink,
  FileReport,
  ProjectReport,
} from "@/engine/project/report-types";
export type { ProjectSettings, FileBuild, ProjectBuild } from "@/engine/project/build-types";
export { generatedName } from "@/engine/project/allocation";

/** Validate the structure, resolve scopes, and collect declarations. */
function analyze(sources: Record<string, string>) {
  const files: ProjectFile[] = Object.entries(sources).map(([id, source]) => {
    const tokens = tokenize(source);
    validateTokens(id, source, tokens);
    return { id, source, analysis: resolve(tokens) };
  });

  const sourceIdents = new Set<string>();
  for (const { analysis } of files) {
    for (const token of analysis.tokens) if (token.type === "ident") sourceIdents.add(token.value);
  }
  const moduleDecls = new Map<string, ProjectDeclaration[]>();
  const memberNames = new Set<string>();
  files.forEach(({ analysis }, f) => {
    for (const symbol of analysis.symbols) {
      if (!isModuleSymbol(symbol)) continue;
      const list = moduleDecls.get(symbol.name) ?? [];
      list.push({ file: f, symbol });
      moduleDecls.set(symbol.name, list);
    }
    analysis.classes.forEach((cls, k) => {
      if (cls === "member-decl") memberNames.add(textAt(analysis, k));
    });
  });

  return { files, sourceIdents, moduleDecls, memberNames };
}

/** Rename a project. The result carries everything the self-checks need. */
export function buildProject(sources: Record<string, string>, settings: ProjectSettings): ProjectBuild {
  const { files, sourceIdents, moduleDecls, memberNames } = analyze(sources);
  const locators = new Map<ProjectFile, ReturnType<typeof positionsIn>>();
  const siteOf = (file: ProjectFile, k: number): SourcePosition => {
    let locate = locators.get(file);
    if (!locate) locators.set(file, (locate = positionsIn(file.source)));
    return { file: file.id, ...locate(file.analysis.tokens[file.analysis.sig[k]].start) };
  };

  // Generated names avoid source identifiers (so nothing kept is captured), `preserve` and WGSL words
  const taken = (name: string) =>
    sourceIdents.has(name) ||
    settings.preserve.has(name) ||
    RESERVED.has(name) ||
    BUILTINS.has(name) ||
    ENUMERANTS.has(name);

  // ── Keep rules ──────────────────────────────────────────────────

  // Ordinary keep rules first. A name they keep is not in doubt.
  const moduleKept = new Map<string, KeepRule>();
  const memberKept = new Map<string, KeepRule>();
  if (settings.renameIdents) {
    const enabledWords = extensionPredeclared(sourceIdents);
    for (const [name, decls] of moduleDecls) {
      const rule = moduleKeepRule(name, decls, settings, enabledWords);
      if (rule) moduleKept.set(name, rule);
    }
    for (const name of memberNames) {
      const rule = memberKeepRule(name, settings);
      if (rule) memberKept.set(name, rule);
    }
  }
  const doubts = new DoubtLog(
    (space, name) => (space === "module" ? !moduleKept.has(name) : space === "member" ? !memberKept.has(name) : true),
  );

  // Then the doubt rules
  if (settings.renameIdents) {
    unknownAttributeDoubts(files, moduleDecls, memberNames, doubts, siteOf);
    const proof = new MemberProof(files, moduleDecls);
    const open = new Set([...memberNames].filter((name) => !memberKept.has(name)));
    unprovenAccessDoubts(files, open, proof, doubts, siteOf);

    for (const name of moduleDecls.keys()) {
      const rule = doubts.rules("module", name)[0];
      if (rule && !moduleKept.has(name)) moduleKept.set(name, rule);
    }
    for (const name of memberNames) {
      const rule = doubts.rules("member", name)[0];
      if (rule && !memberKept.has(name)) memberKept.set(name, rule);
    }
  }

  // ── Module map and member map ───────────────────────────────────

  const moduleUses = new Map<string, number>();
  const memberUses = new Map<string, number>();
  const bump = (counts: Map<string, number>, name: string) => counts.set(name, (counts.get(name) ?? 0) + 1);
  for (const { analysis } of files) {
    analysis.classes.forEach((cls, k) => {
      const name = textAt(analysis, k);
      if (cls === "decl" || cls === "ref") {
        if (isModuleSymbol(analysis.symbols[analysis.bindings[k]])) bump(moduleUses, name);
      } else if (cls === "unresolved") {
        if (moduleDecls.has(name)) bump(moduleUses, name);
      } else if (cls === "member-decl" || cls === "member-ref") {
        if (memberNames.has(name)) bump(memberUses, name);
      }
    });
  }

  const moduleMap = new Map<string, string>();
  const memberMap = new Map<string, string>();
  if (settings.renameIdents) {
    allocate([...moduleDecls.keys()], moduleKept, moduleUses, moduleMap, new NameSequence(settings.prefix, taken));
    allocate([...memberNames], memberKept, memberUses, memberMap, new NameSequence(settings.prefix, taken));
  }

  // ── Locals, then output ─────────────────────────────────────────

  const localNames = new Set<string>();
  const builds: FileBuild[] = [];
  const reports: [string, FileReport][] = [];

  for (const file of files) {
    const { id, source, analysis } = file;
    const localKept = new Map<number, KeepRule>();
    const localOut = new Map<number, string>();

    const nameOf = (k: number): string | undefined => {
      const cls = analysis.classes[k];
      const name = textAt(analysis, k);
      if (cls === "decl" || cls === "ref") {
        const symbol = analysis.symbols[analysis.bindings[k]];
        return isModuleSymbol(symbol) ? moduleMap.get(name) : localOut.get(symbol.id);
      }
      if (cls === "unresolved") return moduleMap.get(name);
      if (cls === "member-decl" || cls === "member-ref") return memberMap.get(name);
      return undefined;
    };

    if (settings.renameIdents) {
      for (const fn of analysis.functions) {
        const unknownArgs = unknownArgumentsIn(analysis, fn);
        nameLocals(analysis, fn, settings, taken, nameOf, localKept, localOut, (symbol) => {
          const found = localUnknownDoubts(symbol, unknownArgs);
          for (const { k, ...detail } of found) {
            doubts.add("local", symbol.name, "unknown-attribute", { ...detail, site: siteOf(file, k) });
          }
          return found.length > 0;
        });
      }
      for (const name of localOut.values()) localNames.add(name);
    }

    const names = analysis.classes.map((_, k) => nameOf(k));
    const texts: (string | undefined)[] = new Array(analysis.tokens.length);
    names.forEach((name, k) => (texts[analysis.sig[k]] = name));
    const output = emit(analysis.tokens, {
      collapseWhitespace: settings.collapseWhitespace,
      rename: (_, index) => texts[index],
    });

    builds.push({ id, source, analysis, names, output });
    reports.push([id, fileReport(id, files, analysis, moduleDecls, moduleKept, memberNames, memberKept, localKept)]);
  }

  // Files that declare or use each name, per space, indexed in one pass on first use
  let index: Map<string, Set<string>> | undefined;
  const filesOf = (space: NameSpace, name: string): Set<string> => {
    if (!index) {
      const built = new Map<string, Set<string>>();
      for (const { id, analysis } of files) {
        analysis.classes.forEach((cls, k) => {
          const symbol = analysis.symbols[analysis.bindings[k]];
          const inSpace: NameSpace | undefined =
            cls === "member-decl" || cls === "member-ref"
              ? "member"
              : cls === "unresolved" || ((cls === "decl" || cls === "ref") && isModuleSymbol(symbol))
                ? "module"
                : cls === "decl" || cls === "ref"
                  ? "local"
                  : undefined;
          if (!inSpace) return;
          const key = `${inSpace}\u0000${textAt(analysis, k)}`;
          const found = built.get(key) ?? new Set<string>();
          found.add(id);
          built.set(key, found);
        });
      }
      index = built;
    }
    return index.get(`${space}\u0000${name}`) ?? new Set();
  };

  return {
    files: builds,
    moduleMap,
    memberMap,
    localNames,
    report: { files: Object.fromEntries(reports), moduleMap, memberMap, doubts: doubts.finish(filesOf) },
  };
}
