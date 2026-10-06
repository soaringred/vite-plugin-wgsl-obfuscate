import type { FileAnalysis } from "@/analysis/resolver";
import type { ProjectReport } from "@/engine/project/report-types";

// What a project build takes and gives: settings with defaults applied, and outputs for the self-checks.

/** Options with defaults applied. */
export interface ProjectSettings {
  preserve: ReadonlySet<string>;
  renameIdents: boolean;
  collapseWhitespace: boolean;
  topLevel: "rename" | "keep";
  wgslFnParams: "keep" | "rename";
  prefix: string;
}

export interface FileBuild {
  id: string;
  source: string;
  analysis: FileAnalysis;
  /** Per significant token: new text for an identifier, undefined to keep it. */
  names: (string | undefined)[];
  output: string;
}

export interface ProjectBuild {
  files: FileBuild[];
  moduleMap: Map<string, string>;
  memberMap: Map<string, string>;
  /** Every name generated for a parameter or local, in any function. */
  localNames: Set<string>;
  report: ProjectReport;
}
