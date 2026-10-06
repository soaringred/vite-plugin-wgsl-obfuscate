import { StrictError } from "@/engine/obfuscate";
import { ObfuscateError } from "@/wgsl/validate";
import { VerifyError } from "@/engine/verify";
import type { BuildContext } from "@/vite/plugin/context";

// How the plugin fails a build: engine errors reach the bundler with their message intact and a hint added.

export const PLUGIN_NAME = "vite-plugin-wgsl-obfuscate";

/** How to build despite a failed self-check. The error itself says it is a bug. */
const VERIFY_HINT = "To build in the meantime, leave the file out of the plugin's `include` option, so that it ships as written.";

/** Fail the build with an engine error, message intact. Anything else is a bug and is rethrown. */
export function fail(ctx: BuildContext, error: unknown, hint?: string): never {
  if (error instanceof ObfuscateError || error instanceof StrictError || error instanceof VerifyError) {
    // The same error may pass through here twice; add each hint once
    const hints = [hint, error instanceof VerifyError ? VERIFY_HINT : undefined].filter(
      (h): h is string => !!h && !error.message.includes(h),
    );
    if (hints.length > 0) error.message = `${error.message}\n${hints.join("\n")}`;
    return ctx.error(error);
  }
  throw error;
}
