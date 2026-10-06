import { describe, it, expect, vi } from "vitest";
import { VITE_LINES, buildError } from "@tests/helpers/plugin/build";

// Valid input cannot fail a self-check, so a check that always fails stands in, to read
// the message the build stops with.

vi.mock("@/engine/verify", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/engine/verify")>();
  return {
    ...original,
    verifyBuild: (build: { files: { id: string }[] }) => {
      // The plugin checks its options on an empty project when it is created
      if (build.files.length === 0) return;
      throw new original.VerifyError(build.files[0].id, "token 3 (input 1:7, output 1:7)", "the identifier binds to another declaration");
    },
  };
});

describe.each(VITE_LINES)("%s", (line) => {
  it("a failed self-check stops the build, says it is a bug, and says how to build meanwhile", async () => {
    const error = await buildError(line, "linked");
    expect(error.message).toContain("WGSL obfuscation self-check failed in shaders/");
    expect(error.message).toContain("This is a bug in vite-plugin-wgsl-obfuscate");
    expect(error.message).toContain("leave the file out of the plugin's `include` option");
  });
});
