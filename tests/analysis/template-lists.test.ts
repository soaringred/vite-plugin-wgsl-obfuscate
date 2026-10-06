import { describe, it, expect } from "vitest";
import { tokenize, isGap } from "@/wgsl/tokenizer";
import { discoverTemplateLists } from "@/analysis/template-lists";

// Template list discovery (WGSL spec, "Template Lists"). Each case gives the
// lists found as source text from the name before `<` to the `>` that closes it.

function lists(src: string): string[] {
  const toks = tokenize(src).filter((t) => !isGap(t));
  const { closeOf, closes } = discoverTemplateLists(toks);
  return [...closeOf].map(([open, close]) => {
    // The closing `>` is the n-th character of its token for the n-th list it closes
    const index = closes.get(close)!.indexOf(open);
    return src.slice(toks[open - 1].start, toks[close].start + index + 1);
  });
}

describe("template list discovery", () => {
  it.each([
    ["a type", "var v: vec3<f32>;", ["vec3<f32>"]],
    ["nested lists closed by one `>>`", "var v: array<vec4<f32>>;", ["vec4<f32>", "array<vec4<f32>>"]],
    ["`var` with an address space", "var<storage, read_write> v: f32;", ["var<storage, read_write>"]],
    ["a templated call", "let v = array<f32, 2>(1.0, 2.0);", ["array<f32, 2>"]],
    ["`>=` right after a list", "let v: array<f32, 2>= x;", ["array<f32, 2>"]],
    ["`>>=` closing two lists", "let q: ptr<function, array<f32, 2>>= &a;", ["array<f32, 2>", "ptr<function, array<f32, 2>>"]],
    ["a list across a comma in call arguments", "let v = select(a<b, c>d, e, f);", ["a<b, c>"]],
    ["`a < b > c` is a list, as WGSL reads it", "let v = a < b > c;", ["a < b >"]],
    ["a list with a comment before `<`", "var v: vec2/* c */<f32>;", ["vec2/* c */<f32>"]],
    // Only an assignment `=` ends pending lists, not `!=` or a `!` before `=`
    ["a list across `!=` and `!`", "let v = a<b != !c>d;", ["a<b != !c>"]],
  ])("%s", (_, src, expected) => {
    expect(lists(src).sort()).toEqual([...expected].sort());
  });

  it.each([
    ["`||` between comparisons", "let v = a<b || c>d;"],
    ["`&&` between comparisons", "let v = a<b && c>d;"],
    ["`<=`", "let v = a<=b && c>d;"],
    ["`<<`", "let v = a<<b > c;"],
    ["a comparison in parentheses", "let v = (a<b) > c;"],
    ["a comparison in an index", "let v = a[b<c] > d;"],
    ["a literal before `<`", "let v = 1 < 2 > (3);"],
    ["`true` before `<`", "let v = true < x > (y);"],
    ["an assignment between", "x = a < b; y = c > d;"],
    ["a `;` between", "let x = a < b; let y = c > d;"],
    ["`x > (s).m`", "let v = x > (s).m;"],
    ["`x >> (s).m`", "let v = x >> (s).m;"],
  ])("none for %s", (_, src) => {
    expect(lists(src)).toEqual([]);
  });

  it("a `>>` that closes one list and compares", () => {
    const src = "let v = a<b>>c;";
    expect(lists(src)).toEqual(["a<b>"]);
    const toks = tokenize(src).filter((t) => !isGap(t));
    const { closes } = discoverTemplateLists(toks);
    const shift = toks.findIndex((t) => t.value === ">>");
    expect(closes.get(shift)).toHaveLength(1);
  });
});
