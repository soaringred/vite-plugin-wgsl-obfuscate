#!/usr/bin/env node
// Download the WGSL corpus and the compilers' word lists into tests/corpus/
// (git-ignored). The corpus suite (tests/engine/corpus.test.ts) and the
// word-list suite (tests/wgsl/word-lists.test.ts) skip when it is absent.
//
//   yarn corpus:fetch            fetch what is missing
//   yarn corpus:fetch --force    fetch everything again
//
// Every source is pinned to a commit, so a run gives the same files today and
// next year. Set GITHUB_TOKEN to lift GitHub's API rate limit (two API calls
// per run: one tree listing per repository with a listed folder).
//
// Pins:
//   - gfx-rs/wgpu at tag v30.0.1, the naga release inside the installed
//     `naga-wasm` (its `nagaVersion` is "30.0.1"). Since wgpu 24 naga shares
//     the wgpu version number, so the tag is the exact match.
//   - google/dawn (GitHub mirror of dawn.googlesource.com) at the commit the
//     installed `webgpu` 0.6.1 package was built from: node-webgpu v0.6.1
//     pins third_party/dawn to 80ee0043018a51532ea0fa2e77496cc66634157e.
//   - webgpu/webgpu-samples at the head of main on 2026-09-22.
//
// No dependencies: Node's fetch only.

import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "tests", "corpus");
const MANIFEST = join(ROOT, "manifest.json");

const WGPU = {
  repo: "gfx-rs/wgpu",
  ref: "v30.0.1",
  commit: "40f4a34ebaf56f9a046231f54125ad046239d3f3",
  license: "MIT OR Apache-2.0",
};
const DAWN = {
  repo: "google/dawn",
  ref: "node-webgpu v0.6.1 third_party/dawn",
  commit: "80ee0043018a51532ea0fa2e77496cc66634157e",
  license: "BSD-3-Clause",
};
const SAMPLES = {
  repo: "webgpu/webgpu-samples",
  ref: "main (2026-09-22)",
  commit: "e040ec1a20dbbe01afed30c812e825b2639cfe5b",
  license: "BSD-3-Clause",
};

/**
 * WGSL shaders. `select` picks paths from the repository tree; each file is
 * stored under tests/corpus/<folder>/ at its path less `strip`.
 */
const CORPORA = [
  {
    folder: "naga",
    description: "naga's WGSL front-end test inputs",
    ...WGPU,
    strip: "naga/tests/in/wgsl/",
    select: (path) => path.startsWith("naga/tests/in/wgsl/") && path.endsWith(".wgsl"),
  },
  {
    folder: "naga-out",
    description: "naga's WGSL back-end test outputs: machine-written WGSL from WGSL, GLSL and SPIR-V inputs",
    ...WGPU,
    strip: "naga/tests/out/wgsl/",
    select: (path) => path.startsWith("naga/tests/out/wgsl/") && path.endsWith(".wgsl"),
  },
  {
    folder: "wgpu",
    description: "every other WGSL file in the wgpu repository: examples, GPU tests, benchmarks, internal shaders",
    ...WGPU,
    strip: "",
    select: (path) => path.endsWith(".wgsl") && !path.startsWith("naga/tests/"),
  },
  {
    folder: "webgpu-samples",
    description: "the WebGPU samples",
    ...SAMPLES,
    strip: "",
    select: (path) => path.endsWith(".wgsl"),
  },
];

/** The compilers' own lists of builtins, types, enumerants and attributes. */
const DEFINITIONS = [
  {
    folder: "definitions/tint",
    description: "Tint's intrinsic and enum definitions",
    ...DAWN,
    files: [
      "src/tint/lang/wgsl/wgsl.def",
      "src/tint/lang/core/core.def",
      "src/tint/lang/core/access.def",
      "src/tint/lang/core/address_space.def",
      "src/tint/lang/core/texel_format.def",
    ],
  },
  {
    folder: "definitions/naga",
    description: "naga's WGSL keyword list and the front-end files that name every builtin, type, enumerant and attribute",
    ...WGPU,
    files: [
      "naga/src/keywords/wgsl.rs",
      "naga/src/front/wgsl/parse/conv.rs",
      "naga/src/front/wgsl/parse/mod.rs",
      "naga/src/front/wgsl/lower/mod.rs",
      "naga/src/front/type_gen.rs",
    ],
  },
];

const force = process.argv.includes("--force");

function headers() {
  const h = { "User-Agent": "vite-plugin-wgsl-obfuscate corpus fetch", Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function get(url, as = "text") {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, { headers: headers() });
    if (response.ok) return as === "json" ? response.json() : response.text();
    if (attempt >= 3 || (response.status < 500 && response.status !== 429)) {
      throw new Error(`${response.status} ${response.statusText} for ${url}\n${(await response.text()).slice(0, 300)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
  }
}

const raw = (source, path) => `https://raw.githubusercontent.com/${source.repo}/${source.commit}/${path}`;

const trees = new Map();
async function tree(source) {
  const key = `${source.repo}@${source.commit}`;
  if (!trees.has(key)) {
    trees.set(
      key,
      get(`https://api.github.com/repos/${source.repo}/git/trees/${source.commit}?recursive=1`, "json").then((json) => {
        if (json.truncated) throw new Error(`the tree of ${key} is truncated; fetch it in parts`);
        return json.tree.filter((entry) => entry.type === "blob").map((entry) => entry.path);
      }),
    );
  }
  return trees.get(key);
}

/** Download `paths` of `source` into `folder`, eight at a time. */
async function download(source, paths, folder, strip) {
  const dir = join(ROOT, folder);
  await rm(dir, { recursive: true, force: true });
  const queue = [...paths];
  const worker = async () => {
    for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
      const target = join(dir, path.slice(strip.length));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, await get(raw(source, path)));
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
}

function entryOf(item, files) {
  const { folder, description, repo, ref, commit, license } = item;
  return { folder, description, repo, ref, commit, license, url: `https://github.com/${repo}/tree/${commit}`, files };
}

async function previous() {
  try {
    return JSON.parse(await readFile(MANIFEST, "utf8"));
  } catch {
    return { corpora: [], definitions: [] };
  }
}

async function main() {
  const before = await previous();
  const isCurrent = (list, item) =>
    !force &&
    list.some(
      (entry) =>
        entry.folder === item.folder &&
        entry.commit === item.commit &&
        (!item.files || JSON.stringify(entry.files) === JSON.stringify(item.files)),
    );

  const manifest = { fetched: new Date().toISOString(), corpora: [], definitions: [] };
  for (const corpus of CORPORA) {
    if (isCurrent(before.corpora, corpus)) {
      manifest.corpora.push(before.corpora.find((entry) => entry.folder === corpus.folder));
      console.log(`${corpus.folder}: up to date`);
      continue;
    }
    const paths = (await tree(corpus)).filter(corpus.select).sort();
    await download(corpus, paths, corpus.folder, corpus.strip);
    manifest.corpora.push(entryOf(corpus, paths.map((path) => path.slice(corpus.strip.length))));
    console.log(`${corpus.folder}: ${paths.length} files from ${corpus.repo}@${corpus.commit.slice(0, 10)}`);
  }
  for (const definition of DEFINITIONS) {
    if (isCurrent(before.definitions, definition)) {
      manifest.definitions.push(before.definitions.find((entry) => entry.folder === definition.folder));
      console.log(`${definition.folder}: up to date`);
      continue;
    }
    await download(definition, definition.files, definition.folder, "");
    manifest.definitions.push(entryOf(definition, definition.files));
    console.log(`${definition.folder}: ${definition.files.length} files from ${definition.repo}@${definition.commit.slice(0, 10)}`);
  }

  await mkdir(ROOT, { recursive: true });
  await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${MANIFEST}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
