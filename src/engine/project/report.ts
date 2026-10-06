import { isModuleSymbol } from "@/analysis/resolver";
import type { FileAnalysis } from "@/analysis/resolver";
import type { ProjectDeclaration } from "@/analysis/member-proof";
import { BUILTINS, ENUMERANTS } from "@/wgsl/grammar";
import type { Doubt, DoubtRule, FileReport, KeepRule, KeptName, NameSpace, SourcePosition } from "@/engine/project/report-types";
import type { ProjectFile } from "@/engine/project/project-file";
import { textAt } from "@/engine/project/project-file";

// Building the report: the doubts, collected while the keep rules run, and what each file links,
// keeps and leaves unresolved.

function byText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Doubts by space and name, before they become report entries. */
export class DoubtLog {
  private readonly entries = new Map<
    string,
    Doubt & { reasons: Set<string>; actions: Set<string>; siteKeys: Set<string> }
  >();

  /** Rules recorded per space and name, in the order they were first added. */
  private readonly rulesByName = new Map<string, DoubtRule[]>();

  /** `open` is false for a name that another keep rule keeps anyway: it is not in doubt. */
  constructor(private readonly open: (space: NameSpace, name: string) => boolean) {}

  add(
    space: NameSpace,
    name: string,
    rule: DoubtRule,
    detail: { reason: string; action: string; site?: SourcePosition },
  ): void {
    if (!this.open(space, name)) return;
    const key = `${space}\u0000${name}\u0000${rule}`;
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        name,
        space,
        rule,
        files: [],
        sites: [],
        reason: "",
        action: "",
        reasons: new Set(),
        actions: new Set(),
        siteKeys: new Set(),
      };
      this.entries.set(key, entry);
      const nameKey = `${space}\u0000${name}`;
      this.rulesByName.set(nameKey, [...(this.rulesByName.get(nameKey) ?? []), rule]);
    }
    entry.reasons.add(detail.reason);
    entry.actions.add(detail.action);
    // One site per place: a declaration with two unknown attributes is one site
    const site = detail.site;
    const siteKey = site && `${site.file}\u0000${site.line}:${site.column}`;
    if (site && siteKey && !entry.siteKeys.has(siteKey)) {
      entry.siteKeys.add(siteKey);
      entry.sites.push(site);
    }
  }

  /** Rules recorded for a name, in the order they were first added. */
  rules(space: NameSpace, name: string): DoubtRule[] {
    return this.rulesByName.get(`${space}\u0000${name}`) ?? [];
  }

  /** Report entries, with the files that declare or use each name. */
  finish(filesOf: (space: NameSpace, name: string) => Set<string>): Doubt[] {
    const order: Record<NameSpace, number> = { module: 0, member: 1, local: 2 };
    return [...this.entries.values()]
      .map(({ reasons, actions, siteKeys, ...doubt }) => {
        const files = new Set([...filesOf(doubt.space, doubt.name), ...doubt.sites.map((s) => s.file)]);
        const unproven = doubt.rule === "unproven-access";
        return {
          ...doubt,
          files: [...files].sort(byText),
          reason: unproven
            ? `${doubt.sites.length === 1 ? "an access" : `${doubt.sites.length} accesses`} to \`.${doubt.name}\` ` +
              `could not be proven to read a struct the project declares: ${[...reasons].join("; ")}`
            : [...reasons].join("; "),
          action: [...actions].join("; "),
          sites: [...doubt.sites].sort(
            (a, b) => byText(a.file, b.file) || a.line - b.line || a.column - b.column,
          ),
        };
      })
      .sort((a, b) => order[a.space] - order[b.space] || byText(a.name, b.name) || byText(a.rule, b.rule));
  }
}

export function fileReport(
  id: string,
  files: ProjectFile[],
  analysis: FileAnalysis,
  moduleDecls: Map<string, ProjectDeclaration[]>,
  moduleKept: Map<string, KeepRule>,
  memberNames: Set<string>,
  memberKept: Map<string, KeepRule>,
  localKept: Map<number, KeepRule>,
): FileReport {
  const links = new Map<string, string[]>();
  const kept = new Map<string, KeptName>();
  const unresolved = new Set<string>();
  const keep = (name: string, space: NameSpace, rule: KeepRule | undefined) => {
    if (rule) kept.set(`${space}:${name}`, { name, space, rule });
  };

  analysis.classes.forEach((cls, k) => {
    const name = textAt(analysis, k);
    if (cls === "decl" || cls === "ref") {
      const symbol = analysis.symbols[analysis.bindings[k]];
      if (isModuleSymbol(symbol)) keep(name, "module", moduleKept.get(name));
      else keep(name, "local", localKept.get(symbol.id));
    } else if (cls === "unresolved") {
      const decls = moduleDecls.get(name);
      if (decls) {
        links.set(name, [...new Set(decls.map((d) => files[d.file].id))].filter((file) => file !== id).sort());
        keep(name, "module", moduleKept.get(name));
      } else if (!BUILTINS.has(name) && !ENUMERANTS.has(name)) {
        unresolved.add(name);
      }
    } else if ((cls === "member-decl" || cls === "member-ref") && memberNames.has(name)) {
      keep(name, "member", memberKept.get(name));
    }
  });

  const byName = <T extends { name: string }>(a: T, b: T) => byText(a.name, b.name);
  return {
    links: [...links].map(([name, declaredIn]) => ({ name, declaredIn })).sort(byName),
    kept: [...kept.values()].sort((a, b) => byName(a, b) || byText(a.space, b.space)),
    unresolved: [...unresolved].sort(),
  };
}
