import { describe, it, expect } from "vitest";
import { makePlugin, runTransform } from "./helpers";

describe("basic obfuscation", () => {
  it("strips line comments", () => {
    const out = runTransform(`// this is a comment\nfn main() {}`);
    expect(out).not.toContain("this is a comment");
    expect(out).not.toContain("//");
  });

  it("strips block comments", () => {
    const out = runTransform(`/* secret */ fn main() {}`);
    expect(out).not.toContain("secret");
    expect(out).not.toContain("/*");
  });

  it("preserves WGSL keywords", () => {
    const out = runTransform(`fn add(a: i32, b: i32) -> i32 { return a + b; }`);
    expect(out).toContain("fn");
    expect(out).toContain("i32");
    expect(out).toContain("return");
  });

  it("preserves WGSL builtin functions", () => {
    const out = runTransform(`fn main() { let x = sqrt(2.0); let y = mix(0.0, 1.0, 0.5); }`, {
      inlineConsts: false,
    });
    expect(out).toContain("sqrt");
    expect(out).toContain("mix");
  });

  it("preserves swizzle components", () => {
    const out = runTransform(`fn main(v: vec4<f32>) -> f32 { return v.x + v.y + v.z + v.w; }`);
    expect(out).toContain(".x");
    expect(out).toContain(".y");
    expect(out).toContain(".z");
    expect(out).toContain(".w");
  });

  it("renames user-defined identifiers", () => {
    const out = runTransform(`fn secretFunction(myVariable: f32) -> f32 { return myVariable * 2.0; }`);
    expect(out).not.toContain("secretFunction");
    expect(out).not.toContain("myVariable");
  });

  it("auto-preserves @compute entry points", () => {
    const out = runTransform(`@compute @workgroup_size(1) fn myComputeMain() { }`);
    expect(out).toContain("myComputeMain");
  });

  it("auto-preserves @vertex entry points", () => {
    const out = runTransform(`@vertex fn vs_main() -> @builtin(position) vec4<f32> { return vec4<f32>(0.0); }`);
    expect(out).toContain("vs_main");
  });

  it("auto-preserves @fragment entry points", () => {
    const out = runTransform(`@fragment fn fs_main() -> @location(0) vec4<f32> { return vec4<f32>(1.0); }`);
    expect(out).toContain("fs_main");
  });

  it("honours explicit preserve option", () => {
    const out = runTransform(`fn helperFunction() -> f32 { return 1.0; }`, {
      preserve: ["helperFunction"],
    });
    expect(out).toContain("helperFunction");
  });

  it("collapses whitespace", () => {
    const out = runTransform(`fn    main(  )   {\n\n\n  return;\n}`);
    expect(out).not.toMatch(/  +/);
    expect(out).not.toMatch(/\n\n/);
  });

  it("returns null for non-matching file extensions", () => {
    const result = makePlugin().transform("fn main() {}", "/fake/path/shader.glsl");
    expect(result).toBeNull();
  });
});
