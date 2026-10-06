import { expect } from "vitest";
import WGSLNodeFunction from "three/src/renderers/webgpu/nodes/WGSLNodeFunction.js";
import { obfuscateProject, ObfuscateError } from "@/index";
import { expectValid, expectSameSpirv } from "@tests/helpers/compilers";

// Helpers shared by the regression tests. Every shader in them is made up.

/** Concatenate sources into one link set, in the given order. */
export function link(...sources: string[]): string {
  return sources.join("\n");
}

/** `before` and `after` are valid on both compilers and compile to the same SPIR-V. */
export async function expectSameOnBoth(before: string, after: string): Promise<void> {
  await expectValid(before, "input");
  await expectValid(after, "output");
  expectSameSpirv(before, after);
}

/** Obfuscate `files` as one project and check its link set, all files in order. */
export async function expectProjectLinks(files: Record<string, string>): Promise<Record<string, string>> {
  const ids = Object.keys(files);
  const { files: out } = obfuscateProject(files);
  await expectSameOnBoth(link(...ids.map((id) => files[id])), link(...ids.map((id) => out[id])));
  return out;
}

/** Parameter names and three.js types as `WGSLNodeFunction` reads them. */
export function wgslFnInputs(src: string): [string, string | undefined][] {
  return new WGSLNodeFunction(src).inputs.map((input) => [input.name, input.type]);
}

/** The ObfuscateError that `fn` throws. */
export function obfuscateErrorOf(fn: () => unknown): ObfuscateError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ObfuscateError);
    return error as ObfuscateError;
  }
  return expect.fail("expected an ObfuscateError");
}
