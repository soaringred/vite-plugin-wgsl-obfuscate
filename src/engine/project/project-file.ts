import type { FileAnalysis } from "@/analysis/resolver";

// A project file once validated and resolved, as every stage of a project build reads it.

/** Name of the identifier at significant index `k`. */
export function textAt(analysis: FileAnalysis, k: number): string {
  return analysis.tokens[analysis.sig[k]].value;
}

export interface ProjectFile {
  id: string;
  source: string;
  analysis: FileAnalysis;
}
