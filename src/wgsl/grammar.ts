// WGSL word lists, from the spec's wgsl.reserved.plain, naga's keyword list, Tint's .def files and
// naga's WGSL front end. tests/wgsl/word-lists.test.ts checks them against pinned copies of those.

/** WGSL keywords and future-reserved words. */
export const RESERVED = new Set([
  // Active keywords
  "alias", "break", "case", "const", "const_assert", "continue", "continuing",
  "default", "diagnostic", "discard", "else", "enable", "false", "fn", "for",
  "if", "let", "loop", "override", "requires", "return", "struct", "switch",
  "true", "var", "while",
  // Future-reserved words
  "NULL", "Self", "abstract", "active", "alignas", "alignof", "as", "asm",
  "asm_fragment", "async", "attribute", "auto", "await", "become", "cast",
  "catch", "class", "co_await", "co_return", "co_yield", "coherent",
  "column_major", "common", "compile", "compile_fragment", "concept",
  "const_cast", "consteval", "constexpr", "constinit", "crate", "debugger",
  "decltype", "delete", "demote", "demote_to_helper", "do", "dynamic_cast",
  "enum", "explicit", "export", "extends", "extern", "external", "fallthrough",
  "filter", "final", "finally", "friend", "from", "fxgroup", "get", "goto",
  "groupshared", "highp", "impl", "implements", "import", "inline",
  "instanceof", "interface", "layout", "lowp", "macro", "macro_rules", "match",
  "mediump", "meta", "mod", "module", "move", "mut", "mutable", "namespace",
  "new", "nil", "noexcept", "noinline", "nointerpolation", "non_coherent",
  "noncoherent", "noperspective", "null", "nullptr", "of", "operator",
  "package", "packoffset", "partition", "pass", "patch", "pixelfragment",
  "precise", "precision", "premerge", "priv", "protected", "pub", "public",
  "readonly", "ref", "regardless", "register", "reinterpret_cast", "require",
  "resource", "restrict", "self", "set", "shared", "sizeof", "smooth", "snorm",
  "static", "static_assert", "static_cast", "std", "subroutine", "super",
  "target", "template", "this", "thread_local", "throw", "trait", "try",
  "type", "typedef", "typeid", "typename", "typeof", "union", "unless",
  "unorm", "unsafe", "unsized", "use", "using", "varying", "virtual",
  "volatile", "wgsl", "where", "with", "writeonly", "yield",
]);

/** WGSL builtin names: types, functions, enumerants, builtin values and attribute names. */
export const BUILTINS = new Set([
  // Scalar types (`i8`, `u8`, `i16`, `u16`, `i64`, `u64`, `f64` are extensions)
  "bool", "i32", "u32", "f32", "f16", "i64", "u64", "f64", "i8", "u8", "i16", "u16",
  // Composite, sampler and texture types, and type aliases
  "array", "atomic", "ptr",
  "vec2", "vec3", "vec4",
  "mat2x2", "mat2x3", "mat2x4", "mat3x2", "mat3x3", "mat3x4",
  "mat4x2", "mat4x3", "mat4x4",
  "vec2f", "vec3f", "vec4f", "vec2i", "vec3i", "vec4i",
  "vec2u", "vec3u", "vec4u", "vec2h", "vec3h", "vec4h",
  "mat2x2f", "mat2x3f", "mat2x4f", "mat3x2f", "mat3x3f", "mat3x4f",
  "mat4x2f", "mat4x3f", "mat4x4f",
  "mat2x2h", "mat2x3h", "mat2x4h", "mat3x2h", "mat3x3h", "mat3x4h",
  "mat4x2h", "mat4x3h", "mat4x4h",
  "sampler", "sampler_comparison",
  "texture_1d", "texture_2d", "texture_2d_array", "texture_3d",
  "texture_cube", "texture_cube_array", "texture_multisampled_2d",
  "texture_depth_2d", "texture_depth_2d_array", "texture_depth_cube",
  "texture_depth_cube_array", "texture_depth_multisampled_2d",
  "texture_external",
  "texture_storage_1d", "texture_storage_2d", "texture_storage_2d_array",
  "texture_storage_3d",
  // Types from extensions: Tint's, then naga's
  "input_attachment", "subgroup_matrix_left", "subgroup_matrix_right", "subgroup_matrix_result",
  "buffer", "binding_array", "texel_buffer",
  "acceleration_structure", "ray_query", "RayDesc", "RayIntersection", "coop_mat8x8", "coop_mat16x16",
  // Access modes
  "read", "write", "read_write",
  // Address spaces
  "function", "private", "workgroup", "uniform", "storage", "push_constant",
  // Texel formats
  "rgba8unorm", "rgba8snorm", "rgba8uint", "rgba8sint",
  "rgba16unorm", "rgba16snorm", "rgba16uint", "rgba16sint", "rgba16float",
  "rg8unorm", "rg8snorm", "rg8uint", "rg8sint",
  "rg16unorm", "rg16snorm", "rg16uint", "rg16sint", "rg16float",
  "r32uint", "r32sint", "r32float",
  "rg32uint", "rg32sint", "rg32float",
  "rgba32uint", "rgba32sint", "rgba32float",
  "bgra8unorm",
  "r8unorm", "r8snorm", "r8uint", "r8sint",
  "r16unorm", "r16snorm", "r16uint", "r16sint", "r16float",
  "rgb10a2unorm", "rgb10a2uint", "rg11b10ufloat", "r64uint",
  // Builtin functions
  "bitcast",
  "all", "any", "select",
  "arrayLength",
  "abs", "acos", "acosh", "asin", "asinh", "atan", "atanh", "atan2",
  "ceil", "clamp", "cos", "cosh", "cross", "degrees", "determinant",
  "distance", "dot", "exp", "exp2", "faceForward", "floor", "fma",
  "fract", "frexp", "inverseSqrt", "ldexp", "length", "log", "log2",
  "max", "min", "mix", "modf", "normalize", "pow", "quantizeToF16",
  "radians", "reflect", "refract", "round", "saturate",
  "sign", "sin", "sinh", "smoothstep", "sqrt", "step", "tan", "tanh",
  "transpose", "trunc",
  "countLeadingZeros", "countOneBits", "countTrailingZeros",
  "extractBits", "firstLeadingBit", "firstTrailingBit", "insertBits",
  "reverseBits",
  "dot4U8Packed", "dot4I8Packed",
  "dpdx", "dpdxCoarse", "dpdxFine",
  "dpdy", "dpdyCoarse", "dpdyFine",
  "fwidth", "fwidthCoarse", "fwidthFine",
  "textureDimensions", "textureGather", "textureGatherCompare",
  "textureLoad", "textureNumLayers", "textureNumLevels", "textureNumSamples",
  "textureSample", "textureSampleBias", "textureSampleCompare",
  "textureSampleCompareLevel", "textureSampleGrad", "textureSampleLevel",
  "textureSampleBaseClampToEdge", "textureStore",
  "atomicLoad", "atomicStore", "atomicAdd", "atomicSub", "atomicMax",
  "atomicMin", "atomicAnd", "atomicOr", "atomicXor", "atomicExchange",
  "atomicCompareExchangeWeak",
  "pack4x8snorm", "pack4x8unorm", "pack4xI8", "pack4xU8",
  "pack4xI8Clamp", "pack4xU8Clamp",
  "pack2x16snorm", "pack2x16unorm", "pack2x16float",
  "unpack4x8snorm", "unpack4x8unorm", "unpack4xI8", "unpack4xU8",
  "unpack2x16snorm", "unpack2x16unorm", "unpack2x16float",
  "storageBarrier", "textureBarrier", "workgroupBarrier",
  "workgroupUniformLoad",
  "subgroupAdd", "subgroupExclusiveAdd", "subgroupInclusiveAdd",
  "subgroupAll", "subgroupAnd", "subgroupAny",
  "subgroupBallot", "subgroupBroadcast", "subgroupBroadcastFirst",
  "subgroupElect", "subgroupMax", "subgroupMin",
  "subgroupMul", "subgroupExclusiveMul", "subgroupInclusiveMul",
  "subgroupOr", "subgroupShuffle", "subgroupShuffleDown",
  "subgroupShuffleUp", "subgroupShuffleXor", "subgroupXor",
  "quadBroadcast", "quadSwapDiagonal", "quadSwapX", "quadSwapY",
  // Builtin functions from extensions: Tint's, then naga's
  "atomicStoreMax", "atomicStoreMin", "inputAttachmentLoad", "print",
  "bufferView", "bufferArrayView", "bufferLength", "hasResource", "getResource",
  "subgroupMatrixLoad", "subgroupMatrixStore", "subgroupMatrixMultiply", "subgroupMatrixMultiplyAccumulate",
  "subgroupMatrixScalarAdd", "subgroupMatrixScalarSubtract", "subgroupMatrixScalarMultiply",
  "subgroupBarrier",
  "textureAtomicMin", "textureAtomicMax", "textureAtomicAdd", "textureAtomicAnd", "textureAtomicOr", "textureAtomicXor",
  "rayQueryInitialize", "rayQueryProceed", "rayQueryGenerateIntersection", "rayQueryConfirmIntersection",
  "rayQueryTerminate", "rayQueryGetCommittedIntersection", "rayQueryGetCandidateIntersection",
  "getCommittedHitVertexPositions", "getCandidateHitVertexPositions", "traceRay",
  "coopLoad", "coopLoadT", "coopStore", "coopStoreT", "coopMultiplyAdd",
  // Builtin values (@builtin)
  "position", "vertex_index", "instance_index", "front_facing",
  "frag_depth", "local_invocation_id", "local_invocation_index",
  "global_invocation_id", "workgroup_id", "num_workgroups",
  "sample_index", "sample_mask",
  "clip_distances", "primitive_index",
  "subgroup_invocation_id", "subgroup_size", "subgroup_id", "num_subgroups",
  // Builtin values from extensions: Tint's, then naga's
  "global_invocation_index", "workgroup_index", "barycentric_coord",
  "view_index", "draw_index", "barycentric", "barycentric_no_perspective",
  "cull_primitive", "point_index", "line_indices", "triangle_indices", "mesh_task_size",
  "vertex_count", "vertices", "primitive_count", "primitives",
  "ray_invocation_id", "num_ray_invocations", "instance_custom_data", "geometry_index",
  "world_ray_origin", "world_ray_direction", "object_ray_origin", "object_ray_direction",
  "ray_t_min", "ray_t_current_max", "object_to_world", "world_to_object", "hit_kind",
  // Attribute names (used after @)
  "group", "binding", "location", "builtin", "compute", "vertex", "fragment",
  "workgroup_size", "align", "size", "id", "interpolate",
  "invariant", "must_use", "blend_src",
  // Attribute names from extensions: Tint's, then naga's
  "color", "input_attachment_index",
  "task", "mesh", "early_depth_test", "per_primitive", "ray_generation", "any_hit", "closest_hit", "miss",
  "payload", "incoming_payload",
  // Interpolation types and sampling (`per_vertex` is naga's)
  "flat", "linear", "perspective", "center", "centroid", "sample",
  "first", "either", "per_vertex",
]);

/** Single-letter swizzle components. */
export const SWIZZLE = new Set(["x", "y", "z", "w", "r", "g", "b", "a"]);

/** Swizzles of two to four letters, from `xyzw` or from `rgba`. */
export const SWIZZLE_PATTERN = /^[xyzw]{2,4}$|^[rgba]{2,4}$/;

/** True for a reserved word, a builtin name or a single-letter swizzle. */
export function isReserved(name: string): boolean {
  return RESERVED.has(name) || BUILTINS.has(name) || SWIZZLE.has(name);
}

/** True for names that read as a vector swizzle: `x`, `rgb`, `xyzw`, ... */
export function isSwizzle(name: string): boolean {
  return SWIZZLE.has(name) || SWIZZLE_PATTERN.test(name);
}

/** Predeclared enumerants and naga's ray constants. A declaration named after one is never renamed, not even a local. */
export const ENUMERANTS = new Set([
  // Address spaces; those after `storage` are extensions
  "function", "private", "workgroup", "uniform", "storage", "push_constant", "immediate", "pixel_local",
  "task_payload", "ray_payload", "incoming_ray_payload",
  // Access modes (`atomic` is naga's, for storage textures)
  "read", "write", "read_write", "atomic",
  // naga's ray flag template argument (`ray_query<vertex_return>`)
  "vertex_return",
  // naga's ray constants. naga reads these as values before any scope lookup,
  // so no declaration shadows them: uses and declarations stay as written.
  "RAY_FLAG_NONE", "RAY_FLAG_FORCE_OPAQUE", "RAY_FLAG_FORCE_NO_OPAQUE", "RAY_FLAG_TERMINATE_ON_FIRST_HIT",
  "RAY_FLAG_SKIP_CLOSEST_HIT_SHADER", "RAY_FLAG_CULL_BACK_FACING", "RAY_FLAG_CULL_FRONT_FACING",
  "RAY_FLAG_CULL_OPAQUE", "RAY_FLAG_CULL_NO_OPAQUE", "RAY_FLAG_SKIP_TRIANGLES", "RAY_FLAG_SKIP_AABBS",
  "RAY_QUERY_INTERSECTION_NONE", "RAY_QUERY_INTERSECTION_TRIANGLE", "RAY_QUERY_INTERSECTION_GENERATED",
  "RAY_QUERY_INTERSECTION_AABB",
  // Texel formats
  "rgba8unorm", "rgba8snorm", "rgba8uint", "rgba8sint",
  "rgba16unorm", "rgba16snorm", "rgba16uint", "rgba16sint", "rgba16float",
  "rg8unorm", "rg8snorm", "rg8uint", "rg8sint",
  "rg16unorm", "rg16snorm", "rg16uint", "rg16sint", "rg16float",
  "r32uint", "r32sint", "r32float",
  "rg32uint", "rg32sint", "rg32float",
  "rgba32uint", "rgba32sint", "rgba32float",
  "bgra8unorm",
  "r8unorm", "r8snorm", "r8uint", "r8sint",
  "r16unorm", "r16snorm", "r16uint", "r16sint", "r16float",
  "rgb10a2unorm", "rgb10a2uint", "rg11b10ufloat", "r64uint",
]);

/** Extension words too common to keep everywhere. They are predeclared only when a project file names the
 * extension or one of its `uses`, since its `enable` may be outside the project. Locals need no keeping:
 * naga rejects a matrix role (`coop_mat8x8<f32, A>`) that a local shadows. */
export const EXTENSION_PREDECLARED: ReadonlyArray<{
  extension: string;
  uses: ReadonlySet<string>;
  words: ReadonlySet<string>;
}> = [
  { extension: "wgpu_cooperative_matrix", uses: new Set(["coop_mat8x8", "coop_mat16x16"]), words: new Set(["A", "B", "C"]) },
];

/** Names in `BUILTINS` that are context-dependent, not predeclared, so a module-scope declaration of one may be renamed. */
export const CONTEXT_NAMES = new Set([
  // Builtin values (@builtin)
  "position", "vertex_index", "instance_index", "front_facing",
  "frag_depth", "local_invocation_id", "local_invocation_index",
  "global_invocation_id", "workgroup_id", "num_workgroups",
  "sample_index", "sample_mask",
  "clip_distances", "primitive_index",
  "subgroup_invocation_id", "subgroup_size", "subgroup_id", "num_subgroups",
  // Builtin values from extensions: Tint's, then naga's
  "global_invocation_index", "workgroup_index", "barycentric_coord",
  "view_index", "draw_index", "barycentric", "barycentric_no_perspective",
  "cull_primitive", "point_index", "line_indices", "triangle_indices", "mesh_task_size",
  "vertex_count", "vertices", "primitive_count", "primitives",
  "ray_invocation_id", "num_ray_invocations", "instance_custom_data", "geometry_index",
  "world_ray_origin", "world_ray_direction", "object_ray_origin", "object_ray_direction",
  "ray_t_min", "ray_t_current_max", "object_to_world", "world_to_object", "hit_kind",
  // Attribute names (used after @)
  "group", "binding", "location", "builtin", "compute", "vertex", "fragment",
  "workgroup_size", "align", "size", "id", "interpolate",
  "invariant", "must_use", "blend_src",
  // Attribute names from extensions: Tint's, then naga's
  "color", "input_attachment_index",
  "task", "mesh", "early_depth_test", "per_primitive", "ray_generation", "any_hit", "closest_hit", "miss",
  "payload", "incoming_payload",
  // Interpolation types and sampling (`per_vertex` is naga's)
  "flat", "linear", "perspective", "center", "centroid", "sample",
  "first", "either", "per_vertex",
]);

/** True for names WGSL predeclares. Reads `BUILTINS` on every call, so changes to it take effect. */
export function isPredeclared(name: string): boolean {
  return ENUMERANTS.has(name) || (BUILTINS.has(name) && !CONTEXT_NAMES.has(name));
}

/**
 * Members of builtin result structs. Without types, `r.exp` on a `frexp` result
 * looks like a field access, so a struct field with one of these names is never renamed.
 */
export const BUILTIN_MEMBERS = new Set([
  // frexp, modf
  "fract", "whole", "exp",
  // atomicCompareExchangeWeak
  "old_value", "exchanged",
  // naga's ray query extension: RayDesc and RayIntersection
  "flags", "cull_mask", "tmin", "tmax", "origin", "dir",
  "kind", "t", "instance_custom_data", "instance_custom_index", "instance_index",
  "instance_id", "sbt_record_offset", "geometry_index", "primitive_index",
  "barycentrics", "front_face", "object_to_world", "world_to_object",
]);

/** Attributes that make a function an entry point. Those after `compute` are naga extensions. */
export const STAGE_ATTRIBUTES = new Set([
  "vertex", "fragment", "compute", "task", "mesh", "ray_generation", "any_hit", "closest_hit", "miss",
]);

/** Attributes whose arguments are expressions, resolved like other code. naga looks up
 * the argument of `@payload` and `@incoming_payload` (its extensions) at module scope. */
export const EXPRESSION_ARGUMENT_ATTRIBUTES = new Set([
  "align", "binding", "blend_src", "group", "id", "location", "size", "workgroup_size",
  "color", "input_attachment_index", "subgroup_size", "payload", "incoming_payload",
]);

/** Attributes whose arguments are context-dependent names, as in `@builtin(position)`. */
export const CONTEXT_ARGUMENT_ATTRIBUTES = new Set([
  "builtin", "interpolate", "diagnostic", "early_depth_test",
]);

/** Attributes that take no arguments. naga still accepts `@mesh(output)`, so arguments
 * after one of these are treated like an unknown attribute's. */
export const NO_ARGUMENT_ATTRIBUTES = new Set([
  "const", "invariant", "must_use", "vertex", "fragment", "compute", "task", "mesh",
  "per_primitive", "coherent", "volatile", "ray_generation", "any_hit", "closest_hit", "miss",
]);

/** How an attribute's arguments are read. `unknown` arguments stay as written and every declaration they
 * could name is kept. Reads the sets on every call, so changes to them take effect. */
export function attributeArguments(name: string): "expression" | "context" | "none" | "unknown" {
  if (EXPRESSION_ARGUMENT_ATTRIBUTES.has(name)) return "expression";
  if (CONTEXT_ARGUMENT_ATTRIBUTES.has(name)) return "context";
  if (NO_ARGUMENT_ATTRIBUTES.has(name)) return "none";
  return "unknown";
}

/** Directives: every name up to their `;` is context-dependent. */
export const DIRECTIVES = new Set(["enable", "requires", "diagnostic"]);

/** The reserved words WGSL uses today. */
export const KEYWORDS = new Set([
  "alias", "break", "case", "const", "const_assert", "continue", "continuing",
  "default", "diagnostic", "discard", "else", "enable", "false", "fn", "for",
  "if", "let", "loop", "override", "requires", "return", "struct", "switch",
  "true", "var", "while",
]);

/** Keywords that start a statement, declaration or directive; none can appear in a declaration before its `;`. */
export const STATEMENT_KEYWORDS = new Set([...KEYWORDS].filter((k) => k !== "true" && k !== "false"));

/** Every operator and punctuation token WGSL has. */
export const PUNCTUATION = new Set([
  "&", "&&", "->", "@", "/", "!", "[", "]", "{", "}", ":", ",", "=", "==", "!=",
  ">", ">=", ">>", "<", "<=", "<<", "%", "-", "--", ".", "+", "++", "|", "||",
  "(", ")", ";", "*", "~", "^",
  "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", ">>=", "<<=",
]);
