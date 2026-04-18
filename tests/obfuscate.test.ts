import { describe, it, expect } from "vitest";
import { tokenize, extractEntryPoints } from "@/tokenizer";
import { buildRenameMap, inlineConsts } from "@/transforms";
import { obfuscate } from "@/obfuscate";
import { RESERVED, BUILTINS } from "@/wgsl-grammar";

// ── Helpers ─────────────────────────────────────────────────────────

/** Run the full pipeline with specific flags disabled for isolation. */
function pipeline(
  src: string,
  opts: Parameters<typeof obfuscate>[1] = {},
): string {
  return obfuscate(src, opts);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. Tokenizer
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("tokenizer", () => {
  describe("basic token types", () => {
    it("tokenizes identifiers", () => {
      const toks = tokenize("myVar");
      expect(toks).toHaveLength(1);
      expect(toks[0].type).toBe("ident");
      expect(toks[0].value).toBe("myVar");
    });

    it("tokenizes integer numbers", () => {
      const toks = tokenize("42");
      expect(toks).toHaveLength(1);
      expect(toks[0].type).toBe("number");
      expect(toks[0].value).toBe("42");
    });

    it("tokenizes float numbers", () => {
      const toks = tokenize("3.14");
      expect(toks).toHaveLength(1);
      expect(toks[0].type).toBe("number");
      expect(toks[0].value).toBe("3.14");
    });

    it("tokenizes operators and punctuation as op", () => {
      const toks = tokenize("+ - * / = ; { } ( ) , < >");
      const ops = toks.filter((t) => t.type === "op");
      expect(ops.map((t) => t.value)).toEqual([
        "+", "-", "*", "/", "=", ";", "{", "}", "(", ")", ",", "<", ">",
      ]);
    });

    it("tokenizes attributes with @ prefix", () => {
      const toks = tokenize("@compute");
      expect(toks).toHaveLength(1);
      expect(toks[0].type).toBe("attribute");
      expect(toks[0].value).toBe("@compute");
    });

    it("tokenizes line comments", () => {
      const toks = tokenize("// this is a comment\nfn");
      const comment = toks.find((t) => t.type === "comment");
      expect(comment).toBeDefined();
      expect(comment!.value).toBe("// this is a comment");
    });

    it("tokenizes block comments", () => {
      const toks = tokenize("/* block */ fn");
      const comment = toks.find((t) => t.type === "comment");
      expect(comment).toBeDefined();
      expect(comment!.value).toBe("/* block */");
    });

    it("tokenizes whitespace runs as single tokens", () => {
      const toks = tokenize("a   b");
      expect(toks).toHaveLength(3);
      expect(toks[1].type).toBe("whitespace");
      expect(toks[1].value).toBe("   ");
    });
  });

  describe("numeric edge cases", () => {
    it("tokenizes hex numbers", () => {
      const toks = tokenize("0xFF");
      expect(toks).toHaveLength(1);
      expect(toks[0]).toMatchObject({ type: "number", value: "0xFF" });
    });

    it("tokenizes hex with uppercase X", () => {
      const toks = tokenize("0X1A");
      expect(toks).toHaveLength(1);
      expect(toks[0]).toMatchObject({ type: "number", value: "0X1A" });
    });

    it("tokenizes scientific notation", () => {
      const toks = tokenize("1.5e10");
      expect(toks).toHaveLength(1);
      expect(toks[0]).toMatchObject({ type: "number", value: "1.5e10" });
    });

    it("tokenizes scientific notation with negative exponent", () => {
      const toks = tokenize("2.0E-3");
      expect(toks).toHaveLength(1);
      expect(toks[0]).toMatchObject({ type: "number", value: "2.0E-3" });
    });

    it("tokenizes scientific notation with positive exponent sign", () => {
      const toks = tokenize("1e+5");
      expect(toks).toHaveLength(1);
      expect(toks[0]).toMatchObject({ type: "number", value: "1e+5" });
    });

    it("tokenizes type suffix u", () => {
      const toks = tokenize("256u");
      expect(toks).toHaveLength(1);
      expect(toks[0]).toMatchObject({ type: "number", value: "256u" });
    });

    it("tokenizes type suffix f", () => {
      const toks = tokenize("1.0f");
      expect(toks).toHaveLength(1);
      expect(toks[0]).toMatchObject({ type: "number", value: "1.0f" });
    });

    it("tokenizes type suffix h", () => {
      const toks = tokenize("1.0h");
      expect(toks).toHaveLength(1);
      expect(toks[0]).toMatchObject({ type: "number", value: "1.0h" });
    });

    it("tokenizes type suffix i", () => {
      const toks = tokenize("42i");
      expect(toks).toHaveLength(1);
      expect(toks[0]).toMatchObject({ type: "number", value: "42i" });
    });

    it("tokenizes leading-dot float (.5)", () => {
      const toks = tokenize(".5");
      expect(toks).toHaveLength(1);
      expect(toks[0]).toMatchObject({ type: "number", value: ".5" });
    });

    it("treats negative sign as a separate operator token", () => {
      const toks = tokenize("-42");
      expect(toks).toHaveLength(2);
      expect(toks[0]).toMatchObject({ type: "op", value: "-" });
      expect(toks[1]).toMatchObject({ type: "number", value: "42" });
    });
  });

  describe("entry point detection", () => {
    it("detects @compute entry point", () => {
      const toks = tokenize("@compute @workgroup_size(64) fn main() {}");
      const ep = extractEntryPoints(toks);
      expect(ep.has("main")).toBe(true);
    });

    it("detects @vertex entry point", () => {
      const toks = tokenize("@vertex fn vs_main() -> @builtin(position) vec4f {}");
      const ep = extractEntryPoints(toks);
      expect(ep.has("vs_main")).toBe(true);
    });

    it("detects @fragment entry point", () => {
      const toks = tokenize("@fragment fn fs_main() -> @location(0) vec4f {}");
      const ep = extractEntryPoints(toks);
      expect(ep.has("fs_main")).toBe(true);
    });

    it("detects multiple entry points in the same source", () => {
      const src = `
        @vertex fn vertMain() -> @builtin(position) vec4f { return vec4f(0.0); }
        @fragment fn fragMain() -> @location(0) vec4f { return vec4f(1.0); }
      `;
      const ep = extractEntryPoints(tokenize(src));
      expect(ep.has("vertMain")).toBe(true);
      expect(ep.has("fragMain")).toBe(true);
      expect(ep.size).toBe(2);
    });

    it("does not treat non-entry functions as entry points", () => {
      const src = `
        fn helper() -> f32 { return 1.0; }
        @compute @workgroup_size(1) fn main() {}
      `;
      const ep = extractEntryPoints(tokenize(src));
      expect(ep.has("main")).toBe(true);
      expect(ep.has("helper")).toBe(false);
    });

    it("handles @workgroup_size with parenthesised arguments before fn", () => {
      const src = "@compute @workgroup_size(8, 8, 1) fn myKernel() {}";
      const ep = extractEntryPoints(tokenize(src));
      expect(ep.has("myKernel")).toBe(true);
    });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. Rename
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("rename identifiers", () => {
  it("does NOT rename WGSL keywords", () => {
    const tokens = tokenize("fn var let const struct if else return for while");
    const map = buildRenameMap(tokens, new Set());
    for (const kw of ["fn", "var", "let", "const", "struct", "if", "else", "return", "for", "while"]) {
      expect(map.has(kw)).toBe(false);
    }
  });

  it("does NOT rename WGSL builtins", () => {
    const tokens = tokenize("sqrt abs sin cos dot normalize clamp mix");
    const map = buildRenameMap(tokens, new Set());
    for (const b of ["sqrt", "abs", "sin", "cos", "dot", "normalize", "clamp", "mix"]) {
      expect(map.has(b)).toBe(false);
    }
  });

  it("does NOT rename swizzle components", () => {
    const tokens = tokenize("x y z w r g b a");
    const map = buildRenameMap(tokens, new Set());
    for (const s of ["x", "y", "z", "w", "r", "g", "b", "a"]) {
      expect(map.has(s)).toBe(false);
    }
  });

  it("does NOT rename preserved names", () => {
    const tokens = tokenize("myFunc otherFunc");
    const map = buildRenameMap(tokens, new Set(["myFunc"]));
    expect(map.has("myFunc")).toBe(false);
    expect(map.has("otherFunc")).toBe(true);
  });

  it("DOES rename user-defined identifiers", () => {
    const tokens = tokenize("fn myFunction(myParam: f32) -> f32 { return myParam; }");
    const map = buildRenameMap(tokens, new Set());
    expect(map.has("myFunction")).toBe(true);
    expect(map.has("myParam")).toBe(true);
  });

  it("renames consistently: same input name maps to same output name", () => {
    const tokens = tokenize("myVar myVar myVar otherVar");
    const map = buildRenameMap(tokens, new Set());
    const renamed = map.get("myVar");
    expect(renamed).toBeDefined();
    // Applying the map to all occurrences gives the same output
    const results = tokens
      .filter((t) => t.type === "ident" && t.value === "myVar")
      .map(() => map.get("myVar"));
    expect(new Set(results).size).toBe(1);
  });

  it("assigns shorter names to more frequently used identifiers", () => {
    // freqIdent appears 5 times, rareIdent appears 1 time
    const src = "freqIdent freqIdent freqIdent freqIdent freqIdent rareIdent";
    const tokens = tokenize(src);
    const map = buildRenameMap(tokens, new Set());
    const freqName = map.get("freqIdent")!;
    const rareName = map.get("rareIdent")!;
    expect(freqName.length).toBeLessThanOrEqual(rareName.length);
  });

  it("generates names starting with underscore", () => {
    const tokens = tokenize("alpha beta gamma");
    const map = buildRenameMap(tokens, new Set());
    for (const [, renamed] of map) {
      expect(renamed).toMatch(/^_[a-z]+$/);
    }
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. Const inlining
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("const inlining", () => {
  /** Inline consts and reconstruct the source (no rename, no split). */
  function inlineSrc(src: string): string {
    const tokens = inlineConsts(tokenize(src));
    return tokens.map((t) => t.value).join("");
  }

  it("replaces simple const with its value", () => {
    const out = inlineSrc("const X: f32 = 1.0; fn main() { let a = X; }");
    expect(out).not.toMatch(/const\s+X/);
    expect(out).toContain("1.0");
  });

  it("resolves chained consts", () => {
    const out = inlineSrc("const A: f32 = 1.0; const B: f32 = A + 2.0; fn main() { let v = B; }");
    expect(out).not.toContain("const");
    // B should expand to "1.0 + 2.0" (or parenthesized form)
    expect(out).toContain("1.0");
    expect(out).toContain("2.0");
  });

  it("parenthesizes multi-token const values at usage sites", () => {
    const out = inlineSrc("const K: f32 = 1.0 + 2.0; fn main() { let v = K * 3.0; }");
    // K expands to a multi-token expression, so it should be wrapped in parens
    expect(out).toContain("(");
    expect(out).toContain(")");
    // Specifically: (1.0 + 2.0) * 3.0
    expect(out).toMatch(/\(.*1\.0.*\+.*2\.0.*\).*\*.*3\.0/);
  });

  it("does NOT add parens for single-token const values", () => {
    const out = inlineSrc("const X: f32 = 1.0; fn main() { let v = X * 3.0; }");
    // X is a single token (1.0), no parens needed
    // Count the parens - should not have extra wrapping parens
    const beforeMul = out.indexOf("*");
    const segment = out.slice(0, beforeMul);
    // 1.0 should appear directly without wrapping parens
    expect(segment).not.toMatch(/\(\s*1\.0\s*\)/);
  });

  it("inlines const used in array size position", () => {
    const out = inlineSrc("const SIZE: u32 = 64u; fn main() { var arr: array<f32, SIZE>; }");
    expect(out).not.toContain("SIZE");
    expect(out).toContain("64u");
  });

  it("handles const with type constructor expression", () => {
    const out = inlineSrc("const GRID: u32 = 16u; const SCALE: f32 = f32(GRID) / 4.0; fn main() { let s = SCALE; }");
    expect(out).not.toContain("GRID");
    expect(out).not.toContain("SCALE");
    // GRID should be inlined into the f32() constructor
    expect(out).toContain("16u");
  });

  it("removes the const declaration including the semicolon", () => {
    const out = inlineSrc("const PI: f32 = 3.14; fn main() { let x = PI; }");
    // No leftover "const" keyword from the declaration
    expect(out).not.toMatch(/const\s/);
  });
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 5. Full pipeline
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("full pipeline (obfuscate)", () => {
  const MINIMAL_COMPUTE = `
    // Compute shader for particle simulation
    const PARTICLE_COUNT: u32 = 1024u;

    struct Particle {
      position: vec3f,
      velocity: vec3f,
    };

    @group(0) @binding(0) var<storage, read_write> particles: array<Particle>;

    @compute @workgroup_size(64)
    fn main(@builtin(global_invocation_id) gid: vec3u) {
      let idx = gid.x;
      if (idx >= PARTICLE_COUNT) { return; }
      particles[idx].position += particles[idx].velocity * 0.016;
    }
  `;

  it("produces valid output from a full compute shader", () => {
    const out = pipeline(MINIMAL_COMPUTE);
    expect(out.length).toBeGreaterThan(0);
  });

  it("preserves the entry point name", () => {
    const out = pipeline(MINIMAL_COMPUTE);
    expect(out).toContain("main");
  });

  it("strips comments", () => {
    const out = pipeline(MINIMAL_COMPUTE);
    expect(out).not.toContain("Compute shader");
    expect(out).not.toContain("//");
    expect(out).not.toContain("particle simulation");
  });

  it("collapses whitespace (no consecutive spaces or blank lines)", () => {
    const out = pipeline(MINIMAL_COMPUTE);
    expect(out).not.toMatch(/  +/);
    expect(out).not.toMatch(/\n/);
  });

  it("renames user identifiers (Particle, idx, particles gone)", () => {
    const out = pipeline(MINIMAL_COMPUTE);
    expect(out).not.toContain("Particle");
    expect(out).not.toContain("particles");
    expect(out).not.toContain("velocity");
    expect(out).not.toContain("PARTICLE_COUNT");
  });

  it("preserves WGSL keywords in output", () => {
    const out = pipeline(MINIMAL_COMPUTE);
    expect(out).toContain("fn");
    expect(out).toContain("struct");
    expect(out).toContain("var");
    expect(out).toContain("if");
    expect(out).toContain("return");
  });

  it("preserves builtin names", () => {
    const out = pipeline(MINIMAL_COMPUTE);
    expect(out).toContain("global_invocation_id");
  });

  it("preserves attributes", () => {
    const out = pipeline(MINIMAL_COMPUTE);
    expect(out).toContain("@compute");
    expect(out).toContain("@workgroup_size");
    expect(out).toContain("@group");
    expect(out).toContain("@binding");
    expect(out).toContain("@builtin");
  });

  it("does not produce any WGSL keywords as rename targets", () => {
    const out = pipeline(MINIMAL_COMPUTE);
    // Extract all _[a-z]+ identifiers (the obfuscated names)
    const renamedIdents = out.match(/_[a-z]+/g) ?? [];
    for (const ident of renamedIdents) {
      expect(RESERVED.has(ident)).toBe(false);
      expect(BUILTINS.has(ident)).toBe(false);
    }
  });

  it("inlines const and removes the declaration", () => {
    const out = pipeline(MINIMAL_COMPUTE, { renameIdents: false });
    expect(out).not.toMatch(/const\s/);
    expect(out).not.toContain("PARTICLE_COUNT");
  });

  it("end-to-end with vertex + fragment shader", () => {
    const src = `
      struct VertexOutput {
        @builtin(position) pos: vec4f,
        @location(0) color: vec4f,
      };

      @vertex fn vs_main(@builtin(vertex_index) vertIdx: u32) -> VertexOutput {
        var out: VertexOutput;
        out.pos = vec4f(0.0, 0.0, 0.0, 1.0);
        out.color = vec4f(1.0, 0.0, 0.0, 1.0);
        return out;
      }

      @fragment fn fs_main(input: VertexOutput) -> @location(0) vec4f {
        return input.color;
      }
    `;
    const out = pipeline(src);
    // Entry points preserved
    expect(out).toContain("vs_main");
    expect(out).toContain("fs_main");
    // User idents renamed
    expect(out).not.toContain("VertexOutput");
    expect(out).not.toContain("vertIdx");
    // Keywords preserved
    expect(out).toContain("struct");
    expect(out).toContain("fn");
    expect(out).toContain("return");
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 6. Regression tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("regressions", () => {
  it("chained const with compound expression: const VOXEL_SCALE = f32(GRID_SIZE) / BOX_SIZE", () => {
    const src = `
      const GRID_SIZE: u32 = 128u;
      const BOX_SIZE: f32 = 10.0;
      const VOXEL_SCALE: f32 = f32(GRID_SIZE) / BOX_SIZE;

      @compute @workgroup_size(8)
      fn main() {
        let s = VOXEL_SCALE;
      }
    `;
    const out = pipeline(src, { renameIdents: false });
    // All consts should be inlined
    expect(out).not.toContain("GRID_SIZE");
    expect(out).not.toContain("BOX_SIZE");
    expect(out).not.toContain("VOXEL_SCALE");
    // The expanded value should reference the original literal values
    expect(out).toContain("128u");
    expect(out).toContain("10.0");
  });

  it("const in array size: var<workgroup> arr: array<u32, WG_SIZE>", () => {
    const src = `
      const WG_SIZE: u32 = 256u;

      @compute @workgroup_size(WG_SIZE)
      fn main() {
        var<workgroup> shared: array<u32, WG_SIZE>;
        shared[0] = 1u;
      }
    `;
    const out = pipeline(src, { renameIdents: false });
    expect(out).not.toContain("WG_SIZE");
    // 256u should appear in both the workgroup_size argument and array size positions
    const matches = out.match(/256u/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("attribute with arguments: @workgroup_size(4, 4, 4)", () => {
    const src = `
      @compute @workgroup_size(4, 4, 4)
      fn main(@builtin(global_invocation_id) gid: vec3u) {
        let total = gid.x + gid.y + gid.z;
      }
    `;
    const out = pipeline(src);
    // Attribute preserved
    expect(out).toContain("@workgroup_size");
    // Arguments preserved (4 is a small integer, should not be split)
    expect(out).toContain("4");
    // Entry point preserved
    expect(out).toContain("main");
    // User ident renamed
    expect(out).not.toContain("total");
  });

  it("struct member access is not broken by renaming", () => {
    const src = `
      struct Data {
        value: f32,
        count: u32,
      };

      @group(0) @binding(0) var<storage> data: Data;

      @compute @workgroup_size(1)
      fn main() {
        let v = data.value;
        let c = data.count;
      }
    `;
    const out = pipeline(src);
    // The dot operator must still be present for member access
    expect(out).toContain(".");
    // Entry point preserved
    expect(out).toContain("main");
    // struct keyword preserved
    expect(out).toContain("struct");
  });

  it("multiple attributes on same function are preserved", () => {
    const src = `@compute @workgroup_size(64) fn kernel() {}`;
    const out = pipeline(src);
    expect(out).toContain("@compute");
    expect(out).toContain("@workgroup_size");
    expect(out).toContain("kernel");
  });

  it("preserves @group and @binding attributes with arguments", () => {
    const src = `
      @group(0) @binding(0) var<storage, read> buf: array<f32>;
      @compute @workgroup_size(1)
      fn main() { let x = buf[0]; }
    `;
    const out = pipeline(src);
    expect(out).toContain("@group");
    expect(out).toContain("@binding");
    expect(out).toContain("0");
  });

  it("handles empty shader gracefully", () => {
    const out = pipeline("");
    expect(out).toBe("");
  });

  it("handles shader with only comments", () => {
    const out = pipeline("// nothing here\n/* also nothing */");
    expect(out.trim()).toBe("");
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 7. Swizzle-pattern identifiers (never renamed)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("swizzle-pattern idents are never renamed", () => {
  it("does NOT rename single-char swizzle names used as variables", () => {
    const tokens = tokenize("let x = 1.0; let y = 2.0; let z = 3.0; let w = 4.0;");
    const map = buildRenameMap(tokens, new Set());
    for (const s of ["x", "y", "z", "w", "r", "g", "b", "a"]) {
      expect(map.has(s)).toBe(false);
    }
  });

  it("does NOT rename 2-char swizzle-pattern names (xy, rg, etc.)", () => {
    const tokens = tokenize("let xy = 1.0; let rg = 2.0; let yz = 3.0;");
    const map = buildRenameMap(tokens, new Set());
    expect(map.has("xy")).toBe(false);
    expect(map.has("rg")).toBe(false);
    expect(map.has("yz")).toBe(false);
  });

  it("does NOT rename 3-4 char swizzle-pattern names (xyz, rgba, xyzw)", () => {
    const tokens = tokenize("let xyz = 1.0; let rgba = 2.0; let xyzw = 3.0;");
    const map = buildRenameMap(tokens, new Set());
    expect(map.has("xyz")).toBe(false);
    expect(map.has("rgba")).toBe(false);
    expect(map.has("xyzw")).toBe(false);
  });

  it("DOES rename names that don't match a swizzle pattern", () => {
    const tokens = tokenize("let foo = 1.0; let xyzt = 2.0; let rgbax = 3.0;");
    const map = buildRenameMap(tokens, new Set());
    // `xyzt` mixes the xyzw and rgba alphabets (not a valid swizzle); same for `rgbax`.
    expect(map.has("foo")).toBe(true);
    expect(map.has("xyzt")).toBe(true);
    expect(map.has("rgbax")).toBe(true);
  });

  it("keeps struct field named with swizzle pattern intact in output", () => {
    // Struct fields named after swizzle components stay unrenamed (safe default).
    // The shader still compiles correctly — it just leaks the field name.
    const src = `
      struct Color { rgba: vec4f };
      @group(0) @binding(0) var<storage, read> c: Color;
      @compute @workgroup_size(1) fn main() { let v = c.rgba; }
    `;
    const out = pipeline(src);
    expect(out).toContain("rgba");
    expect(out).toContain("main");
  });

  it("preserves vec swizzle access in output", () => {
    const src = `
      @compute @workgroup_size(1) fn main() {
        var v: vec4f = vec4f(1.0, 2.0, 3.0, 4.0);
        let a = v.xy;
        let b = v.rgba;
      }
    `;
    const out = pipeline(src);
    expect(out).toContain(".xy");
    expect(out).toContain(".rgba");
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 8. Cyclic const handling (bail out of inlining entirely)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("cyclic const references", () => {
  function inlineSrc(src: string): string {
    return inlineConsts(tokenize(src)).map((t) => t.value).join("");
  }

  // Source containing a const cycle wouldn't compile anyway. We still need to
  // detect it so our inliner doesn't spin or allocate exponentially. On
  // detection we bail out of inlining entirely and emit the original tokens
  // unchanged — the WGSL compiler then reports the cycle naturally.

  it("does not spin on a direct self-cycle (const A = A)", () => {
    const start = Date.now();
    const out = inlineSrc(`const A: f32 = A; fn main() { let x = A; }`);
    expect(Date.now() - start).toBeLessThan(100);
    expect(out).toMatch(/const\s+A/);
  });

  it("does not spin on a two-node cycle (A=B, B=A)", () => {
    const start = Date.now();
    const out = inlineSrc(`
      const A: f32 = B;
      const B: f32 = A;
      fn main() { let x = A; }
    `);
    expect(Date.now() - start).toBeLessThan(100);
    expect(out).toMatch(/const\s+A/);
    expect(out).toMatch(/const\s+B/);
  });

  it("does not spin on a three-node cycle (A→B→C→A)", () => {
    const start = Date.now();
    const out = inlineSrc(`
      const A: f32 = B;
      const B: f32 = C;
      const C: f32 = A;
      fn main() { let x = A; }
    `);
    expect(Date.now() - start).toBeLessThan(100);
    expect(out).toMatch(/const\s+A/);
    expect(out).toMatch(/const\s+B/);
    expect(out).toMatch(/const\s+C/);
  });

  it("bails out of inlining entirely when any cycle exists", () => {
    // Source is already broken (cycle = won't compile). We make no attempt
    // to partial-inline the acyclic consts: simpler, correct, and the user's
    // shader is going to fail regardless.
    const out = inlineSrc(`
      const A: f32 = B;
      const B: f32 = A;
      const C: f32 = 3.14;
      fn main() { let x = C; let y = A; }
    `);
    expect(out).toMatch(/const\s+A/);
    expect(out).toMatch(/const\s+B/);
    expect(out).toMatch(/const\s+C/);
  });

  it("inlines long acyclic chains in linear time", () => {
    const chain = Array.from({ length: 20 }, (_, i) =>
      i === 0
        ? `const K0: f32 = 1.0;`
        : `const K${i}: f32 = K${i - 1};`
    ).join("\n");
    const src = `${chain}\nfn main() { let x = K19; }`;
    const start = Date.now();
    const out = inlineSrc(src);
    expect(Date.now() - start).toBeLessThan(100);
    expect(out).not.toMatch(/const\s+K/);
    expect(out).toContain("1.0");
  });
});
