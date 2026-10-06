import { describe, it, expect } from "vitest";
import { tokenize } from "@/wgsl/tokenizer";
import type { Token } from "@/wgsl/tokenizer";
import { emit, canJoin } from "@/wgsl/emit";

// Tokens plus rename decisions back to text. Whether an output still compiles is
// judged in the engine suites.

/** Emit `src` without renaming. */
function reemit(src: string, collapseWhitespace = true): string {
  return emit(tokenize(src), { collapseWhitespace });
}

describe("canJoin", () => {
  it.each([
    ["let", "x"], // one identifier
    ["-", "-"], // `--`
    ["/", "*"], // block comment
    ["/", "/"], // line comment
    [">", ">"], // `>>`
    [">", "="], // `>=`
    ["&", "&&"], // `&&` then `&`
    ["0", "x1"], // hex literal
    ["1", "e5"], // exponent
    ["1", "u"], // suffix
    [".", "5"], // float
    ["@vertex", "fn"], // attribute name
    ["return", "1"], // identifier `return1`
  ])("keeps %s and %s apart", (a, b) => {
    expect(canJoin(a, b)).toBe(false);
  });
});

describe("emit with collapseWhitespace", () => {
  it("drops whitespace the tokens do not need", () => {
    expect(reemit("let x = 1.0 ;\n\n  return x ;")).toBe("let x=1.0;return x;");
  });

  it("keeps one space where tokens would merge", () => {
    expect(reemit("a - -b")).toBe("a- -b");
    expect(reemit("a / *p")).toBe("a/ *p");
    expect(reemit("array<vec4<f32> >")).toBe("array<vec4<f32> >");
    expect(reemit("var<private> v: vec4<f32> = x;")).toBe("var<private>v:vec4<f32> =x;");
    expect(reemit("return 1u;")).toBe("return 1u;");
  });

  it("treats a comment as whitespace", () => {
    expect(reemit("let/* c */x = 1.0;")).toBe("let x=1.0;");
    expect(reemit("a -/**/-b")).toBe("a- -b");
    expect(reemit("x = 1; // trailing\ny = 2;")).toBe("x=1;y=2;");
  });

  it("keeps tokens that touch in the source touching", () => {
    expect(reemit("a+b")).toBe("a+b");
    expect(reemit("f(x)")).toBe("f(x)");
  });

  it("drops leading and trailing whitespace and comments", () => {
    expect(reemit("  // header\n  fn main() {}  /* end */\n")).toBe("fn main(){}");
    expect(reemit("// only a comment")).toBe("");
    expect(reemit("")).toBe("");
  });

  it("normalizes attributes written with a gap after `@`", () => {
    expect(reemit("@ fragment fn fs()")).toBe("@fragment fn fs()");
    expect(reemit("@/* stage */vertex\nfn vs()")).toBe("@vertex fn vs()");
    expect(reemit("@ builtin (position) p: vec4f")).toBe("@builtin(position)p:vec4f");
  });
});

describe("emit without collapseWhitespace", () => {
  it("keeps whitespace as written", () => {
    const src = "fn    main(  )   {\n\treturn;\n}\n";
    expect(reemit(src, false)).toBe(src);
  });

  it("turns each comment into one space", () => {
    expect(reemit("let/* c */x = 1.0; // note\n", false)).toBe("let x = 1.0;  \n");
    expect(reemit("a /* one */ /* two */ b", false)).toBe("a     b");
  });

  it("keeps the gap inside an attribute, with comments as spaces", () => {
    expect(reemit("@ fragment", false)).toBe("@ fragment");
    expect(reemit("@ /* c */ vertex", false)).toBe("@   vertex");
  });
});

describe("rename callback", () => {
  it("is called for identifier tokens only, with their index", () => {
    const toks = tokenize("@vertex fn main() -> vec4f { return vec4f(1.0); }");
    const seen: [string, number][] = [];
    emit(toks, {
      rename: (tok, index) => {
        seen.push([tok.value, index]);
        return undefined;
      },
    });
    const expected = toks
      .map((t, i): [Token, number] => [t, i])
      .filter(([t]) => t.type === "ident")
      .map(([t, i]): [string, number] => [t.value, i]);
    expect(seen).toEqual(expected);
  });

  it("decides per token, not per name", () => {
    const toks = tokenize("let x = 1.0; { let x = 2.0; y = x; }");
    const xs = toks.map((t, i) => (t.value === "x" ? i : -1)).filter((i) => i >= 0);
    // First `x` is one declaration, the other two another
    const out = emit(toks, {
      rename: (tok, index) => (tok.value !== "x" ? undefined : index === xs[0] ? "_a" : "_b"),
    });
    expect(out).toBe("let _a=1.0;{let _b=2.0;y=_b;}");
  });

  it("applies the join rule to the renamed text", () => {
    // `-` then `x` may join, but `-` then a renamed `-y` may not
    const toks = tokenize("a - x");
    expect(emit(toks, { rename: (tok) => (tok.value === "x" ? "-y" : undefined) })).toBe("a- -y");
  });

  it("keeps a token as written when the callback returns undefined", () => {
    expect(emit(tokenize("let keep = 1;"), { rename: () => undefined })).toBe("let keep=1;");
  });
});
