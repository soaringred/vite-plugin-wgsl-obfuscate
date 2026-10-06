import { describe, it, expect } from "vitest";
import { obfuscate, validate, ObfuscateError } from "@/index";
import { expectValid, nagaErrors, tintErrors } from "@tests/helpers/compilers";

// Every rejection, with the position it reports; regression problem 25 has more.
// Valid WGSL must pass too: validate-valid.test.ts.

/** The ObfuscateError that `validate` throws for `source`. */
function rejection(source: string, file?: string): ObfuscateError {
  try {
    validate(source, file);
  } catch (error) {
    expect(error).toBeInstanceOf(ObfuscateError);
    return error as ObfuscateError;
  }
  return expect.fail(`expected validate() to reject:\n${source}`);
}

// ── API ─────────────────────────────────────────────────────────────

describe("ObfuscateError", () => {
  it("carries the file, line, column and reason", () => {
    const error = rejection(`fn f() {\n  let a = 1 # 2;\n}`, "shaders/a.wgsl");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ObfuscateError");
    expect(error.file).toBe("shaders/a.wgsl");
    expect(error.line).toBe(2);
    expect(error.column).toBe(13);
    expect(error.reason).toMatch(/^`#` is not WGSL/);
    expect(error.message).toBe(`Cannot obfuscate shaders/a.wgsl:2:13: ${error.reason}`);
  });

  it('names the file "source" by default', () => {
    expect(rejection(`#`).file).toBe("source");
  });

  it("returns nothing for valid input", () => {
    expect(validate(`fn f() -> f32 { return 1.0; }`)).toBeUndefined();
  });
});

// ── Rejections ──────────────────────────────────────────────────────

interface Rejection {
  source: string;
  line: number;
  column: number;
  reason: RegExp;
}

/** Rejections by what the input gets wrong. */
const REJECTIONS: Record<string, Record<string, Rejection>> = {
  "a character WGSL never uses": {
    '`"`': { source: `fn f() {\n  let s = "text";\n}`, line: 2, column: 11, reason: /^`"` is not WGSL: WGSL has no string literals/ },
    "`'`": { source: `fn f() {\n  let c = 'a';\n}`, line: 2, column: 11, reason: /^`'` is not WGSL: WGSL has no string literals/ },
    "a backtick": { source: "fn f() {\n  let t = `x`;\n}", line: 2, column: 11, reason: /^a backtick is not WGSL/ },
    "`$`": { source: `const $scale = 1.0;`, line: 1, column: 7, reason: /^`\$` is not WGSL\.$/ },
    "`\\`": { source: `fn f() {\n  let a = 1.0; \\\n}`, line: 2, column: 16, reason: /^`\\` is not WGSL\.$/ },
    "`?`": { source: `fn f(b: bool) -> f32 {\n  return b ? 1.0 : 0.0;\n}`, line: 2, column: 12, reason: /^`\?` is not WGSL: .*select/ },
    "another symbol": { source: `const a = 2 × 3;`, line: 1, column: 13, reason: /^the character U\+00D7 is not WGSL\.$/ },
    "a byte order mark": { source: `\uFEFFfn f() {}`, line: 1, column: 1, reason: /^the byte order mark U\+FEFF is not WGSL: save the file without one\.$/ },
    "a character outside the BMP": { source: `// 😀\nconst a = 😀;`, line: 2, column: 11, reason: /^the character U\+1F600 is not WGSL\.$/ },
    "a lone `@`": { source: `@ ;`, line: 1, column: 1, reason: /^`@` is not followed by an attribute name\.$/ },
  },
  "an unterminated block comment": {
    "at the end": { source: `fn f() {}\n/* open`, line: 2, column: 1, reason: /^unterminated block comment/ },
    "with a nested comment closed": { source: `/* a /* b */\nfn f() {}`, line: 1, column: 1, reason: /^unterminated block comment/ },
  },
  "unbalanced or mismatched brackets": {
    "an extra `}`": { source: `fn f() {\n}\n}`, line: 3, column: 1, reason: /^`\}` has no matching `\{`\.$/ },
    "a mismatched `]`": { source: `fn f() -> f32 {\n  return (1.0];\n}`, line: 2, column: 14, reason: /^`\]` does not match the `\(` at 2:10\.$/ },
    "an unclosed `(`": { source: `const a = (1.0;`, line: 1, column: 11, reason: /^this `\(` is never closed\.$/ },
    "an extra `]`": { source: `const a = 1.0];`, line: 1, column: 14, reason: /^`\]` has no matching `\[`\.$/ },
  },
  "a module-scope item that does not start like one": {
    "`let`": { source: `let x = 1.0;`, line: 1, column: 1, reason: /^expected a module-scope declaration .* found `let`\.$/ },
    "a statement": { source: `fn f() {}\nreturn;`, line: 2, column: 1, reason: /found `return`\.$/ },
    "a call": { source: `fn f() {}\nf();`, line: 2, column: 1, reason: /found `f`\.$/ },
    "a number": { source: `42;`, line: 1, column: 1, reason: /found `42`\.$/ },
  },
  "a missing `;`": {
    "`const` before `fn`": { source: `const A = 1.0\nfn f() {}`, line: 2, column: 1, reason: /before `fn`\.$/ },
    "`const` before `struct`": { source: `const A = 1.0\nstruct S { a: f32 }`, line: 2, column: 1, reason: /before `struct`\.$/ },
    "`var` before an attribute": {
      source: `var<private> a: f32 = 1.0\n@group(0) @binding(0) var<uniform> b: f32;`,
      line: 2,
      column: 1,
      reason: /^expected `;` to end the `var` declaration before `@group`\.$/,
    },
    "`alias` before `{`": { source: `alias V = vec3f { }`, line: 1, column: 17, reason: /^expected `;` to end the `alias` declaration before `\{`\.$/ },
    "`override` at the end of the file": { source: `override A: f32 = 1.0`, line: 1, column: 22, reason: /^expected `;` to end the `override` declaration at the end of the file\.$/ },
    "`const_assert`": { source: `const_assert 1 < 2\nfn f() {}`, line: 2, column: 1, reason: /^expected `;` to end the `const_assert` before `fn`\.$/ },
    "`enable`": { source: `enable f16\nfn f() {}`, line: 2, column: 1, reason: /^expected `;` to end the `enable` directive before `fn`\.$/ },
    "`diagnostic`": { source: `diagnostic(off, derivative_uniformity)\nfn f() {}`, line: 2, column: 1, reason: /the `diagnostic` directive before `fn`\.$/ },
    "a local `let` before `let`": { source: `fn f() {\n  let a = 1.0\n  let b = 2.0;\n}`, line: 3, column: 3, reason: /^expected `;` to end the `let` declaration before `let`\.$/ },
    "a local `var` before `}`": { source: `fn f() {\n  var a = 1.0\n}`, line: 3, column: 1, reason: /^expected `;` to end the `var` declaration before `\}`\.$/ },
    "a local `const` before `if`": { source: `fn f() {\n  const a = 1.0\n  if (a > 0.0) {}\n}`, line: 3, column: 3, reason: /the `const` declaration before `if`\.$/ },
    "a local `const_assert` before `return`": { source: `fn f() {\n  const_assert 1 < 2\n  return;\n}`, line: 3, column: 3, reason: /the `const_assert` before `return`\.$/ },
    "a local in a nested block": { source: `fn f() {\n  loop {\n    let a = 1\n    break;\n  }\n}`, line: 4, column: 5, reason: /before `break`\.$/ },
  },
  "a malformed `fn`": {
    "no name": { source: `fn (a: f32) {}`, line: 1, column: 4, reason: /^expected a function name after `fn`, found `\(`\.$/ },
    "a keyword as the name": { source: `fn loop() {}`, line: 1, column: 4, reason: /found `loop`\.$/ },
    "no parameter list": { source: `fn f {}`, line: 1, column: 6, reason: /^expected `\(` after `fn f`, found `\{`\.$/ },
    "no body": { source: `fn f() -> f32;`, line: 1, column: 14, reason: /^expected the body `\{` of `fn f`, found `;`\.$/ },
    "no return type": { source: `fn f() -> { }`, line: 1, column: 11, reason: /^expected the return type of `fn f` after `->`, found `\{`\.$/ },
    "a statement instead of the body": { source: `fn f() -> f32 return;`, line: 1, column: 15, reason: /found `return`\.$/ },
    "the end of the file": { source: `fn f()`, line: 1, column: 7, reason: /^expected `->` or the body `\{` of `fn f`, found the end of the file\.$/ },
    "body attributes without a body": {
      source: `fn f() @diagnostic(off, derivative_uniformity) ;`,
      line: 1,
      column: 48,
      reason: /^expected `->` or the body `\{` of `fn f`, found `;`\.$/,
    },
    "a struct without a name": { source: `struct { a: f32 }`, line: 1, column: 8, reason: /^expected a struct name after `struct`, found `\{`\.$/ },
    "a struct without a body": { source: `struct S;`, line: 1, column: 9, reason: /^expected `\{` after `struct S`, found `;`\.$/ },
  },
  "a reserved word WGSL does not use yet": {
    "as a local": { source: `fn f() {\n  let filter = 1.0;\n}`, line: 2, column: 7, reason: /^`filter` is a reserved word/ },
    "as a function name": { source: `fn typeof() {}`, line: 1, column: 4, reason: /^`typeof` is a reserved word/ },
    "as a type": { source: `fn f(a: typename) {}`, line: 1, column: 9, reason: /^`typename` is a reserved word/ },
    "as a struct field": { source: `struct S { self: f32 }`, line: 1, column: 12, reason: /^`self` is a reserved word/ },
    "as a module-scope name": { source: `const static = 1;`, line: 1, column: 7, reason: /^`static` is a reserved word/ },
    "in an expression attribute argument": { source: `@compute @workgroup_size(target) fn f() {}`, line: 1, column: 26, reason: /^`target` is a reserved word/ },
    "in an expression": { source: `fn f() -> f32 { return precise; }`, line: 1, column: 24, reason: /^`precise` is a reserved word/ },
  },
};

describe("rejections", () => {
  for (const [rule, cases] of Object.entries(REJECTIONS)) {
    describe(rule, () => {
      it.each(Object.entries(cases))("%s", async (_, { source, line, column, reason }) => {
        // Not WGSL for either compiler...
        expect(nagaErrors(source)).not.toBeNull();
        const tint = await tintErrors(source);
        if (tint !== null) expect(tint).not.toEqual([]);
        // ...and rejected with the position of the offending text
        const error = rejection(source, "x.wgsl");
        expect({ line: error.line, column: error.column }).toEqual({ line, column });
        expect(error.reason).toMatch(reason);
        // A full sentence, as the message shows it
        expect(error.reason).toMatch(/\.$/);
        expect(() => obfuscate(source)).toThrow(ObfuscateError);
      });
    });
  }
});

describe("positions", () => {
  it("counts columns in UTF-16 code units, as a JS string does", () => {
    const error = rejection("/* 😀 */ #");
    expect({ line: error.line, column: error.column }).toEqual({ line: 1, column: 10 });
  });

  it("reports the first problem in the source", () => {
    const error = rejection(`const a = 1.0\nconst b = "x";`);
    // Characters are checked before structure
    expect({ line: error.line, column: error.column }).toEqual({ line: 2, column: 11 });
  });
});

describe("what comments may contain", () => {
  it("accepts any character inside comments", async () => {
    const source = `// # $ \" ' \` \\ ? × 😀 \${x} #include "a"\n/* # $ " ' \` \\ ? × /* nested ? */ */\nfn f() {}`;
    await expectValid(source);
    expect(() => validate(source)).not.toThrow();
  });

  it("accepts reserved words inside comments", () => {
    expect(() => validate(`// let filter = typeof self;\nfn f() {} /* static */`)).not.toThrow();
  });
});
