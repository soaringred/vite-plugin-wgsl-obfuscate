import { describe, it, expect } from "vitest";
import {
  nagaErrors,
  nagaValidate,
  nagaSpirv,
  lowerOverrides,
  tintErrors,
  getTintDevice,
  expectValid,
  expectSameSpirv,
  expectComputePipeline,
} from "@tests/helpers/compilers";
import { expectSameProgram } from "@tests/helpers/differential";

// The compiler helpers every other suite relies on: a helper that passes
// everything would hide every bug.

const VALID = `
  @group(0) @binding(0) var<storage, read_write> results: array<f32>;
  fn scaled(value: f32, factor: f32) -> f32 { return value * factor; }
  @compute @workgroup_size(1) fn main() { results[0] = scaled(results[0], 2.0); }
`;

// Same shader with every user name changed
const RENAMED = `
  @group(0) @binding(0) var<storage, read_write> _a: array<f32>;
  fn _b(_c: f32, _d: f32) -> f32 { return _c * _d; }
  @compute @workgroup_size(1) fn main() { _a[0] = _b(_a[0], 2.0); }
`;

const UNRESOLVED = `fn f() -> f32 { return missingName; }`;
const TYPE_ERROR = `fn f() -> f32 { return 1u; }`;

// Tint needs a GPU adapter; its own checks skip without one
const hasTint = (await getTintDevice()) !== null;

describe("naga helpers", () => {
  it("accepts a valid shader and reports parse and validation errors", () => {
    expect(nagaErrors(VALID)).toBeNull();
    expect(() => nagaValidate(VALID)).not.toThrow();
    expect(nagaErrors(UNRESOLVED)).toContain("no definition in scope for identifier");
    expect(() => nagaValidate(UNRESOLVED)).toThrow(/missingName/);
    expect(nagaErrors(TYPE_ERROR)).not.toBeNull();
  });

  it("writes SPIR-V without names", () => {
    const bytes = nagaSpirv(VALID);
    expect(bytes.length % 4).toBe(0);
    // SPIR-V magic number, little-endian
    expect([...bytes.slice(0, 4)]).toEqual([0x03, 0x02, 0x23, 0x07]);
    expect(Buffer.from(bytes).includes("scaled")).toBe(false);
  });

  it("lowers overrides to consts so they reach the SPIR-V writer", () => {
    const src = `
      @id(3) override gain: f32;
      override bias = 0.5;
      @compute @workgroup_size(1) fn main() { let x = gain + bias; }
    `;
    const lowered = lowerOverrides(src);
    expect(lowered).not.toMatch(/override|@id/);
    expect(lowered).toContain("const gain: f32 = f32();");
    expect(() => nagaSpirv(src)).not.toThrow();
  });
});

describe.skipIf(!hasTint)("Tint helpers", () => {
  it("accepts a valid shader and reports errors with Tint's message", async () => {
    expect(await tintErrors(VALID)).toEqual([]);
    expect((await tintErrors(UNRESOLVED))?.join("\n")).toContain("unresolved value 'missingName'");
  });

  it("expectValid fails a shader only Tint rejects", async () => {
    // A derivative in non-uniform control flow: naga accepts it, Tint does not
    const src = `
      @fragment fn fs(@location(0) v: f32) -> @location(0) vec4f {
        if (v > 0.0) { return vec4f(dpdx(v)); }
        return vec4f(0.0);
      }
    `;
    expect(nagaErrors(src)).toBeNull();
    await expect(expectValid(src)).rejects.toThrow(/Tint rejected/);
  });
});

describe("assertions", () => {
  it("rejects an input accepted by neither compiler, or reports the comparison skipped without Tint", async () => {
    if (hasTint) {
      await expect(expectSameProgram(UNRESOLVED, UNRESOLVED)).rejects.toThrow(/no compiler accepts the input/);
    } else {
      await expectSameProgram(UNRESOLVED, UNRESOLVED);
    }
  });

  it("expectValid passes a valid shader", async () => {
    await expectValid(VALID);
  });

  it("expectValid fails an invalid shader", async () => {
    await expect(expectValid(UNRESOLVED)).rejects.toThrow(/naga rejected/);
  });

  it("expectSameSpirv passes a rename", () => {
    expectSameSpirv(VALID, RENAMED);
  });

  it("expectSameSpirv fails a semantic change", () => {
    expect(() => expectSameSpirv(VALID, VALID.replace("2.0", "3.0"))).toThrow(/SPIR-V differs/);
  });

  it("expectSameSpirv fails when a side does not compile", () => {
    expect(() => expectSameSpirv(VALID, UNRESOLVED)).toThrow(/second source does not compile/);
  });

  it.skipIf(!hasTint)("expectComputePipeline checks entry point and override names", async () => {
    const src = `
      override gain: f32 = 1.0;
      @group(0) @binding(0) var<storage, read_write> out: f32;
      @compute @workgroup_size(1) fn main() { out = gain; }
    `;
    await expectComputePipeline(src, "main", { gain: 2 });
    await expect(expectComputePipeline(src, "main", { other: 2 })).rejects.toThrow();
    await expect(expectComputePipeline(src, "missing")).rejects.toThrow();
  });
});
