import { describe, it } from "vitest";
import type { ObfuscateOptions } from "@/index";
import { expectSafe } from "@tests/helpers/differential";

// Projects built to confuse linking: one name declared as two kinds in two files, and
// names shared by files never linked together. Each link set is judged on its own.

const OUT = `@group(0) @binding(0) var<storage, read_write> out: array<f32>;`;
const entry = (body: string) => `${OUT}\n${body}\n@compute @workgroup_size(1) fn main() { out[0] = use_it(); }`;

/** `X` declared as each kind, and a use of it that is valid with that declaration. */
const KINDS: Record<string, [declaration: string, use: string]> = {
  const: [`const X: f32 = 2.0;`, `fn use_it() -> f32 { return X; }`],
  var: [`var<private> X: f32 = 2.0;`, `fn use_it() -> f32 { return X; }`],
  override: [`@id(1) override X: f32 = 2.0;`, `fn use_it() -> f32 { return X; }`],
  fn: [`fn X() -> f32 { return 2.0; }`, `fn use_it() -> f32 { return X(); }`],
  struct: [`struct X { m: f32 }`, `fn use_it() -> f32 { return X(2.0).m; }`],
  alias: [`alias X = f32;`, `fn use_it() -> f32 { return X(2.0); }`],
};

const OPTIONS: ObfuscateOptions[] = [
  {},
  { topLevel: "keep" },
  { preserve: ["X", "m"] },
  { wgslFnParams: "rename", prefix: "X" },
  { renameIdents: false },
  { collapseWhitespace: false },
];

describe("one name declared in two files as two kinds", () => {
  // Each pair once: which file comes first does not matter to any rule
  const kinds = Object.keys(KINDS);
  const pairs = kinds.flatMap((a, i) => kinds.slice(i + 1).map((b) => [a, b]));

  it.each(pairs)("%s and %s, under every option set", async (a, b) => {
    const files = {
      "decl-a.wgsl": KINDS[a][0],
      "decl-b.wgsl": KINDS[b][0],
      "use-a.wgsl": entry(KINDS[a][1]),
      "use-b.wgsl": entry(KINDS[b][1]),
    };
    const linkSets = [
      ["decl-a.wgsl", "use-a.wgsl"],
      ["decl-b.wgsl", "use-b.wgsl"],
    ];
    for (const options of OPTIONS) await expectSafe(files, options, linkSets);
  });
});

describe("names shared by files that are never linked", () => {
  it("an entry point in one file, a helper of the same name in another", async () => {
    const files = {
      "a.wgsl": `${OUT}\n@compute @workgroup_size(1) fn run() { out[0] = 1.0; }`,
      "b.wgsl": `fn run() -> f32 { return 2.0; }\nfn caller() -> f32 { return run(); }`,
    };
    for (const options of OPTIONS) await expectSafe(files, options, [["a.wgsl"], ["b.wgsl"]]);
  });

  it("a field of two structs in different link sets", async () => {
    const files = {
      "types.wgsl": `struct Beam { width: f32, glow: f32 }`,
      "use.wgsl": `${OUT}\nfn w(b: Beam) -> f32 { return b.width + b.glow; }\n@compute @workgroup_size(1) fn main() { out[0] = w(Beam(1.0, 2.0)); }`,
      "other.wgsl": `${OUT}\nstruct Ray { width: f32 }\nfn r() -> f32 { let q = Ray(3.0); return q.width; }\n@compute @workgroup_size(1) fn main() { out[0] = r(); }`,
    };
    for (const options of OPTIONS) await expectSafe(files, options, [["types.wgsl", "use.wgsl"], ["other.wgsl"]]);
  });
});
