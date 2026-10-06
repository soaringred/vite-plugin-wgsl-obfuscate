import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";
import { expectValid, expectSameSpirv } from "@tests/helpers/compilers";
import {
  VITE_LINES,
  APPS_DIR,
  buildApp,
  buildError,
  shadersOf,
  pluginWarnings,
  run,
  entryChunk,
} from "@tests/helpers/plugin/build";
import { originalPositionFor, positionOf } from "@/vite/calls/source-map";
import { identifiers } from "@tests/helpers/wgsl";

// What the plugin writes into the bundle: placeholders in every quote style and
// chunk, source maps, and the checks in `generateBundle`.

const PLACEHOLDER = /__WGSL_OBFUSCATE_[0-9a-f]{32}__/;

function source(file: string): string {
  return readFileSync(join(APPS_DIR, "linked", file), "utf8");
}

const ORIGINAL_LINK = `${source("shaders/noise.wgsl")}\n${source("shaders/terrain.wgsl")}`;

/** Puts every placeholder literal in `quote` quotes, before the plugin under test replaces them. */
function requote(quote: string): Plugin {
  return {
    name: "test:requote",
    enforce: "post",
    renderChunk(code) {
      return code.replace(/(["'`])(__WGSL_OBFUSCATE_[0-9a-f]{32}__)\1/g, `${quote}$2${quote}`);
    },
  };
}

/** Records the entry chunk as the plugin under test's `renderChunk` left it, before minification and re-quoting. */
function renderedEntry(): Plugin & { code: string } {
  const spy = {
    name: "test:rendered-entry",
    enforce: "post" as const,
    code: "",
    renderChunk(code: string, chunk: { isEntry: boolean }) {
      if (chunk.isEntry) spy.code = code;
      return null;
    },
  };
  return spy;
}

/** Appends a second copy of the first placeholder literal to the entry chunk. */
const duplicatePlaceholder: Plugin = {
  name: "test:duplicate-placeholder",
  enforce: "post",
  renderChunk(code, chunk) {
    if (!chunk.isEntry) return null;
    const literal = /(["'`])__WGSL_OBFUSCATE_[0-9a-f]{32}__\1/.exec(code);
    if (!literal) throw new Error("no placeholder in the entry chunk");
    return `${code}\nglobalThis.again = ${literal[0]};\n`;
  },
};

/** Copies the placeholder of noise.wgsl into the entry chunk after `renderChunk`, or into an asset. */
function copyPlaceholder(into: "chunk" | "asset"): Plugin {
  let placeholder = "";
  return {
    name: "test:copy-placeholder",
    enforce: "post",
    transform(code, id) {
      if (id.includes("noise.wgsl")) placeholder = PLACEHOLDER.exec(code)?.[0] ?? "";
      return null;
    },
    buildEnd() {
      if (into === "asset") this.emitFile({ type: "asset", fileName: "copy.txt", source: `shader: ${placeholder}` });
    },
    renderChunk(code, chunk) {
      return into === "chunk" && chunk.isEntry ? `${code}\nglobalThis.copy = "${placeholder}";\n` : null;
    },
  };
}

describe.each(VITE_LINES)("%s", (line) => {
  describe("placeholders", () => {
    it.each(['"', "'", "`"])("are replaced inside %s quotes, with and without collapseWhitespace", async (quote) => {
      for (const collapseWhitespace of [true, false]) {
        const reference = shadersOf(await buildApp(line, "linked", { plugin: { collapseWhitespace } }));
        const rendered = renderedEntry();
        const app = await buildApp(line, "linked", { plugin: { collapseWhitespace }, before: [requote(quote)], after: [rendered] });
        // The plugin wrote the shader between these quotes (later steps may re-quote it)
        const escaped = reference.noise.replace(/\n/g, "\\n");
        expect(rendered.code).toContain(`${quote}${escaped}${quote}`);
        const shaders = shadersOf(app);
        expect(shaders).toEqual(reference);
        if (!collapseWhitespace) {
          expect(shaders.noise.split("\n").length).toBe(source("shaders/noise.wgsl").split("\n").length);
        }
        await expectValid(`${shaders.noise}\n${shaders.terrain}`);
        expectSameSpirv(ORIGINAL_LINK, `${shaders.noise}\n${shaders.terrain}`);
      }
    });

    it("are replaced when minified, with whitespace kept", async () => {
      const app = await buildApp(line, "linked", { minify: true, plugin: { collapseWhitespace: false } });
      const shaders = shadersOf(app);
      expect(shaders.terrain).toContain("\n");
      for (const name of ["NOISE_SCALE", "Sample", "sampleNoise"]) expect(identifiers(shaders.terrain)).not.toContain(name);
      expectSameSpirv(ORIGINAL_LINK, `${shaders.noise}\n${shaders.terrain}`);
    });

    it("are all replaced when one appears several times in a chunk", async () => {
      const app = await buildApp(line, "linked", { before: [duplicatePlaceholder] });
      const globals = run(entryChunk(app));
      expect(Object.values(globals.shaders as Record<string, string>)).toContain(globals.again);
      expect(entryChunk(app).text).not.toMatch(PLACEHOLDER);
    });

    it("are replaced in every output of a build with several outputs", async () => {
      const reference = shadersOf(await buildApp(line, "linked"));
      const app = await buildApp(line, "linked", {
        output: [
          { format: "es", entryFileNames: "[name].mjs" },
          { format: "cjs", entryFileNames: "[name].cjs" },
        ],
      });
      const entries = app.files.filter((f) => f.isEntry);
      expect(entries.map((f) => f.fileName).sort()).toEqual(["main.cjs", "main.mjs"]);
      for (const entry of entries) expect(run(entry).shaders).toEqual(reference);
    });
  });

  describe("source maps", () => {
    it.each([false, true])("map a position after a shader to its original line (minify: %s)", async (minify) => {
      const app = await buildApp(line, "linked", { sourcemap: true, minify });
      const chunk = entryChunk(app);
      expect(chunk.map).toBeTruthy();

      // The marker's string literal, after both shaders in the output
      const offset = chunk.text.indexOf("AFTER_THE_SHADERS") - 1;
      expect(offset).toBeGreaterThan(chunk.text.indexOf("buildTerrain"));
      const generated = positionOf(chunk.text, offset);
      const original = originalPositionFor(chunk.map!, generated.line, generated.column);

      const main = readFileSync(join(APPS_DIR, "linked", "main.js"), "utf8");
      const expected = positionOf(main, main.indexOf('"AFTER_THE_SHADERS"'));
      expect(original?.source).toMatch(/main\.js$/);
      expect(original?.line).toBe(expected.line);
    });

    it("do not carry the original shader text", async () => {
      const app = await buildApp(line, "linked", { sourcemap: true });
      const maps = app.files.filter((f) => f.fileName.endsWith(".map"));
      expect(maps.length).toBeGreaterThan(0);
      for (const map of maps) {
        expect(map.text).not.toContain("hashCell");
        expect(map.text).not.toContain("noise library");
      }
    });
  });

  describe("leftover placeholders", () => {
    it("fail the build when one is left in a chunk", async () => {
      const error = await buildError(line, "linked", { after: [copyPlaceholder("chunk")] });
      expect(error.message).toMatch(/A placeholder of vite-plugin-wgsl-obfuscate is left in the bundle: \S+\.js/);
      expect(error.message).toContain("(standing for shaders/noise.wgsl?raw)");
      expect(error.message).toContain("leave the shader out of `include` so that it ships as written");
    });

    it("fail the build when one is left in an asset", async () => {
      const error = await buildError(line, "linked", { after: [copyPlaceholder("asset")] });
      expect(error.message).toContain("left in the bundle: copy.txt (standing for shaders/noise.wgsl?raw)");
    });
  });

  describe("a WGSL file loaded with new URL(...) and emitted as an asset", () => {
    // extra.wgsl never enters the module graph, and it uses `gammaEncode` from lib.wgsl
    const NEW_URL = { entry: "main-new-url.js", build: { assetsInlineLimit: 0 } };

    it.each(["warn", "error"] as const)('fails the build with leakCheck: "%s", naming the file, the names and the fixes', async (leakCheck) => {
      const error = await buildError(line, "url", { ...NEW_URL, plugin: { leakCheck } });
      expect(error.message).toMatch(
        /A WGSL file that ships as written uses names that the plugin renamed:\n {2}- shaders\/extra\.wgsl \(emitted as \S*extra-\S+\.wgsl\): `gammaEncode` at 7:16\n/,
      );
      expect(error.message).toContain("loaded with `new URL(..., import.meta.url)`");
      for (const fix of ["`?raw`", "`preserve`", "`leakIgnore`"]) expect(error.message).toContain(fix);
    });

    it("still fails when leakIgnore lists only other names", async () => {
      const error = await buildError(line, "url", { ...NEW_URL, plugin: { leakIgnore: ["tonemap"] } });
      expect(error.message).toContain("`gammaEncode` at 7:16");
    });

    it('builds when leakIgnore lists every such name, or with leakCheck: "off"', async () => {
      for (const plugin of [{ leakIgnore: ["gammaEncode"] }, { leakCheck: "off" as const }]) {
        const app = await buildApp(line, "url", { ...NEW_URL, plugin });
        expect(app.files.some((f) => /extra-\S+\.wgsl$/.test(f.fileName))).toBe(true);
        expect(pluginWarnings(app)).toEqual([]);
      }
    });
  });
});
