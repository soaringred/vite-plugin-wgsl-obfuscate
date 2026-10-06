import { readDefinition } from "./files";

// The words each compiler predeclares, read from its own source files (`yarn corpus:fetch`).
// Each list must hold a few known entries, so a change of format fails instead of reading nothing.

export interface CompilerWords {
  /** Builtin functions. */
  functions: Set<string>;
  /** Predeclared types and type generators. */
  types: Set<string>;
  /** Address spaces, access modes, texel formats and other template enumerants. */
  enumerants: Set<string>;
  /** Arguments of `@builtin`. */
  builtinValues: Set<string>;
  /** Arguments of `@interpolate`. */
  interpolation: Set<string>;
  /** Attribute names. */
  attributes: Set<string>;
  /** Names the parser reads as values before any scope lookup (naga's ray constants). */
  constants: Set<string>;
  /** Members of the structs the compiler predeclares or returns from builtins. */
  members: Set<string>;
}

/** Drop `//` comments. */
function code(text: string): string {
  return text.replace(/\/\/.*$/gm, "");
}

/** The entries of `enum name { ... }` in a Tint .def file, without `@internal` ones. */
function tintEnum(text: string, name: string): Set<string> {
  const body = code(text).match(new RegExp(`\\benum\\s+${name}\\s*\\{([^}]*)\\}`))?.[1];
  if (body === undefined) throw new Error(`Tint: no enum ${name}`);
  return new Set(
    body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("@internal") && !line.startsWith("__")),
  );
}

/** String literals used as match patterns: `"word" =>`, `"word" |` and `("word", span) =>`. */
function matchedWords(text: string): Set<string> {
  const words = new Set<string>();
  for (const m of code(text).matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"\s*(?:=>|\|)|\("([A-Za-z_][A-Za-z0-9_]*)",\s*\w+\)\s*=>/g)) {
    words.add(m[1] ?? m[2]);
  }
  return words;
}

/** The source of `pub fn name` up to the next top-level `pub fn`. */
function rustFunction(text: string, name: string): string {
  const start = text.indexOf(`pub fn ${name}`);
  if (start < 0) throw new Error(`naga: no function ${name}`);
  const next = text.indexOf("\npub fn ", start + 1);
  return text.slice(start, next < 0 ? undefined : next);
}

function union(...sets: Set<string>[]): Set<string> {
  return new Set(sets.flatMap((set) => [...set]));
}

function expectEntries(label: string, set: Set<string>, known: string[]): Set<string> {
  const missing = known.filter((word) => !set.has(word));
  if (missing.length > 0) throw new Error(`${label}: could not read ${missing.join(", ")}; has the file format changed?`);
  return set;
}

export function tintWords(): CompilerWords {
  const wgsl = readDefinition("tint", "src/tint/lang/wgsl/wgsl.def");
  const core = readDefinition("tint", "src/tint/lang/core/core.def");
  const functions = new Set([...code(wgsl).matchAll(/\bfn\s+([A-Za-z_]\w*)\s*[<(]/g)].map((m) => m[1]));
  return {
    functions: expectEntries("Tint functions", new Set([...functions].filter((f) => !f.startsWith("__"))), [
      "textureSample",
      "atomicAdd",
      "workgroupUniformLoad",
    ]),
    types: expectEntries("Tint types", tintEnum(core, "builtin_type"), ["f32", "array", "texture_external"]),
    enumerants: expectEntries(
      "Tint enumerants",
      union(
        tintEnum(readDefinition("tint", "src/tint/lang/core/access.def"), "access"),
        tintEnum(readDefinition("tint", "src/tint/lang/core/address_space.def"), "address_space"),
        tintEnum(readDefinition("tint", "src/tint/lang/core/texel_format.def"), "texel_format"),
      ),
      ["read_write", "workgroup", "rgba8unorm"],
    ),
    builtinValues: expectEntries("Tint builtin values", tintEnum(core, "builtin_value"), ["position", "vertex_index"]),
    interpolation: expectEntries(
      "Tint interpolation",
      union(tintEnum(core, "interpolation_type"), tintEnum(core, "interpolation_sampling")),
      ["flat", "centroid"],
    ),
    attributes: expectEntries("Tint attributes", tintEnum(core, "attribute"), ["workgroup_size", "location"]),
    constants: new Set(),
    members: new Set(),
  };
}

export function nagaWords(): CompilerWords {
  const conv = readDefinition("naga", "naga/src/front/wgsl/parse/conv.rs");
  const parse = readDefinition("naga", "naga/src/front/wgsl/parse/mod.rs");
  const lower = readDefinition("naga", "naga/src/front/wgsl/lower/mod.rs");
  const typeGen = readDefinition("naga", "naga/src/front/type_gen.rs");
  const inConv = (name: string) => matchedWords(rustFunction(conv, name));

  // Members of every struct type_gen.rs builds, except the external texture
  // parameters, which exist only in naga's output for other languages
  const userTypes = typeGen
    .split(/\n\s*pub fn /)
    .filter((part) => !part.startsWith("generate_external_texture_types"))
    .join("\n");
  const members = new Set(
    [...userTypes.matchAll(/name:\s*Some\("([a-z_][A-Za-z0-9_]*)"/g)].map((m) => m[1]),
  );

  return {
    functions: expectEntries(
      "naga functions",
      union(
        inConv("map_derivative"),
        inConv("map_relational_fun"),
        inConv("map_standard_fun"),
        inConv("map_subgroup_operation"),
        matchedWords(lower),
      ),
      ["dpdx", "any", "normalize", "subgroupAdd", "textureSample", "atomicLoad"],
    ),
    types: expectEntries("naga types", inConv("map_predeclared_type"), ["f32", "vec3f", "texture_2d", "binding_array"]),
    enumerants: expectEntries(
      "naga enumerants",
      union(
        inConv("map_address_space"),
        inConv("map_access_mode"),
        inConv("map_ray_flag"),
        inConv("map_cooperative_role"),
        inConv("map_storage_format"),
      ),
      ["private", "read_write", "rgba8unorm"],
    ),
    builtinValues: expectEntries("naga builtin values", inConv("map_built_in"), ["position", "global_invocation_id"]),
    interpolation: expectEntries(
      "naga interpolation",
      union(inConv("map_interpolation"), inConv("map_sampling")),
      ["flat", "centroid"],
    ),
    attributes: expectEntries("naga attributes", matchedWords(parse), ["location", "workgroup_size", "size", "align"]),
    constants: expectEntries(
      "naga constants",
      new Set([...code(parse).matchAll(/Token::Word\("([A-Z][A-Z0-9_]*)"\)/g)].map((m) => m[1])),
      ["RAY_FLAG_NONE"],
    ),
    members: expectEntries("naga members", members, ["tmin", "old_value", "fract"]),
  };
}

/** naga's reserved words (keywords/wgsl.rs `RESERVED`). */
export function nagaReserved(): Set<string> {
  const text = readDefinition("naga", "naga/src/keywords/wgsl.rs");
  const list = text.match(/pub const RESERVED: &\[&str\] = &\[([\s\S]*?)\];/)?.[1];
  if (list === undefined) throw new Error("naga: no RESERVED list");
  return expectEntries("naga reserved", new Set([...list.matchAll(/"([^"]+)"/g)].map((m) => m[1])), ["fn", "NULL"]);
}
