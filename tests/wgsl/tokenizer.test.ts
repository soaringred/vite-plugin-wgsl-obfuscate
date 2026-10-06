import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { tokenize, extractEntryPoints, attributeName, isGap } from "@/wgsl/tokenizer";

// Tokens of WGSL source, by type and text.

/** `type:value` for every token, for compact expectations. */
function shape(src: string): string[] {
  return tokenize(src).map((t) => `${t.type}:${t.value}`);
}

/** Values of the non-gap tokens. */
function values(src: string): string[] {
  return tokenize(src).filter((t) => !isGap(t)).map((t) => t.value);
}

/** Characters by code point, so invisible ones stay readable here. */
const chr = (...codePoints: number[]) => String.fromCodePoint(...codePoints);

describe("operators", () => {
  const MULTI_CHAR_OPS = [
    ">>=", "<<=", "->", "==", "!=", "<=", ">=", "&&", "||", "++", "--",
    "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<", ">>",
  ];

  it.each(MULTI_CHAR_OPS)("tokenizes %s as one op", (op) => {
    expect(shape(`a${op}b`)).toEqual(["ident:a", `op:${op}`, "ident:b"]);
  });

  it("takes the longest match", () => {
    expect(values("a>>=b<<=c")).toEqual(["a", ">>=", "b", "<<=", "c"]);
    expect(values("a--b")).toEqual(["a", "--", "b"]);
    expect(values("a&&&b")).toEqual(["a", "&&", "&", "b"]);
  });

  it("keeps separated operators apart", () => {
    expect(values("a - -b")).toEqual(["a", "-", "-", "b"]);
    expect(values("a / *p")).toEqual(["a", "/", "*", "p"]);
    expect(values("array<vec4<f32> >")).toEqual(["array", "<", "vec4", "<", "f32", ">", ">"]);
    // A minus sign is an operator, not part of the number
    expect(shape("-42")).toEqual(["op:-", "number:42"]);
  });

  it("tokenizes `>>` that closes two template lists as one op", () => {
    expect(values("array<vec4<f32>>")).toEqual(["array", "<", "vec4", "<", "f32", ">>"]);
  });

  it("tokenizes other punctuation one character at a time", () => {
    expect(values("(){}[];:,.!~?")).toEqual(
      ["(", ")", "{", "}", "[", "]", ";", ":", ",", ".", "!", "~", "?"],
    );
  });
});

describe("numbers", () => {
  it.each([
    // Hex floats
    "0x1.8p1", "0x.8p1", "0x1.p0", "0x1.8", "0x.8", "0x1.", "0x1p-2", "0x1p-2f",
    "0XA.Bp+1", "0x1P4h", "0x1.8p1f",
    // Hex integers
    "0xFF", "0X1a", "0xFFu", "0x1Fi", "0x1f",
    // Decimal floats
    "1.", ".5", "1.5", "1e5", "1E-5", "1.5e+3f", "2f", "1.0f", "0h", "0.0h",
    // Decimal integers
    "0", "42", "42u", "7i", "0u",
  ])("tokenizes %s as one number", (literal) => {
    expect(shape(literal)).toEqual([`number:${literal}`]);
  });

  it("reads hex float literals inside expressions", () => {
    expect(values("x*0x1.8p1+y")).toEqual(["x", "*", "0x1.8p1", "+", "y"]);
  });

  it("only takes an exponent that has digits", () => {
    expect(values("1ex")).toEqual(["1", "ex"]);
    expect(values("0x1py")).toEqual(["0x1", "py"]);
  });

  it("takes an f/h suffix on a hex float only after the exponent", () => {
    // Without an exponent `f` is a hex digit, so the literal is still hex
    expect(values("0x1.8f")).toEqual(["0x1.8f"]);
    expect(values("0x1p1f")).toEqual(["0x1p1f"]);
  });

  it("does not read `0x` without digits as hex", () => {
    expect(values("0x")).toEqual(["0", "x"]);
  });

  it("takes the longest literal, then the rest", () => {
    expect(values("1ux")).toEqual(["1u", "x"]);
    expect(values("1.5.x")).toEqual(["1.5", ".", "x"]);
  });
});

describe("identifiers", () => {
  it("accepts Unicode identifiers", () => {
    const delta = chr(0x3b4);
    const pi2 = chr(0x3c0) + "2";
    const cyrillic = chr(0x43f, 0x435, 0x440, 0x435, 0x43c);
    expect(values(`${delta} ${pi2} ${cyrillic}`)).toEqual([delta, pi2, cyrillic]);
    expect(tokenize(delta)[0].type).toBe("ident");
  });

  it("continues an identifier with combining marks", () => {
    // e + COMBINING ACUTE ACCENT
    const name = `e${chr(0x301)}t`;
    expect(shape(name)).toEqual([`ident:${name}`]);
  });

  it("handles identifiers outside the Basic Multilingual Plane", () => {
    // MATHEMATICAL BOLD SMALL X, a surrogate pair in UTF-16
    const x = chr(0x1d431);
    expect(shape(`${x}1+y`)).toEqual([`ident:${x}1`, "op:+", "ident:y"]);
  });

  it("tokenizes `_` and names with leading underscores as identifiers", () => {
    expect(shape("_ = _a + __b")).toEqual([
      "ident:_", "whitespace: ", "op:=", "whitespace: ", "ident:_a",
      "whitespace: ", "op:+", "whitespace: ", "ident:__b",
    ]);
  });

  it("does not start an identifier with a digit", () => {
    expect(values("9lives")).toEqual(["9", "lives"]);
  });
});

describe("blankspace and comments", () => {
  it("treats every WGSL blankspace character as whitespace", () => {
    const blank = " \t\n\v\f\r" + chr(0x85, 0x200e, 0x200f, 0x2028, 0x2029);
    expect(shape(`a${blank}b`)).toEqual(["ident:a", `whitespace:${blank}`, "ident:b"]);
  });

  it("does not treat other Unicode spaces as whitespace", () => {
    // NO-BREAK SPACE is not WGSL blankspace
    expect(tokenize(`a${chr(0xa0)}b`).map((t) => t.type)).toEqual(["ident", "op", "ident"]);
  });

  it("ends a line comment at any line break", () => {
    const lineBreaks = ["\n", "\r\n", "\r", "\v", "\f", chr(0x85), chr(0x2028), chr(0x2029)];
    for (const lineBreak of lineBreaks) {
      const toks = tokenize(`// note${lineBreak}x`);
      expect(toks[0]).toMatchObject({ type: "comment", value: "// note" });
      expect(toks[toks.length - 1]).toMatchObject({ type: "ident", value: "x" });
    }
  });

  it("nests block comments", () => {
    expect(shape("/* a /* b */ c */x")).toEqual(["comment:/* a /* b */ c */", "ident:x"]);
  });

  it("runs an unterminated block comment to the end", () => {
    expect(shape("x /* open")).toEqual(["ident:x", "whitespace: ", "comment:/* open"]);
    expect(shape("/* a /* b */")).toEqual(["comment:/* a /* b */"]);
  });
});

describe("attributes", () => {
  it("reads `@name` as one attribute", () => {
    expect(shape("@vertex fn")).toEqual(["attribute:@vertex", "whitespace: ", "ident:fn"]);
  });

  it("reads `@` followed by blankspace and a name as one attribute", () => {
    expect(shape("@ fragment fn")).toEqual(["attribute:@ fragment", "whitespace: ", "ident:fn"]);
    expect(shape("@\n  compute")).toEqual(["attribute:@\n  compute"]);
  });

  it("reads comments between `@` and the name as part of the attribute", () => {
    expect(shape("@/* stage */vertex")).toEqual(["attribute:@/* stage */vertex"]);
    expect(shape("@ // stage\n fragment")).toEqual(["attribute:@ // stage\n fragment"]);
  });

  it("reads an attribute's arguments as ordinary tokens", () => {
    expect(values("@workgroup_size(8, 8)")).toEqual(["@workgroup_size", "(", "8", ",", "8", ")"]);
    expect(values("@ builtin (position)")).toEqual(["@ builtin", "(", "position", ")"]);
  });

  it("reads a lone `@` as an attribute without a name", () => {
    expect(shape("@ (")).toEqual(["attribute:@", "whitespace: ", "op:("]);
  });

  it("attributeName strips `@`, blankspace and comments", () => {
    const names = tokenize("@vertex @ fragment @/* c */compute @ // c\n must_use @")
      .filter((t) => t.type === "attribute")
      .map(attributeName);
    expect(names).toEqual(["vertex", "fragment", "compute", "must_use", ""]);
  });
});

describe("entry point detection", () => {
  it("detects `@ fragment` with whitespace after `@`", () => {
    const ep = extractEntryPoints(tokenize("@ fragment fn fs() -> @location(0) vec4f {}"));
    expect([...ep]).toEqual(["fs"]);
  });

  it("detects stage attributes written with comments, and only those", () => {
    const src = `
      @/* stage */compute @workgroup_size(1) /* kernel */ fn kernel() {}
      @vertex // entry
      fn /* name */ vs() -> @builtin(position) vec4f { return vec4f(); }
      fn helper() {}
    `;
    expect([...extractEntryPoints(tokenize(src))].sort()).toEqual(["kernel", "vs"]);
  });

  it("does not treat attributes that merely start with a stage name as stages", () => {
    const ep = extractEntryPoints(tokenize("@computeish fn helper() {}"));
    expect(ep.size).toBe(0);
  });
});

describe("round trip", () => {
  const fixturesDir = join(__dirname, "..", "fixtures");
  const fixtures = readdirSync(fixturesDir).filter((f) => f.endsWith(".wgsl"));

  it.each(fixtures)("tokens of %s reproduce the source exactly", (name) => {
    const src = readFileSync(join(fixturesDir, name), "utf-8");
    const toks = tokenize(src);
    expect(toks.map((t) => t.value).join("")).toBe(src);
    for (const t of toks) expect(src.slice(t.start, t.end)).toBe(t.value);
  });

  it("keeps positions in UTF-16 code units", () => {
    const src = `let ${chr(0x1d431)} = ${chr(0x3c0)};`;
    for (const t of tokenize(src)) expect(src.slice(t.start, t.end)).toBe(t.value);
  });
});
