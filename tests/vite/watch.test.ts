import { describe, it, expect } from "vitest";
import { expectValid, expectSameSpirv } from "@tests/helpers/compilers";
import { VITE_LINES, buildApp, copyApp, watchApp, run, pluginWarnings, type BuiltApp, type OutputFile } from "@tests/helpers/plugin/build";
import { identifiers } from "@tests/helpers/wgsl";

// A rebuild transforms only changed modules (Vite 5 to 7) or all (Vite 8); either way
// every shader must match a fresh build of the same files.

function built(result: BuiltApp | Error): BuiltApp {
  if (result instanceof Error) throw result;
  return result;
}

function shaders(app: BuiltApp): Record<string, string> {
  const entries = app.files.filter((f: OutputFile) => f.isEntry);
  expect(entries).toHaveLength(1);
  return run(entries[0]).shaders as Record<string, string>;
}

/** A new, most used declaration: every other module-scope name moves down one generated name. */
const WARP = `
const WARP: f32 = 1.5;
fn warp(p: vec2f) -> vec2f {
  return p * WARP + vec2f(WARP * WARP - WARP);
}
`;

describe.each(VITE_LINES)("%s watch mode", (line) => {
  it("rebuilds every shader, changed or not, as a fresh build would", { timeout: 60_000 }, async () => {
    const app = copyApp("linked");
    const noise = app.read("shaders/noise.wgsl");
    const terrain = app.read("shaders/terrain.wgsl");
    const noiseWithWarp = `${noise}${WARP}`;
    let first: Record<string, string> = {};

    try {
      await watchApp(line, app.root, { minify: true }, [
        {
          check: async (result) => {
            first = shaders(built(result));
            expectSameSpirv(`${noise}\n${terrain}`, `${first.noise}\n${first.terrain}`);
          },
        },
        {
          // Only noise.wgsl changes; terrain.wgsl must follow its new names
          change: () => app.write("shaders/noise.wgsl", noiseWithWarp),
          check: async (result) => {
            const rebuilt = shaders(built(result));
            expect(rebuilt.terrain).not.toBe(first.terrain);
            expect(rebuilt).toEqual(shaders(await buildApp(line, app.root, { minify: true })));
            const output = `${rebuilt.noise}\n${rebuilt.terrain}`;
            await expectValid(output);
            expectSameSpirv(`${noiseWithWarp}\n${terrain}`, output);
            expect(identifiers(output)).not.toContain("WARP");
          },
        },
        {
          // An invalid shader fails the rebuild...
          change: () => app.write("shaders/noise.wgsl", `${noise}\n#define BROKEN\n`),
          check: (result) => {
            expect(result).toBeInstanceOf(Error);
            expect((result as Error).message).toContain("Cannot obfuscate shaders/noise.wgsl:");
          },
        },
        {
          // ...and fixing it recovers
          change: () => app.write("shaders/noise.wgsl", noise),
          check: async (result) => {
            const rebuilt = shaders(built(result));
            expect(rebuilt).toEqual(first);
          },
        },
        {
          // terrain.wgsl leaves the graph, and so the project
          change: () => app.write("main.js", 'import noise from "./shaders/noise.wgsl?raw";\nglobalThis.shaders = { noise };\n'),
          check: async (result) => {
            const rebuilt = built(result);
            expect(pluginWarnings(rebuilt)).toEqual([]);
            expect(shaders(rebuilt)).toEqual(shaders(await buildApp(line, app.root, { minify: true })));
            expect(Object.keys(shaders(rebuilt))).toEqual(["noise"]);
          },
        },
      ]);
    } finally {
      app.remove();
    }
  });
});
