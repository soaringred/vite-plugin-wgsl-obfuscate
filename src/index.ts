// Vite plugin (primary export)
export { wgslObfuscate, type PluginOptions } from "@/vite/plugin";

// Standalone obfuscation (for CLI tools, Webpack loaders, etc.)
export {
  obfuscate,
  obfuscateProject,
  StrictError,
  type ObfuscateOptions,
  type ProjectResult,
  type ProjectReport,
  type FileReport,
  type KeptName,
  type CrossFileLink,
  type KeepRule,
  type DoubtRule,
  type Doubt,
  type SourcePosition,
  type NameSpace,
} from "@/engine/obfuscate";

// Structural validation and its error type (not full WGSL validation)
export { validate, ObfuscateError } from "@/wgsl/validate";

// Thrown when a self-check rejects an output
export { VerifyError } from "@/engine/verify";

// Tokenizer (for building custom transforms)
export { tokenize, extractEntryPoints, type Token } from "@/wgsl/tokenizer";

// WGSL grammar (for extending keyword/builtin sets)
export {
  RESERVED,
  BUILTINS,
  SWIZZLE,
  SWIZZLE_PATTERN,
  ENUMERANTS,
  BUILTIN_MEMBERS,
  isReserved,
} from "@/wgsl/grammar";
