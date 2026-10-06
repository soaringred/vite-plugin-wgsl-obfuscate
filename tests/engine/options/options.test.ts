import { describe, it, expect, vi, afterEach } from "vitest";
import { obfuscate, obfuscateProject } from "@/index";
import { expectValid, expectSameSpirv } from "@tests/helpers/compilers";
import { count, identifiers } from "@tests/helpers/wgsl";

// Engine options not covered with the keep rules or in their own files.

const SHADER = `
  // Particle integrator
  const DRAG: f32 = 0.98;
  struct Particle { place: vec3f, speed: vec3f }
  @group(0) @binding(0) var<storage, read_write> swarm: array<Particle>;
  fn damped(speed: vec3f) -> vec3f { return speed * DRAG; }
  @compute @workgroup_size(64)
  fn integrate(@builtin(global_invocation_id) gid: vec3u) {
    let index = gid.x;
    swarm[index].speed = damped(swarm[index].speed);
    swarm[index].place += swarm[index].speed * 0.016;
  }
`;

describe("renameIdents: false", () => {
  it("only strips comments and collapses whitespace", async () => {
    const { files, report } = obfuscateProject({ "a.wgsl": SHADER }, { renameIdents: false });
    const out = files["a.wgsl"];
    expect(identifiers(out)).toEqual(identifiers(SHADER));
    expect(out).not.toContain("Particle integrator");
    expect(out).not.toMatch(/\s\s/);
    expect(report.moduleMap.size).toBe(0);
    expect(report.memberMap.size).toBe(0);
    await expectValid(out);
    expectSameSpirv(SHADER, out);
  });
});

describe("collapseWhitespace: false", () => {
  it("keeps whitespace as written and still renames", async () => {
    const out = obfuscate(SHADER, { collapseWhitespace: false });
    expect(out.split("\n").length).toBe(SHADER.split("\n").length);
    expect(out).not.toContain("Particle integrator");
    expect(identifiers(out)).not.toContain("swarm");
    await expectValid(out);
    expectSameSpirv(SHADER, out);
  });
});

describe("topLevel: keep", () => {
  it("leaves module-scope names and struct fields untouched, renames locals, and reports the rule", async () => {
    const out = obfuscate(SHADER, { topLevel: "keep" });
    const names = identifiers(out);
    for (const name of ["DRAG", "Particle", "place", "speed", "swarm", "damped", "integrate"]) {
      expect(names).toContain(name);
    }
    // `speed` stays as a field; the parameter of `damped` is renamed
    expect(count(out, "speed")).toBeLessThan(count(SHADER, "speed"));
    expect(names).not.toContain("gid");
    expect(names).not.toContain("index");
    await expectValid(out);
    expectSameSpirv(SHADER, out);

    const { report } = obfuscateProject({ "a.wgsl": SHADER }, { topLevel: "keep" });
    expect(report.moduleMap.size).toBe(0);
    expect(report.memberMap.size).toBe(0);
    expect(report.files["a.wgsl"].kept).toContainEqual({ name: "DRAG", space: "module", rule: "top-level" });
    expect(report.files["a.wgsl"].kept).toContainEqual({ name: "place", space: "member", rule: "top-level" });
  });
});

describe("verify", () => {
  it("false skips the self-checks", async () => {
    // Swap in self-checks that always fail
    vi.resetModules();
    vi.doMock("@/engine/verify", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/engine/verify")>()),
      verifyBuild: () => {
        throw new Error("self-checks ran");
      },
    }));
    try {
      const fresh = await import("@/engine/obfuscate");
      expect(() => fresh.obfuscate(SHADER)).toThrow("self-checks ran");
      expect(() => fresh.obfuscate(SHADER, { verify: false })).not.toThrow();
    } finally {
      vi.doUnmock("@/engine/verify");
      vi.resetModules();
    }
  });
});

describe("removed inlineConsts option", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("warns once per process and is ignored", async () => {
    vi.resetModules();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fresh = await import("@/engine/obfuscate");
    const src = `const LIMIT: u32 = 8u; fn capped(n: u32) -> u32 { return min(n, LIMIT); } fn other() {}`;
    const legacy = { inlineConsts: true } as Parameters<typeof fresh.obfuscate>[1];

    const out = fresh.obfuscate(src, legacy);
    fresh.obfuscate(src, legacy);
    fresh.obfuscate(src, { inlineConsts: false } as Parameters<typeof fresh.obfuscate>[1]);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/`inlineConsts` option was removed .* Remove the option from your config\.$/);
    // Ignored: the const is kept, and the output equals a run without the option
    expect(out).toBe(fresh.obfuscate(src));
    expect(identifiers(out)).toContain("const");
  });

  it("does not warn when the option is absent", async () => {
    vi.resetModules();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fresh = await import("@/engine/obfuscate");
    fresh.obfuscate(SHADER);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("invalid option values", () => {
  it.each([
    ["preserve", "PI", "`preserve` must be an array of names"],
    ["preserve", ["PI", 3], "`preserve` must be an array of names"],
    ["topLevel", "kep", '`topLevel` must be "rename" or "keep", not "kep"'],
    ["wgslFnParams", "renam", '`wgslFnParams` must be "keep" or "rename", not "renam"'],
    ["renameIdents", "false", '`renameIdents` must be true or false, not "false"'],
    ["collapseWhitespace", 0, "`collapseWhitespace` must be true or false, not 0"],
    ["strict", "yes", '`strict` must be true or false, not "yes"'],
    ["verify", null, "`verify` must be true or false, not null"],
  ])("rejects %s: %j", (option, value, message) => {
    const options = { [option]: value } as unknown as Parameters<typeof obfuscate>[1];
    expect(() => obfuscate(SHADER, options)).toThrow(TypeError);
    expect(() => obfuscate(SHADER, options)).toThrow(message);
  });

  it("accepts every option at a valid value", async () => {
    const out = obfuscate(SHADER, {
      preserve: ["DRAG"], renameIdents: true, collapseWhitespace: true, topLevel: "rename",
      wgslFnParams: "keep", strict: false, verify: true,
    });
    expect(out).toContain("DRAG");
    await expectValid(out);
  });
});
