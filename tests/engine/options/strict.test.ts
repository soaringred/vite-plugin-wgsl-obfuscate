import { describe, it, expect } from "vitest";
import { obfuscate, obfuscateProject, StrictError } from "@/index";
import type { Doubt } from "@/index";
import { FILES } from "@tests/engine/options/helpers";

// `strict`, and the report's list of names kept because renaming them could
// not be proven safe (`doubts`).

/** Names in doubt in two files: unproven accesses to `width`, and `glow` and `u` used with an unknown attribute. */
const SRC = {
  "b.wgsl": `
      struct Beam { width: f32, glow: f32 }
      fn beamWidth(b: Beam) -> f32 { return b.width + ext.width; }`,
  "a.wgsl": `
      const glow = 1.0;
      fn a() -> f32 { return other.width + glow; }
      @group(0) @binding(0) @future(glow) var<uniform> u: f32;`,
};

/** One name in doubt: an access to `level` on a type the project does not declare. */
const UNPROVEN = `struct S { level: f32 } fn f(s: S) -> f32 { return s.level + other.level; }`;

/** The error that `fn` throws, which must be a StrictError. */
function strictErrorOf(fn: () => unknown): StrictError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(StrictError);
    return error as StrictError;
  }
  return expect.fail("expected a StrictError");
}

describe("strict", () => {
  it("is off by default; on, it throws a StrictError that carries the report's doubts", () => {
    const { report } = obfuscateProject(SRC);
    expect(report.doubts).toHaveLength(4);
    const error = strictErrorOf(() => obfuscateProject(SRC, { strict: true }));
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("StrictError");
    expect(error.doubts).toEqual(report.doubts);
  });

  it("changes nothing when no name is in doubt", () => {
    const strict = obfuscateProject(FILES, { strict: true });
    expect(strict.files).toEqual(obfuscateProject(FILES).files);
    expect(strict.report.doubts).toEqual([]);
  });

  it("names every kept name, where, why and how to unlock it", () => {
    const files = {
      "a.wgsl": `
        struct Grade { exposure: f32 }
        const K = 1;
        fn graded(g: Grade) -> f32 { return g.exposure + cam.exposure; }
        @group(0) @binding(0) @future(K) var<uniform> u: Grade;`,
    };
    const error = strictErrorOf(() => obfuscateProject(files, { strict: true }));
    expect(error.message).toBe(
      "WGSL obfuscation (strict): 3 names were kept because renaming them could not be proven safe:\n" +
        "  - K (module scope, unknown-attribute) in a.wgsl, at a.wgsl:5:39: used in the arguments of `@future`, " +
        "which the plugin does not know. To rename it: update the plugin to a version that knows `@future`.\n" +
        "  - u (module scope, unknown-attribute) in a.wgsl, at a.wgsl:5:55: variable `u` carries `@future`, which the " +
        "plugin does not know, so its name may be part of an interface. To rename it: update the plugin to a " +
        "version that knows `@future`.\n" +
        "  - exposure (struct field, unproven-access) in a.wgsl, at a.wgsl:4:62: an access to `.exposure` could not " +
        "be proven to read a struct the project declares: the type of `cam` is not proven: `cam` is not declared in " +
        "the project. To rename it: declare `cam` in a project file with an explicit type.\n" +
        "To accept a name as written instead, add it to `preserve`.",
    );
  });

  it("uses the singular for one name", () => {
    const error = strictErrorOf(() => obfuscate(UNPROVEN, { strict: true }));
    expect(error.message).toMatch(/^WGSL obfuscation \(strict\): 1 name was kept because renaming it could not be proven safe:\n/);
  });

  it.each([
    ["unproven-access", UNPROVEN],
    ["unknown-attribute", `const K = 1; @group(0) @binding(0) @future(K) var<uniform> u: f32;`],
  ])("fails on %s", (rule, src) => {
    const error = strictErrorOf(() => obfuscate(src, { strict: true }));
    expect(new Set(error.doubts.map((d) => d.rule))).toEqual(new Set([rule]));
  });

  it("fails on a local kept by an unknown attribute", () => {
    const error = strictErrorOf(() =>
      // `g` comes first, so `f` is not the leading function and `lane` is an ordinary parameter
      obfuscate(`fn g() {}\nfn f(lane: u32) -> u32 { @future(lane) { } return lane; }`, { strict: true }),
    );
    expect(error.doubts).toMatchObject([{ name: "lane", space: "local", rule: "unknown-attribute" }]);
  });

  it("passes once the names are preserved", () => {
    const error = strictErrorOf(() => obfuscateProject(SRC, { strict: true, preserve: ["glow", "u"] }));
    expect(error.doubts.map((d) => d.name)).toEqual(["width"]);
    expect(() => obfuscateProject(SRC, { strict: true, preserve: ["glow", "u", "width"] })).not.toThrow();
  });

  it("does not apply when names are not renamed", () => {
    expect(() => obfuscateProject(SRC, { strict: true, renameIdents: false })).not.toThrow();
    expect(() => obfuscateProject(SRC, { strict: true, topLevel: "keep" })).not.toThrow();
  });
});

// ── report.doubts ──────────────────────────────────────────────────

describe("report.doubts", () => {
  it("has one entry per name, space and rule, sorted by space, name and rule", () => {
    const { report } = obfuscateProject(SRC);
    expect(report.doubts.map((d) => `${d.space} ${d.name} ${d.rule}`)).toEqual([
      "module glow unknown-attribute",
      "module u unknown-attribute",
      "member glow unknown-attribute",
      "member width unproven-access",
    ]);
  });

  it("lists the files that declare or use the name, and every site sorted by file and position", () => {
    const { report } = obfuscateProject(SRC);
    const width = report.doubts.find((d) => d.name === "width")!;
    expect(width.files).toEqual(["a.wgsl", "b.wgsl"]);
    expect(width.sites).toEqual([
      { file: "a.wgsl", line: 3, column: 36 },
      { file: "b.wgsl", line: 3, column: 59 },
    ]);
    expect(width.reason).toMatch(/^2 accesses to `\.width` could not be proven/);
  });

  it("has exactly the documented fields", () => {
    const { report } = obfuscateProject(SRC);
    const keys = (d: Doubt) => Object.keys(d).sort();
    for (const doubt of report.doubts) {
      expect(keys(doubt)).toEqual(["action", "files", "name", "reason", "rule", "sites", "space"]);
    }
  });

  it("does not list a name another keep rule already keeps", () => {
    // `x` is kept as a swizzle and `main` as an entry point before any doubt
    const { report } = obfuscateProject({
      "a.wgsl": `struct P { x: f32 } @compute @workgroup_size(1) @future(main) fn main() { _ = other.x; }`,
    });
    expect(report.doubts).toEqual([]);
  });
});
