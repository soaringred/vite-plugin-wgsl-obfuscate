import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, relative, sep } from "path";

// The downloaded corpus in tests/corpus (see scripts/fetch-corpus.mjs). It is
// git-ignored; suites that read it skip when it is absent.

export const CORPUS_DIR = join(__dirname, "..", "..", "corpus");

/** Corpus folders with WGSL shaders, in the order the fetch script writes them. */
export const CORPUS_FOLDERS = ["naga", "naga-out", "wgpu", "webgpu-samples"];

export const hasCorpus = existsSync(join(CORPUS_DIR, "manifest.json"));

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : name.endsWith(".wgsl") ? [path] : [];
    });
}

/** Every corpus shader as "folder/path", with `/` separators. */
export function corpusFiles(): string[] {
  return CORPUS_FOLDERS.flatMap((folder) =>
    walk(join(CORPUS_DIR, folder)).map((path) => relative(CORPUS_DIR, path).split(sep).join("/")),
  );
}

/**
 * Files checked on naga only. Tint accepts them but logs a warning (dead code after `return`)
 * straight to stderr from native code, which the tests cannot silence.
 */
export const NAGA_ONLY = new Set(["naga/msl-9683-multiple-returns.wgsl"]);

export function readCorpus(id: string): string {
  return readFileSync(join(CORPUS_DIR, ...id.split("/")), "utf-8");
}

/** A downloaded definition file, by its path in the source repository. */
export function readDefinition(compiler: "tint" | "naga", path: string): string {
  return readFileSync(join(CORPUS_DIR, "definitions", compiler, ...path.split("/")), "utf-8");
}
