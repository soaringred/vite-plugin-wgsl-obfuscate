import { describe, it, expect } from "vitest";
import { positionAt, positionsIn } from "@/wgsl/position";
import { tokenize } from "@/wgsl/tokenizer";
import { resolve } from "@/analysis/resolver";
import { checkTokenShape, VerifyError } from "@/engine/verify";
import { obfuscateProject, ObfuscateError } from "@/index";

// Positions in messages count lines as WGSL does: LF, VT, FF, CR, CR LF (one
// break), NEL, LS and PS each end a line.

const BREAKS: [string, string][] = [
  ["LF", "\n"],
  ["CR LF", "\r\n"],
  ["CR", "\r"],
  ["vertical tab", "\v"],
  ["form feed", "\f"],
  ["NEL (U+0085)", "\u0085"],
  ["line separator (U+2028)", " "],
  ["paragraph separator (U+2029)", " "],
];

describe("positionAt", () => {
  it.each(BREAKS)("%s ends a line", (_, br) => {
    const src = `const a = 1;${br}const b = 2;${br}${br}  x`;
    expect(positionAt(src, src.indexOf("b"))).toEqual({ line: 2, column: 7 });
    expect(positionAt(src, src.indexOf("x"))).toEqual({ line: 4, column: 3 });
  });

  it("counts CR LF once, and a lone CR or LF once each", () => {
    const src = "a\r\n\rb\n\r\nc";
    expect(positionAt(src, src.indexOf("b"))).toEqual({ line: 3, column: 1 });
    expect(positionAt(src, src.indexOf("c"))).toEqual({ line: 5, column: 1 });
  });

  it("does not count other blankspace", () => {
    const src = "a\t‎‏ b";
    expect(positionAt(src, src.indexOf("b"))).toEqual({ line: 1, column: 6 });
  });

  it("clamps offsets past either end", () => {
    expect(positionAt("ab\ncd", 99)).toEqual({ line: 2, column: 3 });
    expect(positionAt("ab", -1)).toEqual({ line: 1, column: 1 });
  });

  it("gives the same answers from a shared index", () => {
    const src = "fn f() {\r\n  let x = 1;   let y = x;\v}\n";
    const at = positionsIn(src);
    for (let offset = 0; offset <= src.length; offset++) expect(at(offset)).toEqual(positionAt(src, offset));
  });
});

describe("error positions", () => {
  it("of an ObfuscateError", () => {
    const src = `const a = 1;\r\n// note\u2028const b = 2;\r  #include "x"`;
    let error: unknown;
    try {
      obfuscateProject({ "s.wgsl": src });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ObfuscateError);
    expect(error).toMatchObject({ line: 4, column: 3 });
  });

  it("of a doubt's sites", () => {
    const src = "struct S {\r\n  v: f32\r\n} fn f(s: S) -> f32 {\u2028\u2029  return s.v + other.v;\v}";
    const { report } = obfuscateProject({ "s.wgsl": src });
    const sites = report.doubts.find((d) => d.name === "v")!.sites;
    // `s.v` is proven; `other.v` is not
    expect(sites).toEqual([{ file: "s.wgsl", line: 5, column: 22 }]);
  });

  it("of a VerifyError", () => {
    const src = `const a = 1.0;\r\n\u0085let x = a;`;
    const out = `const a = 1.0;\r\n\u0085letx = a;`;
    let error: unknown;
    try {
      checkTokenShape("s.wgsl", resolve(tokenize(src)), out);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(VerifyError);
    expect((error as VerifyError).position).toBe("token 5 (input 3:1, output 3:1)");
  });
});
