import { assert, TestRunner } from "vitest";
import type { TestContext } from "vitest";
import { parseWgsl, validate, writeSpirv, NagaError } from "naga-wasm";
import type { Module, ModuleInfo } from "naga-wasm";

// naga (WASM, always there) and Tint (Dawn, needs a GPU adapter). Without an adapter the
// Tint half is skipped and the test reported as skipped; WGSL_TEST_NO_TINT=1 forces that.

/** Source with line numbers, for failure messages. */
function numbered(source: string): string {
  return source
    .split("\n")
    .map((line, i) => `${String(i + 1).padStart(4)} | ${line}`)
    .join("\n");
}

// ── naga ────────────────────────────────────────────────────────────

/** Run `fn` on the parsed and validated module, then free both handles. */
function withNaga<T>(source: string, fn: (module: Module, info: ModuleInfo) => T): T {
  let module: Module | undefined;
  let info: ModuleInfo | undefined;
  try {
    module = parseWgsl(source);
    info = validate(module);
    return fn(module, info);
  } finally {
    info?.free();
    module?.free();
  }
}

/** naga's report for `source`, or null when it parses and validates. */
export function nagaErrors(source: string): string | null {
  try {
    withNaga(source, () => undefined);
    return null;
  } catch (error) {
    if (error instanceof NagaError) return error.formatted;
    throw error;
  }
}

/** Parse and validate with naga. Throws an Error carrying naga's report. */
export function nagaValidate(source: string): void {
  const report = nagaErrors(source);
  if (report !== null) throw new Error(`naga rejected the shader:\n${report}`);
}

/**
 * Every `override` as a `const` of the same type and value, without `@id`: naga's SPIR-V
 * writer rejects overrides. Both sides of a comparison get the same rewrite.
 */
export function lowerOverrides(source: string): string {
  const word = String.raw`(?<!\p{XID_Continue})override(?!\p{XID_Continue})`;
  const ident = String.raw`[\p{XID_Start}_]\p{XID_Continue}*`;
  if (!new RegExp(word, "u").test(source)) return source;
  return source
    .replace(/@\s*id\s*\([^()]*\)/g, "")
    .replace(new RegExp(`${word}(\\s+${ident}\\s*:\\s*)(${ident})\\s*;`, "gu"), "const$1$2 = $2();")
    .replace(new RegExp(word, "gu"), "const");
}

/**
 * SPIR-V from naga without debug names, so a rename gives identical bytes. Throws
 * with naga's report when the source is invalid.
 */
export function nagaSpirv(source: string): Uint8Array {
  try {
    return withNaga(lowerOverrides(source), (module, info) => {
      const words = writeSpirv(module, info, { flags: { debug: false } });
      return new Uint8Array(words.buffer.slice(words.byteOffset, words.byteOffset + words.byteLength));
    });
  } catch (error) {
    if (error instanceof NagaError) throw new Error(`naga (${error.kind}):\n${error.formatted}`);
    throw error;
  }
}

// ── Tint ────────────────────────────────────────────────────────────

interface Tint {
  gpu: GPU;
  device: GPUDevice;
}

/** Features that unlock `enable` extensions. Requested when the adapter has them. */
const SHADER_FEATURES: GPUFeatureName[] = [
  "shader-f16", "subgroups", "dual-source-blending", "clip-distances", "primitive-index",
];

let tint: Promise<Tint | null> | null = null;

async function openTint(): Promise<Tint | null> {
  const unavailable = (reason: string) => {
    console.warn(`Tint unavailable (${reason}); Tint assertions are skipped.`);
    return null;
  };
  if (process.env.WGSL_TEST_NO_TINT) return unavailable("WGSL_TEST_NO_TINT is set");

  let create: typeof import("webgpu").create;
  try {
    ({ create } = await import("webgpu"));
  } catch (error) {
    return unavailable(`webgpu failed to load: ${(error as Error).message}`);
  }

  // Keep `gpu` referenced as long as the device lives. Without that, runs
  // that awaited several Dawn callbacks exited early during setup.
  const gpu = create([]);
  const adapter = await gpu.requestAdapter();
  if (!adapter) return unavailable("requestAdapter() returned null");
  const requiredFeatures = SHADER_FEATURES.filter((f) => adapter.features.has(f));
  const device = await adapter.requestDevice({ requiredFeatures });
  return { gpu, device };
}

/**
 * The shared Tint device, created on first use, or null when there is no
 * adapter. The test setup destroys it after each test file.
 */
export async function getTintDevice(): Promise<GPUDevice | null> {
  tint ??= openTint();
  return (await tint)?.device ?? null;
}

/** Destroy the shared device. Dawn keeps the process alive until this runs. */
export async function destroyTintDevice(): Promise<void> {
  const current = tint;
  tint = null;
  (await current?.catch(() => null))?.device.destroy();
}

/** Tint's errors for `source` as "line:column message": empty when valid, null without Tint. */
export async function tintErrors(source: string): Promise<string[] | null> {
  const device = await getTintDevice();
  if (!device) return null;

  // The error scope keeps Dawn from printing the error as uncaptured. Pop it
  // before awaiting, so concurrent calls cannot interleave their scopes.
  device.pushErrorScope("validation");
  const module = device.createShaderModule({ code: source });
  const scope = device.popErrorScope();
  const { messages } = await module.getCompilationInfo();
  await scope;
  return messages
    .filter((m) => m.type === "error")
    .map((m) => `${m.lineNum}:${m.linePos} ${m.message}`);
}

/**
 * Tint's errors for a compute pipeline with this entry point and these constants, as JS
 * names them: empty when valid, null without Tint.
 */
export async function tintComputePipelineErrors(
  source: string,
  entryPoint: string,
  constants: Record<string, number> = {},
): Promise<string[] | null> {
  const device = await getTintDevice();
  if (!device) return null;

  device.pushErrorScope("validation");
  const module = device.createShaderModule({ code: source });
  device.createComputePipeline({ layout: "auto", compute: { module, entryPoint, constants } });
  const error = await device.popErrorScope();
  return error ? [error.message] : [];
}

// ── Skipped Tint assertions ─────────────────────────────────────────

const testsWithSkippedTint = new WeakMap<object, string>();

/** Record that the running test could not check its Tint assertion. */
export function skipTintAssertion(reason = "Tint unavailable: naga assertions passed, Tint assertions skipped"): void {
  const test = TestRunner.getCurrentTest();
  if (test && !testsWithSkippedTint.has(test)) testsWithSkippedTint.set(test, reason);
}

/**
 * Report a test as skipped when it passed without its Tint assertions. A
 * failure stays a failure. Called by the test setup after each test.
 */
export function reportSkippedTint(context: TestContext): void {
  const reason = testsWithSkippedTint.get(context.task);
  if (reason === undefined) return;
  if (context.task.result?.state === "fail") return;
  context.skip(reason);
}

// ── Assertions ──────────────────────────────────────────────────────

/** Assert that `source` is valid on naga and on Tint. */
export async function expectValid(source: string, label = "shader"): Promise<void> {
  const naga = nagaErrors(source);
  if (naga !== null) assert.fail(`naga rejected the ${label}:\n${naga}`);

  const errors = await tintErrors(source);
  if (errors === null) return skipTintAssertion();
  if (errors.length > 0) {
    assert.fail(`Tint rejected the ${label}:\n${errors.join("\n")}\n\n${numbered(source)}`);
  }
}

/** Assert that Tint creates a compute pipeline from `source` with these names. */
export async function expectComputePipeline(
  source: string,
  entryPoint: string,
  constants: Record<string, number> = {},
): Promise<void> {
  const errors = await tintComputePipelineErrors(source, entryPoint, constants);
  if (errors === null) return skipTintAssertion();
  if (errors.length > 0) {
    assert.fail(`Tint failed to create the pipeline:\n${errors.join("\n")}\n\n${numbered(source)}`);
  }
}

/**
 * Assert that `a` and `b` compile on naga to byte-identical SPIR-V. With the
 * debug flag off that holds exactly when they differ only in names.
 */
export function expectSameSpirv(a: string, b: string): void {
  const spirv = (source: string, side: string) => {
    try {
      return nagaSpirv(source);
    } catch (error) {
      assert.fail(`${side} source does not compile on naga:\n${(error as Error).message}`);
    }
  };
  const bytesA = spirv(a, "first");
  const bytesB = spirv(b, "second");

  let firstDiff = 0;
  while (firstDiff < bytesA.length && bytesA[firstDiff] === bytesB[firstDiff]) firstDiff++;
  if (firstDiff < bytesA.length || bytesA.length !== bytesB.length) {
    assert.fail(
      `SPIR-V differs: ${bytesA.length} vs ${bytesB.length} bytes, ` +
        `first difference at word ${Math.floor(firstDiff / 4)}`,
    );
  }
}
