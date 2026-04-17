import { describe, it, expect } from "vitest";
import { makePlugin, runTransform } from "./helpers";

describe("option toggles", () => {
  it("renameIdents=false keeps names", () => {
    const out = runTransform(`fn myFunc(myVar: f32) -> f32 { return myVar; }`, {
      renameIdents: false,
    });
    expect(out).toContain("myFunc");
    expect(out).toContain("myVar");
  });

  it("stripComments=false keeps comments", () => {
    const out = runTransform(`// keep me\nfn main() {}`, {
      stripComments: false,
    });
    expect(out).toContain("keep me");
  });

  it("collapseWhitespace=false keeps original whitespace", () => {
    const src = `fn    main(  )   {   return;   }`;
    const out = runTransform(src, {
      collapseWhitespace: false,
      renameIdents: false,
      splitConstants: false,
      inlineConsts: false,
    });
    expect(out).toContain("    ");
  });

  it("splitConstants=false leaves numbers untouched", () => {
    const out = runTransform(`fn main() { let x = 3.14159; }`, {
      splitConstants: false,
    });
    expect(out).toContain("3.14159");
  });

  it("inlineConsts=false keeps const declarations", () => {
    const out = runTransform(`const PI: f32 = 3.14159; fn main() { let x = PI; }`, {
      inlineConsts: false,
      renameIdents: false,
      splitConstants: false,
    });
    expect(out).toContain("const");
    expect(out).toContain("PI");
  });

  it("custom include pattern", () => {
    const plugin = makePlugin({ include: /\.shader$/ });
    expect(plugin.transform("fn main() {}", "/x/foo.wgsl")).toBeNull();
    expect(plugin.transform("fn main() {}", "/x/foo.shader")).not.toBeNull();
  });
});
