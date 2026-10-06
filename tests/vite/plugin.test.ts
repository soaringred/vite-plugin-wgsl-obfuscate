import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { wgslObfuscate } from "@/index";
import { expectValid, expectSameSpirv, expectComputePipeline } from "@tests/helpers/compilers";
import {
  VITE_LINES,
  APPS_DIR,
  hasEnvironments,
  buildApp,
  buildTogether,
  buildError,
  buildEnvironments,
  shadersOf,
  pluginWarnings,
  run,
  entryChunk,
  stringsIn,
  viteVersion,
  type BuiltApp,
} from "@tests/helpers/plugin/build";
import { identifiers } from "@tests/helpers/wgsl";

// The plugin through real builds on Vite 8 (Rolldown) and Vite 7, 6 and 5 (Rollup).

/** A fixture file as written. */
function source(app: string, file: string): string {
  return readFileSync(join(APPS_DIR, app, file), "utf8");
}

const LINKED_RENAMED = [
  // noise.wgsl
  "NOISE_SCALE", "Sample", "value", "gradient", "hashCell", "sampleNoise", "position", "scaled", "blend", "result",
  // terrain.wgsl
  "Params", "size", "amplitude", "params", "heights", "heightAt", "sample",
];

describe.each(VITE_LINES)("%s", (line) => {
  it("runs on the Vite major version it names", async () => {
    expect((await viteVersion(line)).split(".")[0]).toBe(line.slice("vite-".length));
  });

  describe("WGSL modules that use each other's names", () => {
    it.each([false, true])("renames them consistently, and the link compiles to the same SPIR-V (minify: %s)", async (minify) => {
      const app = await buildApp(line, "linked", { minify });
      const { noise, terrain } = shadersOf(app);
      const original = `${source("linked", "shaders/noise.wgsl")}\n${source("linked", "shaders/terrain.wgsl")}`;
      const output = `${noise}\n${terrain}`;

      await expectValid(original, "original link");
      await expectValid(output, "obfuscated link");
      expectSameSpirv(original, output);
      // JS still selects the entry point by name
      await expectComputePipeline(output, "buildTerrain");

      for (const name of LINKED_RENAMED) expect(identifiers(output), name).not.toContain(name);
      expect(identifiers(terrain)).toContain("buildTerrain");
      expect(output).not.toContain("noise library");
      expect(pluginWarnings(app)).toEqual([]);
    });

    it("renames a name that JS uses only as an identifier, and the JS still works", async () => {
      // main.js has `const sampleNoise`, `const heightAt` and a property key `NOISE_SCALE`
      for (const minify of [false, true]) {
        const app = await buildApp(line, "linked", { minify });
        const globals = run(entryChunk(app));
        expect(globals.scale).toBe(3);
        const { noise, terrain } = globals.shaders as Record<string, string>;
        for (const name of ["sampleNoise", "heightAt", "NOISE_SCALE"]) {
          expect(identifiers(`${noise}\n${terrain}`)).not.toContain(name);
        }
        // Not reported by the leak check either
        expect(pluginWarnings(app)).toEqual([]);
      }
    });

    it("does not fail when tree-shaking removes a transformed WGSL module", async () => {
      const app = await buildApp(line, "linked", { entry: "main-treeshake.js", minify: true });
      const { noise, terrain } = shadersOf(app);
      const output = `${noise}\n${terrain}`;
      expectSameSpirv(`${source("linked", "shaders/noise.wgsl")}\n${source("linked", "shaders/terrain.wgsl")}`, output);
      for (const file of app.files) {
        expect(file.text).not.toContain("__WGSL_OBFUSCATE_");
        expect(file.text).not.toContain("unusedHelper");
      }
    });

    it("writes shaders into chunks that are loaded later", async () => {
      const reference = shadersOf(await buildApp(line, "linked"));
      for (const minify of [false, true]) {
        const app = await buildApp(line, "linked", { entry: "main-lazy.js", minify });
        expect(app.files.filter((f) => f.type === "chunk").length).toBeGreaterThan(1);
        const strings = (await Promise.all(app.files.map((f) => stringsIn(line, f.text)))).flat();
        // The same project (noise and terrain), so the same output
        expect(strings.some((s) => s.includes(reference.noise))).toBe(true);
        expect(strings.some((s) => s.includes(reference.terrain))).toBe(true);
        for (const file of app.files) expect(file.text).not.toContain("__WGSL_OBFUSCATE_");
      }
    });
  });

  describe("engine options", () => {
    it("pass through to the engine", async () => {
      const app = await buildApp(line, "linked", { plugin: { prefix: "w", preserve: ["hashCell", "amplitude"] } });
      const { noise, terrain } = shadersOf(app);
      const output = `${noise}\n${terrain}`;
      expect(identifiers(output)).toContain("hashCell");
      expect(identifiers(output)).toContain("amplitude");
      expect(identifiers(output).filter((name) => name.startsWith("_"))).toEqual([]);
      expect(identifiers(output)).toContain("wa");
      expectSameSpirv(`${source("linked", "shaders/noise.wgsl")}\n${source("linked", "shaders/terrain.wgsl")}`, output);
    });

    it('topLevel: "keep" and renameIdents: false keep module-scope names', async () => {
      const kept = shadersOf(await buildApp(line, "linked", { plugin: { topLevel: "keep" } }));
      for (const name of ["NOISE_SCALE", "Sample", "sampleNoise", "value", "Params", "heights"]) {
        expect(identifiers(`${kept.noise}\n${kept.terrain}`)).toContain(name);
      }
      expect(identifiers(kept.noise)).not.toContain("scaled");

      const plain = shadersOf(await buildApp(line, "linked", { plugin: { renameIdents: false } }));
      expect(identifiers(plain.noise)).toEqual(identifiers(source("linked", "shaders/noise.wgsl")));
      expect(plain.noise).not.toContain("noise library");
    });
  });

  describe("include", () => {
    it("leaves files that include does not match untouched", async () => {
      const app = await buildApp(line, "extensions");
      const { glow, blur } = shadersOf(app);
      expect(glow).toBe(source("extensions", "shaders/glow.shader"));
      expect(blur).toBe(source("extensions", "shaders/blur.glsl"));
    });

    it("a custom pattern selects other files", async () => {
      const app = await buildApp(line, "extensions", { plugin: { include: /\.shader($|\?)/ } });
      const { glow, blur } = shadersOf(app);
      expect(identifiers(glow)).not.toContain("GLOW_RADIUS");
      expect(identifiers(glow)).not.toContain("glowWeight");
      await expectValid(glow);
      expectSameSpirv(source("extensions", "shaders/glow.shader"), glow);
      expect(blur).toBe(source("extensions", "shaders/blur.glsl"));
    });
  });

  describe("build environments", () => {
    it.runIf(hasEnvironments(line))("keep their own projects when they build at the same time with one plugin instance", async () => {
      // The ssr entry also imports unused.wgsl, so its project names differently
      const { client, ssr } = await buildEnvironments(line, "linked", { client: "main.js", ssr: "main-treeshake.js" });
      const alone = {
        client: shadersOf(await buildApp(line, "linked", { entry: "main.js" })),
        ssr: shadersOf(await buildApp(line, "linked", { entry: "main-treeshake.js" })),
      };
      expect(alone.client).not.toEqual(alone.ssr);
      expect(shadersOf(client)).toEqual(alone.client);
      expect(shadersOf(ssr)).toEqual(alone.ssr);
    });
  });

  describe("workers", () => {
    /** The shaders the worker bundle of the worker app puts on `globalThis`. */
    const workerShaders = (app: BuiltApp) => {
      const worker = app.files.filter((f) => /worker-[\w-]+\.js$/.test(f.fileName));
      expect(worker).toHaveLength(1);
      return run(worker[0]).shaders as Record<string, string>;
    };

    it("a worker bundle is a separate build: its shaders ship as written unless the plugin is in worker.plugins", async () => {
      const without = await buildApp(line, "worker");
      expect(workerShaders(without).sharpen).toBe(source("worker", "shaders/sharpen.wgsl"));
      expect(identifiers(shadersOf(without).average)).not.toContain("averageAround");
      expect(pluginWarnings(without)).toEqual([]);

      const withWorker = await buildApp(line, "worker", { workerPlugins: () => [wgslObfuscate()] });
      const { sharpen } = workerShaders(withWorker);
      for (const name of ["neighbourMean", "SHARPEN_AMOUNT", "inputImage", "center"]) expect(identifiers(sharpen)).not.toContain(name);
      expect(identifiers(sharpen)).toContain("sharpenMain");
      await expectValid(sharpen);
      expectSameSpirv(source("worker", "shaders/sharpen.wgsl"), sharpen);
      expect(shadersOf(withWorker)).toEqual(shadersOf(without));
    });
  });

  describe("builds that share one plugin instance", () => {
    it("keep their own results when they run at the same time in the same environment", async () => {
      // main-treeshake.js also imports unused.wgsl, so its build names differently from the build of main.js
      const alone = await Promise.all(["main.js", "main-treeshake.js"].map((entry) => buildApp(line, "linked", { entry })));
      expect(shadersOf(alone[0])).not.toEqual(shadersOf(alone[1]));
      const together = await buildTogether(line, "linked", ["main.js", "main-treeshake.js"]);
      expect(shadersOf(together[0])).toEqual(shadersOf(alone[0]));
      expect(shadersOf(together[1])).toEqual(shadersOf(alone[1]));
    });

    it("keep their own results when they run one after the other", async () => {
      const instance = wgslObfuscate();
      const entries = ["main.js", "main-treeshake.js", "main.js"];
      for (const entry of entries) {
        const shared = await buildApp(line, "linked", { entry, instance });
        expect(shadersOf(shared)).toEqual(shadersOf(await buildApp(line, "linked", { entry })));
      }
    });
  });

});

describe("vite-8: WGSL handed to a shader call", () => {
  it("fails the build when it uses a renamed name, naming the place, the call and the names", async () => {
    const error = await buildError("vite-8", "mentions", { entry: "main-wgslfn.js" });
    expect(error.message).toContain(
      "A shader in a JS string uses names that the plugin renamed, so it will not link with the obfuscated shaders:\n" +
        "  - main-wgslfn.js:5: `wgslFn(...)` uses `DRAG`\n" +
        "Move the shader into a `.wgsl` file imported with `?raw`",
    );
  });

  it("builds when leakIgnore lists the names", async () => {
    const app = await buildApp("vite-8", "mentions", { entry: "main-wgslfn.js", plugin: { leakIgnore: ["DRAG"] } });
    expect(pluginWarnings(app)).toEqual([]);
  });

  it("ignores a string elsewhere, even one that holds a renamed name", async () => {
    // ui.js builds a label from `Particle` and `DRAG`; neither is passed to a shader call
    const app = await buildApp("vite-8", "mentions");
    const { particles } = shadersOf(app);
    for (const name of ["Particle", "DRAG", "speed"]) expect(identifiers(particles)).not.toContain(name);
    expectSameSpirv(source("mentions", "shaders/particles.wgsl"), particles);
    expect(run(entryChunk(app)).label).toBe("Particle count: 10 (DRAG 6)");
    expect(pluginWarnings(app)).toEqual([]);
  });
});

describe("plugin options", () => {
  it("is a post plugin that only runs in builds", () => {
    const plugin = wgslObfuscate();
    expect(plugin.name).toBe("vite-plugin-wgsl-obfuscate");
    expect(plugin.apply).toBe("build");
    expect(plugin.enforce).toBe("post");
  });

  it("rejects invalid options when the plugin is created", () => {
    expect(() => wgslObfuscate({ include: "wgsl" as unknown as RegExp })).toThrow(/`include` must be a regular expression/);
    expect(() => wgslObfuscate({ leakCheck: "loud" as "warn" })).toThrow(/`leakCheck`/);
    expect(() => wgslObfuscate({ leakIgnore: "PI" as unknown as string[] })).toThrow(/`leakIgnore`/);
    expect(() => wgslObfuscate({ wgslCalls: ["wgsl-fn"] })).toThrow(/`wgslCalls`/);
    expect(() => wgslObfuscate({ prefix: "__x" })).toThrow(/invalid `prefix`/);
  });
});
