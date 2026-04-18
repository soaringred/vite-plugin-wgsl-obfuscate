// Vite plugin (primary export)
export { wgslObfuscate, type PluginOptions } from "./plugin";

// Standalone obfuscation (for CLI tools, Webpack loaders, etc.)
export { obfuscate, type ObfuscateOptions } from "./obfuscate";

// Tokenizer (for building custom transforms)
export { tokenize, extractEntryPoints, type Token } from "./tokenizer";

// WGSL grammar (for extending keyword/builtin sets)
export { RESERVED, BUILTINS, SWIZZLE, SWIZZLE_PATTERN, isReserved } from "./wgsl-grammar";
