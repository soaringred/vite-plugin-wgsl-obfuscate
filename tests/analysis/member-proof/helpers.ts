import { expect } from "vitest";
import { obfuscateProject } from "@/index";
import type { ObfuscateOptions, ProjectResult } from "@/index";
import { expectValid, expectSameSpirv } from "@tests/helpers/compilers";
import { count } from "@tests/helpers/wgsl";

// A project library whose accesses are all proven, code outside the project,
// and the checks for a proven and an unproven field.

/** The project's library. Every access in it is proven. */
export const LIB = `
  struct Inner { depth: f32 }
  struct Probe { gain: f32, inner: Inner, list: array<Inner, 2> }
  alias ProbeAlias = Probe;
  alias Probes = array<Probe, 4>;
  fn makeProbe() -> Probe { return Probe(1.0, Inner(2.0), array<Inner, 2>(Inner(3.0), Inner(4.0))); }
  fn makeAlias() -> ProbeAlias { return makeProbe(); }
  fn readGain(p: Probe) -> f32 { return p.gain; }
  var<private> single: Probe;
  const fixed: Inner = Inner(5.0);
`;

/** Declared outside the project and linked with it at runtime. */
export const EXTERNAL = `
  struct Light { gain: f32, depth: f32 }
  @group(0) @binding(0) var<uniform> light: Light;
  fn externalLight() -> Light { return Light(1.0, 2.0); }
`;

/** Line and column of every `.name` member in `src`, at the member name. */
export function accessSites(src: string, name: string): { line: number; column: number }[] {
  const sites: { line: number; column: number }[] = [];
  const pattern = new RegExp(`\\.\\s*(${name})(?![\\p{XID_Continue}])`, "gu");
  for (let m = pattern.exec(src); m; m = pattern.exec(src)) {
    const offset = m.index + m[0].length - name.length;
    const before = src.slice(0, offset).split("\n");
    sites.push({ line: before.length, column: before[before.length - 1].length + 1 });
  }
  return sites;
}

/** The files in link order: external code first, then the project files. */
export function link(...sources: string[]): string {
  return sources.join("\n");
}

export interface Case {
  /** Project files other than lib.wgsl. */
  files: Record<string, string>;
  /** Files linked with lib.wgsl and `use.wgsl` at runtime (default: `use.wgsl`). */
  linked?: string[];
  /** Code outside the project, linked first. */
  external?: string;
  options?: ObfuscateOptions;
}

export function build({ files, options }: Case): ProjectResult & { inputs: Record<string, string> } {
  const inputs = { "lib.wgsl": LIB, ...files };
  return { inputs, ...obfuscateProject(inputs, options) };
}

/** The link set before and after, valid and with the same SPIR-V. */
export async function expectLinkSet(c: Case, result: ReturnType<typeof build>): Promise<void> {
  const names = ["lib.wgsl", ...(c.linked ?? ["use.wgsl"])];
  const before = link(...(c.external ? [c.external] : []), ...names.map((n) => result.inputs[n]));
  const after = link(...(c.external ? [c.external] : []), ...names.map((n) => result.files[n]));
  await expectValid(before, "input link set");
  await expectValid(after, "output link set");
  expectSameSpirv(before, after);
}

/** The field is renamed everywhere and the link set compiles to the same SPIR-V. */
export async function expectProven(c: Case, field: string): Promise<ProjectResult> {
  const result = build(c);
  expect(result.report.memberMap.has(field), `${field} is renamed`).toBe(true);
  expect(result.report.doubts.filter((d) => d.name === field)).toEqual([]);
  for (const [id, out] of Object.entries(result.files)) expect(count(out, field), `${field} in ${id}`).toBe(0);
  await expectLinkSet(c, result);
  return result;
}

/**
 * Every access and declaration of the field stays as written in every file, the
 * unproven accesses are reported where they are, and the link set compiles the same.
 */
export async function expectUnproven(
  c: Case,
  field: string,
  sites: { file: string; line: number; column: number }[],
  declaredIn = "lib.wgsl",
): Promise<ProjectResult> {
  const result = build(c);
  expect(result.report.memberMap.has(field), `${field} is renamed`).toBe(false);
  for (const [id, input] of Object.entries(result.inputs)) {
    expect(count(result.files[id], field), `${field} in ${id}`).toBe(count(input, field));
  }
  // The file that declares the field keeps it
  expect(result.files[declaredIn]).toMatch(new RegExp(`[{,]\\s*${field}\\s*:`));
  const doubt = result.report.doubts.find((d) => d.name === field && d.rule === "unproven-access");
  expect(doubt, `a doubt for ${field}`).toBeDefined();
  expect(doubt!.space).toBe("member");
  expect(doubt!.sites).toEqual(sites);
  expect(doubt!.files).toContain(declaredIn);
  await expectLinkSet(c, result);
  return result;
}

/** Sites of `.field` in use.wgsl, picking the occurrences at `indices` (default: all). */
export function useSites(src: string, field: string, indices?: number[]) {
  const all = accessSites(src, field).map((s) => ({ file: "use.wgsl", ...s }));
  return indices ? indices.map((i) => all[i]) : all;
}
