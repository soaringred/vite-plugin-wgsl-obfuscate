import { describe, it, expect } from "vitest";
import { obfuscateProject, BUILTIN_MEMBERS } from "@/index";
import { tintErrors } from "@tests/helpers/compilers";
import { LIB, EXTERNAL, link, accessSites, build, expectProven, expectUnproven, useSites } from "@tests/analysis/member-proof/helpers";
import { count, without } from "@tests/helpers/wgsl";

// A field is renamed only if every access to it is proven to read a struct the
// project declares. One test per proven form, and per form that must stay unproven.

// ── Proven ──────────────────────────────────────────────────────────

describe("proven: starting points", () => {
  it.each([
    ["a parameter", `fn value(p: Probe) -> f32 { return p.gain; }`, "gain"],
    ["a module-scope `var` with a type, in the same file", `var<private> mine: Probe; fn value() -> f32 { return mine.gain; }`, "gain"],
    ["a module-scope `var` with a type, in another file", `fn value() -> f32 { return single.gain; }`, "gain"],
    ["a module-scope `const` with a type", `fn value() -> f32 { return fixed.depth; }`, "depth"],
    ["a `let` with a type", `fn value() -> f32 { let p: Probe = makeProbe(); return p.gain; }`, "gain"],
    ["a local `var` with a type", `fn value() -> f32 { var p: Probe; return p.gain; }`, "gain"],
    ["a local `const` with a type", `fn value() -> f32 { const p: Inner = Inner(1.0); return p.depth; }`, "depth"],
    ["a call to a function with a declared return type", `fn value() -> f32 { return makeProbe().gain; }`, "gain"],
    ["a call to a function that returns an alias", `fn value() -> f32 { return makeAlias().gain; }`, "gain"],
    ["a struct constructor", `fn value() -> f32 { return Probe(1.0, Inner(2.0), array<Inner, 2>()).gain; }`, "gain"],
    ["a struct constructor through an alias", `fn value() -> f32 { return ProbeAlias(1.0, Inner(2.0), array<Inner, 2>()).gain; }`, "gain"],
    ["`array<S, N>(...)`", `fn value() -> f32 { return array<Inner, 2>(Inner(1.0), Inner(2.0))[1].depth; }`, "depth"],
  ])("%s", async (_, use, field) => {
    await expectProven({ files: { "use.wgsl": use } }, field);
  });
});

describe("proven: steps", () => {
  it.each([
    ["`.field` of a nested struct", `fn value(p: Probe) -> f32 { return p.inner.depth; }`, "depth"],
    ["`.field` giving the nested struct", `fn value(p: Probe) -> f32 { return p.inner.depth; }`, "inner"],
    ["`[index]` on an array field", `fn value(p: Probe) -> f32 { return p.list[1].depth; }`, "depth"],
    ["`[index]` on a runtime-sized array of structs", `@group(0) @binding(1) var<storage, read_write> probes: array<Probe>; fn value(i: u32) -> f32 { return probes[i].inner.depth; }`, "depth"],
    ["an alias of a struct", `fn value(p: ProbeAlias) -> f32 { return p.gain; }`, "gain"],
    ["an alias of an array of structs", `fn value(ps: Probes) -> f32 { return ps[2].gain; }`, "gain"],
    ["`*` on a pointer", `fn value(p: ptr<function, Probe>) -> f32 { return (*p).gain; }`, "gain"],
    ["automatic dereference of a pointer", `fn value(p: ptr<function, Probe>) -> f32 { return p.gain; }`, "gain"],
    ["automatic dereference of a pointer to an array", `fn value(p: ptr<function, array<Inner, 2>>) -> f32 { return p[0].depth; }`, "depth"],
    ["`&` and `*`", `fn value() -> f32 { var p = makeProbe(); let q = &p; return (*q).gain + q.inner.depth; }`, "gain"],
    ["`&` of a field", `fn value() -> f32 { var p = makeProbe(); let q = &p.inner; return q.depth; }`, "depth"],
    ["`*&`", `fn value() -> f32 { var p = makeProbe(); return (*&p).gain; }`, "gain"],
    ["parentheses", `fn value(p: Probe) -> f32 { return ((p)).gain + (p.inner).depth; }`, "gain"],
    ["a pointer to a module-scope variable", `var<private> one: Probe; fn value(p: ptr<private, Probe>) -> f32 { return p.gain; } fn caller() -> f32 { return value(&one); }`, "gain"],
  ])("%s", async (_, use, field) => {
    await expectProven({ files: { "use.wgsl": use } }, field);
  });
});

describe("proven: inferred declarations", () => {
  it.each([
    ["an inferred `let`", `fn value(p: Probe) -> f32 { let q = p; return q.gain; }`, "gain"],
    ["a chain of inferred `let`, `var` and `const`", `fn value(p: Probe) -> f32 { let a = p; let b = a.inner; var c = b; const d = Inner(1.0); let e = d; return c.depth + e.depth; }`, "depth"],
    ["an inferred `let` from a call, then an inferred `var` from a field", `fn value() -> f32 { let a = makeProbe(); var b = a.list; return b[0].depth; }`, "depth"],
    ["an inferred `let` from a dereference", `fn value(p: ptr<function, Probe>) -> f32 { let a = *p; return a.gain; }`, "gain"],
    ["an inferred `let` from a constructor", `fn value() -> f32 { let a = Probe(1.0, Inner(2.0), array<Inner, 2>()); return a.gain; }`, "gain"],
    ["an inferred `for` variable", `fn value() -> f32 { var t = 0.0; for (var p = makeProbe(); t < 1.0; t += 1.0) { t += p.gain; } return t; }`, "gain"],
    ["an inferred module-scope `var`", `var<private> inferred = Inner(1.0); fn value() -> f32 { return inferred.depth; }`, "depth"],
    ["an inferred module-scope `const`", `const preset = Inner(1.0); fn value() -> f32 { return preset.depth; }`, "depth"],
    ["an inferred `let` from a module-scope value in another file", `fn value() -> f32 { let a = single; let b = fixed; return a.inner.depth + b.depth; }`, "depth"],
  ])("%s", async (_, use, field) => {
    await expectProven({ files: { "use.wgsl": use } }, field);
  });
});

describe("proven: across files", () => {
  it("a struct, an alias and a function each declared in a different project file", async () => {
    await expectProven(
      {
        files: {
          "types.wgsl": `struct Beam { width: f32 }`,
          "alias.wgsl": `alias BeamAlias = Beam;`,
          "make.wgsl": `fn makeBeam() -> BeamAlias { return Beam(2.0); }`,
          "use.wgsl": `fn value(b: BeamAlias) -> f32 { let c = makeBeam(); return b.width + c.width; }`,
        },
        linked: ["types.wgsl", "alias.wgsl", "make.wgsl", "use.wgsl"],
      },
      "width",
    );
  });

  it("uses declared after the use, in a file listed earlier", async () => {
    await expectProven(
      {
        files: { "a-use.wgsl": `fn value(b: Beam) -> f32 { return b.width; }`, "z-types.wgsl": `struct Beam { width: f32 }` },
        linked: ["a-use.wgsl", "z-types.wgsl"],
      },
      "width",
    );
  });
});

describe("proven: the declaration in scope decides", () => {
  it("a parameter named like a struct has the parameter's type", async () => {
    // `Probe` is the parameter, of type `Inner`, not the struct `Probe`
    await expectProven({ files: { "use.wgsl": `fn value(Probe: Inner) -> f32 { return Probe.depth; }` } }, "depth");
  });

  it("a local that shadows a module-scope value of an external type has the local's type", async () => {
    await expectProven(
      {
        external: EXTERNAL,
        files: {
          "use.wgsl": `
            var<private> held: Light;
            fn value() -> f32 {
              var total = held.depth * 0.0;
              { let held = makeProbe(); total += held.gain; }
              return total;
            }`,
        },
      },
      "gain",
    );
  });

  it("a local named like a struct ends with its block", async () => {
    const use = `fn value() -> f32 { { let Probe = 1.0; _ = Probe; } var p: Probe; return p.gain; }`;
    await expectProven({ files: { "use.wgsl": use } }, "gain");
  });

  it("a parameter named like a struct does not affect another function", async () => {
    const use = `fn other(Probe: f32) -> f32 { return Probe; } fn value(p: Probe) -> f32 { return p.gain + other(1.0); }`;
    await expectProven({ files: { "use.wgsl": use } }, "gain");
  });

  it("a function whose body carries an attribute still has its return type", async () => {
    // Only Tint accepts an attribute on a function body
    const c = {
      files: {
        "use.wgsl": `
          fn makeBeam() -> Beam @diagnostic(off, derivative_uniformity) { return Beam(1.0); }
          struct Beam { width: f32 }
          fn value() -> f32 { return makeBeam().width; }`,
      },
    };
    const result = build(c);
    expect(result.report.memberMap.has("width")).toBe(true);
    const errors = await tintErrors(link(result.files["lib.wgsl"], result.files["use.wgsl"]));
    if (errors !== null) expect(errors).toEqual([]);
  });
});

// ── Unproven ────────────────────────────────────────────────────────

describe("unproven: types from outside the project", () => {
  it("a call to a function declared outside the project", async () => {
    const use = `fn value() -> f32 { return externalLight().gain; }`;
    await expectUnproven({ external: EXTERNAL, files: { "use.wgsl": use } }, "gain", useSites(use, "gain"));
  });

  it("a parameter whose type is declared outside the project", async () => {
    const use = `fn value(l: Light) -> f32 { return l.gain; }`;
    await expectUnproven({ external: EXTERNAL, files: { "use.wgsl": use } }, "gain", useSites(use, "gain"));
  });

  it("an inferred `let` from a call declared outside the project, and a chain from it", async () => {
    const use = `fn value() -> f32 { let l = externalLight(); let m = l; return l.depth + m.depth; }`;
    await expectUnproven({ external: EXTERNAL, files: { "use.wgsl": use } }, "depth", useSites(use, "depth"));
  });

  it("an external struct stays intact while another field of the same struct name is proven", async () => {
    // `gain` is read on the external `Light`; `inner` only on project structs
    const use = `fn value(p: Probe) -> f32 { return light.gain + p.inner.depth; }`;
    const { report } = await expectUnproven({ external: EXTERNAL, files: { "use.wgsl": use } }, "gain", useSites(use, "gain"));
    expect(report.memberMap.has("inner")).toBe(true);
  });
});

describe("unproven: builtin calls", () => {
  // Off the builtin-member list, the proof is the only defence, as for a
  // builtin result struct that WGSL adds later
  it("`modf` result members", async () => {
    await without(BUILTIN_MEMBERS, ["fract", "whole"], async () => {
      const lib = `struct Split { fract: f32, whole: f32 } fn joinSplit(s: Split) -> f32 { return s.fract + s.whole; }`;
      const use = `fn value(v: f32) -> f32 { let r = modf(v); return modf(v).fract + r.whole; }`;
      const c = { files: { "split.wgsl": lib, "use.wgsl": use }, linked: ["split.wgsl", "use.wgsl"] };
      const result = await expectUnproven(c, "fract", useSites(use, "fract"), "split.wgsl");
      expect(count(result.files["split.wgsl"], "whole")).toBe(2);
      expect(result.report.memberMap.has("whole")).toBe(false);
    });
  });

  it("`frexp` result members", async () => {
    await without(BUILTIN_MEMBERS, ["fract", "exp"], async () => {
      const lib = `struct Mantissa { fract: f32, exp: i32 } fn scaled(m: Mantissa) -> f32 { return ldexp(m.fract, m.exp); }`;
      const use = `fn value(v: f32) -> i32 { let parts = frexp(v); return parts.exp + i32(frexp(v).fract); }`;
      const c = { files: { "mantissa.wgsl": lib, "use.wgsl": use }, linked: ["mantissa.wgsl", "use.wgsl"] };
      await expectUnproven(c, "exp", useSites(use, "exp"), "mantissa.wgsl");
    });
  });

  it("`atomicCompareExchangeWeak` result members", async () => {
    await without(BUILTIN_MEMBERS, ["old_value", "exchanged"], async () => {
      const lib = `struct Swap { old_value: u32, exchanged: bool } fn swapped(s: Swap) -> u32 { return select(0u, s.old_value, s.exchanged); }`;
      const use = `
        @group(0) @binding(1) var<storage, read_write> counter: atomic<u32>;
        fn value() -> u32 {
          let r = atomicCompareExchangeWeak(&counter, 0u, 1u);
          let s = r;
          return select(0u, s.old_value, r.exchanged);
        }`;
      const c = { files: { "swap.wgsl": lib, "use.wgsl": use }, linked: ["swap.wgsl", "use.wgsl"] };
      await expectUnproven(c, "old_value", useSites(use, "old_value"), "swap.wgsl");
      await expectUnproven(c, "exchanged", useSites(use, "exchanged"), "swap.wgsl");
    });
  });

  it("with the builtin-member list intact, the members are kept by that rule, not in doubt", () => {
    const { report } = obfuscateProject({
      "split.wgsl": `struct Split { fract: f32, whole: f32 } fn joinSplit(s: Split) -> f32 { return s.fract + s.whole; }`,
      "use.wgsl": `fn value(v: f32) -> f32 { return modf(v).fract; }`,
    });
    expect(report.memberMap.has("fract")).toBe(false);
    expect(report.doubts).toEqual([]);
    expect(report.files["split.wgsl"].kept).toContainEqual({ name: "fract", space: "member", rule: "builtin-member" });
  });

  it("`workgroupUniformLoad` of a value whose type is not proven", async () => {
    // It returns what its argument points to, so the proof is only as good as the argument's
    const use = `
      var<workgroup> pending: Light;
      @compute @workgroup_size(1) fn main() { _ = value(); }
      fn value() -> f32 { let r = workgroupUniformLoad(&pending); return r.gain + workgroupUniformLoad(&pending).gain; }`;
    await expectUnproven({ external: EXTERNAL, files: { "use.wgsl": use } }, "gain", useSites(use, "gain"));
  });
});

describe("unproven: forms outside the proof", () => {
  it("an array constructor without a template list, whose elements' type is not proven", async () => {
    const use = `fn value() -> f32 { let a = array(externalLight(), externalLight()); return a[0].gain + array(light)[0].gain; }`;
    await expectUnproven({ external: EXTERNAL, files: { "use.wgsl": use } }, "gain", useSites(use, "gain"));
  });

  it("a `let` whose initializer is an arithmetic expression (report only: not valid WGSL)", () => {
    // WGSL has no arithmetic on structs, so this cannot compile; the proof
    // must still not treat it as proven
    const { report } = obfuscateProject({
      "lib.wgsl": LIB,
      "use.wgsl": `fn value(p: Probe, q: Probe) -> f32 { let a = p + q; let b = -p; let c = select(p, q, true); return a.gain + b.gain + c.gain; }`,
    });
    expect(report.memberMap.has("gain")).toBe(false);
    expect(report.doubts.find((d) => d.name === "gain")!.sites).toHaveLength(3);
  });
});

describe("unproven: names the proof cannot pin down", () => {
  it("a value declared in two project files", async () => {
    // other.wgsl is never linked with use.wgsl, but the proof cannot know which declaration applies
    const use = `fn value() -> f32 { return single.gain; }`;
    const c = { files: { "other.wgsl": `var<private> single: vec2f;`, "use.wgsl": use } };
    const { report } = await expectUnproven(c, "gain", useSites(use, "gain"));
    expect(report.doubts.find((d) => d.name === "gain")!.reason).toMatch(/`single` is declared more than once in the project \(lib\.wgsl, other\.wgsl\)/);
  });

  it("a struct declared in two project files", async () => {
    const use = `fn value(p: Probe) -> f32 { return p.gain; }`;
    const c = { files: { "other.wgsl": `struct Probe { level: f32 }`, "use.wgsl": use } };
    await expectUnproven(c, "gain", useSites(use, "gain"));
  });

  it("a local that shadows a module-scope value keeps its own, unproven type", async () => {
    const use = `
      fn value() -> f32 {
        var total = single.gain;
        { let single = externalLight(); total += single.gain; }
        return total;
      }`;
    await expectUnproven({ external: EXTERNAL, files: { "use.wgsl": use } }, "gain", useSites(use, "gain", [1]));
  });

  it("a local that shadows a parameter keeps its own, unproven type", async () => {
    const use = `
      fn value(p: Probe) -> f32 {
        var total = p.gain;
        { let p = externalLight(); total += p.gain; }
        return total;
      }`;
    await expectUnproven({ external: EXTERNAL, files: { "use.wgsl": use } }, "gain", useSites(use, "gain", [1]));
  });

  it("a local declared after a use in the same block does not change that use", async () => {
    const use = `
      fn value() -> f32 {
        let before = single.gain;
        let single = externalLight();
        return before + single.gain;
      }`;
    await expectUnproven({ external: EXTERNAL, files: { "use.wgsl": use } }, "gain", useSites(use, "gain", [1]));
  });

  it("a `for` variable that shadows a module-scope value", async () => {
    const use = `
      fn value() -> f32 {
        var t = single.gain;
        for (var single = externalLight(); t < 1.0; t += 1.0) { t += single.gain; }
        return t + single.gain;
      }`;
    await expectUnproven({ external: EXTERNAL, files: { "use.wgsl": use } }, "gain", useSites(use, "gain", [1]));
  });

  it("a local named like a struct holds a value of an external type", async () => {
    const use = `fn value() -> f32 { let Probe = externalLight(); return Probe.gain; }`;
    await expectUnproven({ external: EXTERNAL, files: { "use.wgsl": use } }, "gain", useSites(use, "gain"));
  });
});

describe("unproven: one access keeps the name in every file", () => {
  it("a single unproven access among proven ones", async () => {
    const use = `fn value(p: Probe) -> f32 { return p.gain + readGain(p) + makeProbe().gain + light.gain; }`;
    const { report } = await expectUnproven({ external: EXTERNAL, files: { "use.wgsl": use } }, "gain", useSites(use, "gain", [2]));
    const doubt = report.doubts.find((d) => d.name === "gain")!;
    expect(doubt.reason).toMatch(/^an access to `\.gain` could not be proven to read a struct the project declares: /);
    expect(doubt.files).toEqual(["lib.wgsl", "use.wgsl"]);
  });

  it("several unproven accesses in several files are all reported", async () => {
    const use = `fn value() -> f32 { return light.gain; }`;
    const more = `fn more() -> f32 { return externalLight().gain + light.gain; }`;
    const c = { external: EXTERNAL, files: { "use.wgsl": use, "more.wgsl": more }, linked: ["use.wgsl", "more.wgsl"] };
    const sites = [
      ...accessSites(more, "gain").map((s) => ({ file: "more.wgsl", ...s })),
      ...useSites(use, "gain"),
    ];
    const { report } = await expectUnproven(c, "gain", sites);
    expect(report.doubts.find((d) => d.name === "gain")!.reason).toMatch(/^3 accesses to `\.gain`/);
  });
});
