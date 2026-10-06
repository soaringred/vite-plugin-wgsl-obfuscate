import { describe, it, expect } from "vitest";
import { expectSafeRename } from "@tests/helpers/differential";
import { identifiers } from "@tests/helpers/wgsl";

// Scope rules, judged by the compilers. Every shader stores what it computes,
// so an identifier bound to the wrong declaration changes the SPIR-V.

/** A compute kernel that stores `call` in a buffer, after `decls`. */
function kernel(decls: string, call: string): string {
  return `
    ${decls}
    @group(0) @binding(0) var<storage, read_write> results: array<f32, 4>;
    @compute @workgroup_size(1)
    fn main() { results[0] = ${call}; }
  `;
}

describe("a local comes into scope at the end of its statement", () => {
  it("`let x = x + 1.0;` reads the outer `x` on the right", async () => {
    await expectSafeRename(kernel(`
      fn grow(v: f32) -> f32 {
        let x = v;
        var total = 0.0;
        if (v > 0.0) {
          let x = x + 1.0;
          total = x * 10.0;
        }
        return total + x;
      }
    `, "grow(results[1])"));
  });

  it("`let length = length(v);` calls the builtin, which keeps its name", async () => {
    const out = await expectSafeRename(kernel(`
      fn measure(v: vec3f) -> f32 {
        let length = length(v);
        let max = max(length, 1.0);
        let normalize = normalize(v) * max;
        return normalize.x + length;
      }
    `, "measure(vec3f(results[1], 2.0, 3.0))"));
    for (const name of ["length", "max", "normalize"]) expect(identifiers(out).filter((n) => n === name)).toHaveLength(1);
  });

  it("a call before a local of the same name reads the module-scope function", async () => {
    await expectSafeRename(kernel(`
      fn bias(v: f32) -> f32 { return v + 0.5; }
      fn biased(v: f32) -> f32 {
        let first = bias(v);
        let bias = 4.0;
        return first * bias;
      }
    `, "biased(results[1]) + bias(1.0)"));
  });
});

describe("for initializers", () => {
  it("an initializer that reads an outer variable of the same name", async () => {
    await expectSafeRename(kernel(`
      fn restart(v: f32) -> f32 {
        let n = 2;
        var total = 0.0;
        for (var n = n + 1; n < 6; n++) { total += f32(n); }
        return total + f32(n) * v;
      }
    `, "restart(results[1])"));
  });

  it("nested for loops with the same variable name", async () => {
    await expectSafeRename(kernel(`
      fn grid(v: f32) -> f32 {
        var total = 0.0;
        for (var i = 0u; i < 3u; i++) {
          for (var j = i; j < 3u; j++) { total += f32(i * 10u + j); }
          for (var i = 7u; i < 9u; i++) { total -= f32(i); }
          total += f32(i) * v;
        }
        return total;
      }
    `, "grid(results[1])"));
  });
});

describe("names that are not declarations", () => {
  it("case selectors are references", async () => {
    const out = await expectSafeRename(kernel(`
      const LOW: i32 = 1;
      const HIGH: i32 = 2;
      fn pick(sel: i32) -> f32 {
        var result = 0.0;
        switch sel {
          case LOW: { let result = 5.0; return result; }
          case HIGH, 3: { result = 2.0; }
          case default: { result = -1.0; }
        }
        return result;
      }
    `, "pick(i32(results[1]))"));
    expect(identifiers(out)).not.toContain("LOW");
    expect(identifiers(out)).not.toContain("HIGH");
  });

  it("the `var` template list, enumerants in types and the phony `_` stay as written", async () => {
    const out = await expectSafeRename(`
      @group(0) @binding(0) var<storage, read_write> data: array<f32>;
      @group(0) @binding(1) var<uniform> gain: vec4f;
      var<private> seed: f32;
      var<workgroup> scratch: array<f32, 8>;
      fn load(p: ptr<function, array<f32, 4>>, i: u32) -> f32 { return (*p)[i]; }
      fn reseed(p: ptr<private, f32>) { *p += 1.0; }
      @compute @workgroup_size(1) fn main() {
        var<function> copy = array<f32, 4>(data[0], data[1], data[2], data[3]);
        var local = load(&copy, 0u) * gain.x + seed;
        reseed(&seed);
        _ = scratch[0];
        _ = local;
        data[0] = local;
      }
    `);
    for (const name of ["storage", "read_write", "uniform", "private", "workgroup", "function", "_"]) {
      expect(identifiers(out)).toContain(name);
    }
  });

  it("members after `.` use the member map, whatever their name", async () => {
    // `scale` is a const, a field and a local; `count` a field and a parameter
    const out = await expectSafeRename(kernel(`
      const scale: f32 = 3.0;
      struct Settings { scale: f32, count: u32 }
      fn scaled(s: Settings, count: u32) -> f32 {
        let scale = s.scale * f32(s.count + count);
        return scale;
      }
    `, "scaled(Settings(results[1], 2u), 1u) * scale"));
    expect(identifiers(out)).not.toContain("scale");
    expect(identifiers(out)).not.toContain("count");
  });
});
