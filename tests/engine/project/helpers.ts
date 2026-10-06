import { readdirSync, readFileSync } from "fs";
import { join } from "path";

// The project in tests/fixtures/project: a wave library, a file that depends on
// it, a compute pass, and three.js `wgslFn` wrappers that call into the library.

const PROJECT_DIR = join(__dirname, "..", "..", "fixtures", "project");

/** Every file of the project, by file name, in directory order. */
export function loadProject(): Record<string, string> {
  const names = readdirSync(PROJECT_DIR).filter((f) => f.endsWith(".wgsl")).sort();
  return Object.fromEntries(names.map((name) => [name, readFileSync(join(PROJECT_DIR, name), "utf-8")]));
}

/** Files that three.js loads as `wgslFn` bodies. */
export const WRAPPERS = ["wave-fn-foam.wgsl", "wave-fn-height.wgsl", "wave-fn-normal.wgsl", "wave-fn-tint.wgsl"];

/** Files linked together at runtime, in link order. */
export const LINK_SETS: Record<string, string[]> = {
  surface: ["wave-lib.wgsl", "wave-surface.wgsl"],
  bake: ["wave-lib.wgsl", "wave-surface.wgsl", "wave-bake.wgsl"],
  height: ["wave-lib.wgsl", "wave-surface.wgsl", "wave-fn-height.wgsl"],
  foam: ["wave-lib.wgsl", "wave-surface.wgsl", "wave-fn-foam.wgsl"],
  normal: ["wave-lib.wgsl", "wave-surface.wgsl", "wave-fn-normal.wgsl"],
  tint: ["wave-lib.wgsl", "wave-fn-tint.wgsl"],
  // Callers before the declarations they use: link order does not matter
  reversed: ["wave-fn-normal.wgsl", "wave-bake.wgsl", "wave-surface.wgsl", "wave-lib.wgsl"],
};

/** The link set: the files' sources concatenated in order. */
export function link(files: Record<string, string>, names: string[]): string {
  return names.map((name) => files[name]).join("\n");
}
