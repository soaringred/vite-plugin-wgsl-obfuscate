import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";
import {
  VITE_LINES,
  APPS_DIR,
  buildApp,
  buildError,
  shadersOf,
  pluginWarnings,
} from "@tests/helpers/plugin/build";
import { identifiers } from "@tests/helpers/wgsl";

// WGSL that ships as written, and input the plugin cannot bind late: invalid WGSL,
// bare WGSL text, modules it does not recognise, placeholders it did not make.

/** A fixture file as written. */
function source(app: string, file: string): string {
  return readFileSync(join(APPS_DIR, app, file), "utf8");
}

/** Wraps a `.wgsl` module without a query into a string module, after the plugin under test. */
const wrapBareWgsl: Plugin = {
  name: "test:wrap-bare-wgsl",
  enforce: "post",
  transform(code, id) {
    if (!/\.wgsl$/.test(id)) return null;
    return { code: `export default ${JSON.stringify(code)};`, map: null };
  },
};

/** A loader that turns `legacy.wgsl` into a JS module with a named export, before the plugin under test. */
const legacyLoader: Plugin = {
  name: "test:legacy-loader",
  enforce: "pre",
  transform(code, id) {
    if (!id.endsWith("legacy.wgsl")) return null;
    return { code: `export const source = ${JSON.stringify(code)};\nexport default source;`, map: null };
  },
};

describe.each(VITE_LINES)("%s", (line) => {
  describe("WGSL that ships as written", () => {
    it("fails the build when a ?url or new URL(...) file uses a renamed name, emitted or inlined as a data URL", async () => {
      const emitted = await buildError(line, "url", { build: { assetsInlineLimit: 0 } });
      expect(emitted.message).toMatch(/ {2}- shaders\/post\.wgsl \(emitted as \S+\.wgsl\): `tonemap` at 7:16/);
      const inlined = await buildError(line, "url");
      expect(inlined.message).toMatch(/ {2}- shaders\/post\.wgsl \(inlined into \S+\.js\): `tonemap` at 7:16/);
      const newUrl = await buildError(line, "url", { entry: "main-new-url.js" });
      expect(newUrl.message).toMatch(/ {2}- a WGSL file \(inlined into \S+\.js\): `gammaEncode` at 7:16/);
      for (const error of [emitted, inlined, newUrl]) {
        expect(error.message).toContain("A WGSL file that ships as written uses names that the plugin renamed:");
      }
    });
  });

  describe("input the plugin cannot bind late", () => {
    it("fails the build on invalid WGSL with the file, line and column", async () => {
      const error = await buildError(line, "invalid");
      expect(error.message).toContain(
        "Cannot obfuscate shaders/bad.wgsl:4:1: `#` is not WGSL. Preprocessor directives such as `#include`",
      );
      expect(error.message).toContain("leave it out of the plugin's `include` option");
    });

    it("obfuscates bare WGSL text alone with topLevel: keep, and fails when it uses a renamed name", async () => {
      const error = await buildError(line, "bare", { after: [wrapBareWgsl] });
      expect(error.message).toContain(
        "A WGSL file obfuscated alone uses names that the plugin renamed in the other shaders, so it will not link with them:\n" +
          "  - shaders/bare.wgsl: `SHARED_SCALE` at 8:24, `sharedOffset` at 7:15\n",
      );

      const app = await buildApp(line, "bare", { after: [wrapBareWgsl], plugin: { leakCheck: "warn" } });
      const { bare } = shadersOf(app);
      // Module-scope names and fields stay; locals are renamed
      for (const name of ["Vertex", "position", "shift", "sharedOffset", "SHARED_SCALE"]) expect(identifiers(bare)).toContain(name);
      for (const name of ["moved", "vertex", "amount"]) expect(identifiers(bare)).not.toContain(name);
      const warnings = pluginWarnings(app);
      expect(warnings).toHaveLength(2);
      expect(warnings[0]).toContain("1 WGSL file was obfuscated alone");
      expect(warnings[1]).toContain("A WGSL file obfuscated alone uses names that the plugin renamed");
    });

    it("strict fails on bare WGSL text", async () => {
      const error = await buildError(line, "bare", { after: [wrapBareWgsl], plugin: { strict: true } });
      expect(error.message).toContain("WGSL obfuscation (strict): 1 WGSL file was obfuscated alone");
    });

    it("leaves a module it does not recognise alone, and warns", async () => {
      const app = await buildApp(line, "unrecognised", { before: [legacyLoader] });
      const { core, legacy } = shadersOf(app);
      expect(legacy).toBe(source("unrecognised", "shaders/legacy.wgsl"));
      // Not checked: its names are renamed in core.wgsl like any other
      expect(identifiers(core)).not.toContain("attenuate");
      const warnings = pluginWarnings(app);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("Left 1 module as it is although `include` matches it: shaders/legacy.wgsl.");
    });

    it("fails when a module carries a placeholder that this build did not make", async () => {
      const stale: Plugin = {
        name: "test:stale-placeholder",
        transform(code, id) {
          if (!id.endsWith("main.js")) return null;
          return { code: `${code}\nglobalThis.stale = "__WGSL_OBFUSCATE_${"0".repeat(32)}__";\n`, map: null };
        },
      };
      const error = await buildError(line, "linked", { before: [stale] });
      expect(error.message).toContain(`main.js contains the placeholder __WGSL_OBFUSCATE_${"0".repeat(32)}__`);
    });
  });
});
