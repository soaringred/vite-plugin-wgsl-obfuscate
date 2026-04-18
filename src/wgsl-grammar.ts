/**
 * WGSL grammar definitions — keywords, builtins, and reserved words.
 *
 * Sources:
 *   - Reserved words: wgsl.reserved.plain (from gpuweb/gpuweb spec)
 *     https://github.com/gpuweb/gpuweb/blob/main/wgsl/wgsl.reserved.plain
 *   - Builtin identifiers: Naga (wgpu) keyword list
 *     https://github.com/gfx-rs/wgpu/blob/trunk/naga/src/keywords/wgsl.rs
 */

/** WGSL reserved words — includes both active keywords and future-reserved words */
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

/** WGSL builtin identifiers — types, functions, access modes, formats */
export const BUILTINS = new Set([
  // Scalar types
  "bool", "i32", "u32", "f32", "f16", "i64", "u64", "f64",
  // Composite types
  "array", "atomic", "ptr",
  "vec2", "vec3", "vec4",
  "mat2x2", "mat2x3", "mat2x4", "mat3x2", "mat3x3", "mat3x4",
  "mat4x2", "mat4x3", "mat4x4",
  // Predeclared type aliases
  "vec2f", "vec3f", "vec4f", "vec2i", "vec3i", "vec4i",
  "vec2u", "vec3u", "vec4u", "vec2h", "vec3h", "vec4h",
  "mat2x2f", "mat2x3f", "mat2x4f", "mat3x2f", "mat3x3f", "mat3x4f",
  "mat4x2f", "mat4x3f", "mat4x4f",
  "mat2x2h", "mat2x3h", "mat2x4h", "mat3x2h", "mat3x3h", "mat3x4h",
  "mat4x2h", "mat4x3h", "mat4x4h",
  // Sampler types
  "sampler", "sampler_comparison",
  // Texture types
  "texture_1d", "texture_2d", "texture_2d_array", "texture_3d",
  "texture_cube", "texture_cube_array", "texture_multisampled_2d",
  "texture_depth_2d", "texture_depth_2d_array", "texture_depth_cube",
  "texture_depth_cube_array", "texture_depth_multisampled_2d",
  "texture_external",
  "texture_storage_1d", "texture_storage_2d", "texture_storage_2d_array",
  "texture_storage_3d",
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
  // Builtin functions — conversion
  "bitcast",
  // Builtin functions — logical
  "all", "any", "select",
  // Builtin functions — array
  "arrayLength",
  // Builtin functions — math
  "abs", "acos", "acosh", "asin", "asinh", "atan", "atanh", "atan2",
  "ceil", "clamp", "cos", "cosh", "cross", "degrees", "determinant",
  "distance", "dot", "exp", "exp2", "faceForward", "floor", "fma",
  "fract", "frexp", "inverseSqrt", "ldexp", "length", "log", "log2",
  "max", "min", "mix", "modf", "normalize", "pow", "quantizeToF16",
  "radians", "reflect", "refract", "round", "saturate",
  "sign", "sin", "sinh", "smoothstep", "sqrt", "step", "tan", "tanh",
  "transpose", "trunc",
  // Builtin functions — integer
  "countLeadingZeros", "countOneBits", "countTrailingZeros",
  "extractBits", "firstLeadingBit", "firstTrailingBit", "insertBits",
  "reverseBits",
  // Builtin functions — packed dot product
  "dot4U8Packed", "dot4I8Packed",
  // Builtin functions — derivative
  "dpdx", "dpdxCoarse", "dpdxFine",
  "dpdy", "dpdyCoarse", "dpdyFine",
  "fwidth", "fwidthCoarse", "fwidthFine",
  // Builtin functions — texture
  "textureDimensions", "textureGather", "textureGatherCompare",
  "textureLoad", "textureNumLayers", "textureNumLevels", "textureNumSamples",
  "textureSample", "textureSampleBias", "textureSampleCompare",
  "textureSampleCompareLevel", "textureSampleGrad", "textureSampleLevel",
  "textureSampleBaseClampToEdge", "textureStore",
  // Builtin functions — atomic
  "atomicLoad", "atomicStore", "atomicAdd", "atomicSub", "atomicMax",
  "atomicMin", "atomicAnd", "atomicOr", "atomicXor", "atomicExchange",
  "atomicCompareExchangeWeak",
  // Builtin functions — packing
  "pack4x8snorm", "pack4x8unorm", "pack4xI8", "pack4xU8",
  "pack4xI8Clamp", "pack4xU8Clamp",
  "pack2x16snorm", "pack2x16unorm", "pack2x16float",
  "unpack4x8snorm", "unpack4x8unorm", "unpack4xI8", "unpack4xU8",
  "unpack2x16snorm", "unpack2x16unorm", "unpack2x16float",
  // Builtin functions — synchronization
  "storageBarrier", "textureBarrier", "workgroupBarrier",
  "workgroupUniformLoad",
  // Builtin functions — subgroup
  "subgroupAdd", "subgroupExclusiveAdd", "subgroupInclusiveAdd",
  "subgroupAll", "subgroupAnd", "subgroupAny",
  "subgroupBallot", "subgroupBroadcast", "subgroupBroadcastFirst",
  "subgroupElect", "subgroupMax", "subgroupMin",
  "subgroupMul", "subgroupExclusiveMul", "subgroupInclusiveMul",
  "subgroupOr", "subgroupShuffle", "subgroupShuffleDown",
  "subgroupShuffleUp", "subgroupShuffleXor", "subgroupXor",
  // Builtin functions — quad
  "quadBroadcast", "quadSwapDiagonal", "quadSwapX", "quadSwapY",
  // Builtin values (@builtin)
  "position", "vertex_index", "instance_index", "front_facing",
  "frag_depth", "local_invocation_id", "local_invocation_index",
  "global_invocation_id", "workgroup_id", "num_workgroups",
  "sample_index", "sample_mask",
  "clip_distances", "primitive_index",
  "subgroup_invocation_id", "subgroup_size", "subgroup_id", "num_subgroups",
  // Attribute names (used after @)
  "group", "binding", "location", "builtin", "compute", "vertex", "fragment",
  "workgroup_size", "align", "size", "id", "interpolate",
  "invariant", "must_use", "blend_src",
  // Interpolation types and sampling
  "flat", "linear", "perspective", "center", "centroid", "sample",
  "first", "either",
]);

/** Swizzle components — single chars that could be member access */
export const SWIZZLE = new Set(["x", "y", "z", "w", "r", "g", "b", "a"]);

/**
 * Multi-character swizzle pattern.
 * Matches 2-4 character combinations from {x,y,z,w} or {r,g,b,a}.
 */
export const SWIZZLE_PATTERN = /^[xyzw]{2,4}$|^[rgba]{2,4}$/;

/** Check if an identifier must not be renamed */
export function isReserved(name: string): boolean {
  return RESERVED.has(name) || BUILTINS.has(name) || SWIZZLE.has(name);
}
