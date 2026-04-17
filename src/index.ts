import type { Plugin } from "vite";

/**
 * Vite plugin that obfuscates WGSL shader source in production builds.
 * Strips comments, renames user-defined identifiers, collapses whitespace.
 * Only active in production — dev mode serves readable source.
 */

// WGSL reserved keywords — never rename these
const KEYWORDS = new Set([
  // declarations
  "fn", "var", "let", "const", "struct", "alias", "override",
  // types
  "bool", "i32", "u32", "f32", "f16", "vec2", "vec3", "vec4",
  "mat2x2", "mat2x3", "mat2x4", "mat3x2", "mat3x3", "mat3x4",
  "mat4x2", "mat4x3", "mat4x4", "array", "ptr", "atomic",
  // type constructors / access
  "storage", "read", "read_write", "write", "uniform", "private", "workgroup", "function",
  // control flow
  "if", "else", "for", "while", "loop", "switch", "case", "default",
  "break", "continue", "return", "discard", "continuing",
  // literals / values
  "true", "false",
  // other
  "enable", "diagnostic", "require",
]);

// WGSL builtins — never rename these
const BUILTINS = new Set([
  // math
  "abs", "acos", "acosh", "asin", "asinh", "atan", "atan2", "atanh",
  "ceil", "clamp", "cos", "cosh", "cross", "degrees", "determinant",
  "distance", "dot", "exp", "exp2", "faceForward", "floor", "fma",
  "fract", "frexp", "inverseSqrt", "ldexp", "length", "log", "log2",
  "max", "min", "mix", "modf", "normalize", "pow", "quantizeToF16",
  "radians", "reflect", "refract", "reverseBits", "round", "saturate",
  "sign", "sin", "sinh", "smoothstep", "sqrt", "step", "tan", "tanh",
  "transpose", "trunc",
  // integer
  "countLeadingZeros", "countOneBits", "countTrailingZeros",
  "extractBits", "firstLeadingBit", "firstTrailingBit", "insertBits",
  // texture
  "textureDimensions", "textureGather", "textureGatherCompare",
  "textureLoad", "textureNumLayers", "textureNumLevels", "textureNumSamples",
  "textureSample", "textureSampleBias", "textureSampleCompare",
  "textureSampleCompareLevel", "textureSampleGrad", "textureSampleLevel",
  "textureStore",
  // packing
  "pack4x8snorm", "pack4x8unorm", "pack2x16snorm", "pack2x16unorm", "pack2x16float",
  "unpack4x8snorm", "unpack4x8unorm", "unpack2x16snorm", "unpack2x16unorm", "unpack2x16float",
  // synchronization
  "storageBarrier", "workgroupBarrier", "textureBarrier",
  // atomics
  "atomicLoad", "atomicStore", "atomicAdd", "atomicSub", "atomicMax",
  "atomicMin", "atomicAnd", "atomicOr", "atomicXor", "atomicExchange",
  "atomicCompareExchangeWeak",
  // other builtins
  "select", "arrayLength", "bitcast",
  // builtin values (used with @builtin)
  "position", "vertex_index", "instance_index", "front_facing",
  "frag_depth", "local_invocation_id", "local_invocation_index",
  "global_invocation_id", "workgroup_id", "num_workgroups", "sample_index",
  "sample_mask",
  // attributes
  "group", "binding", "location", "builtin", "compute", "vertex", "fragment",
  "workgroup_size", "align", "size", "id", "interpolate",
]);

// Swizzle components — never rename single chars that could be swizzle
const SWIZZLE = new Set(["x", "y", "z", "w", "r", "g", "b", "a"]);

export interface ObfuscateOptions {
  /** File patterns to obfuscate (default: /\.wgsl(\?raw)?$/) */
  include?: RegExp;
  /** Preserve these identifiers (e.g. entry point names) */
  preserve?: string[];
  /** Rename user-defined identifiers (default: true) */
  renameIdents?: boolean;
  /** Strip comments (default: true) */
  stripComments?: boolean;
  /** Collapse whitespace (default: true) */
  collapseWhitespace?: boolean;
  /** Split recognizable numeric literals into sums (default: true) */
  splitConstants?: boolean;
  /** Inline const declarations at usage sites (default: true) */
  inlineConsts?: boolean;
}

/**
 * Tokenize WGSL source into identifiers, operators, literals, etc.
 * Returns tokens with their positions for replacement.
 */
interface Token {
  type: "ident" | "number" | "op" | "whitespace" | "comment" | "string" | "attribute";
  value: string;
  start: number;
  end: number;
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < src.length) {
    // Line comments
    if (src[i] === "/" && src[i + 1] === "/") {
      const start = i;
      while (i < src.length && src[i] !== "\n") i++;
      tokens.push({ type: "comment", value: src.slice(start, i), start, end: i });
      continue;
    }

    // Block comments
    if (src[i] === "/" && src[i + 1] === "*") {
      const start = i;
      i += 2;
      while (i < src.length - 1 && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      tokens.push({ type: "comment", value: src.slice(start, i), start, end: i });
      continue;
    }

    // Whitespace
    if (/\s/.test(src[i])) {
      const start = i;
      while (i < src.length && /\s/.test(src[i])) i++;
      tokens.push({ type: "whitespace", value: src.slice(start, i), start, end: i });
      continue;
    }

    // @ attributes
    if (src[i] === "@") {
      const start = i;
      i++; // skip @
      while (i < src.length && /[a-zA-Z_0-9]/.test(src[i])) i++;
      tokens.push({ type: "attribute", value: src.slice(start, i), start, end: i });
      continue;
    }

    // Numbers (including hex, float with suffix)
    if (/[0-9]/.test(src[i]) || (src[i] === "." && i + 1 < src.length && /[0-9]/.test(src[i + 1]))) {
      const start = i;
      if (src[i] === "0" && (src[i + 1] === "x" || src[i + 1] === "X")) {
        i += 2;
        while (i < src.length && /[0-9a-fA-F]/.test(src[i])) i++;
      } else {
        while (i < src.length && /[0-9]/.test(src[i])) i++;
        if (i < src.length && src[i] === ".") {
          i++;
          while (i < src.length && /[0-9]/.test(src[i])) i++;
        }
        // Scientific notation
        if (i < src.length && (src[i] === "e" || src[i] === "E")) {
          i++;
          if (i < src.length && (src[i] === "+" || src[i] === "-")) i++;
          while (i < src.length && /[0-9]/.test(src[i])) i++;
        }
      }
      // Type suffix (u, i, f, h)
      if (i < src.length && /[uifh]/.test(src[i])) i++;
      tokens.push({ type: "number", value: src.slice(start, i), start, end: i });
      continue;
    }

    // Identifiers
    if (/[a-zA-Z_]/.test(src[i])) {
      const start = i;
      while (i < src.length && /[a-zA-Z_0-9]/.test(src[i])) i++;
      tokens.push({ type: "ident", value: src.slice(start, i), start, end: i });
      continue;
    }

    // Everything else (operators, punctuation)
    const start = i;
    i++;
    tokens.push({ type: "op", value: src.slice(start, i), start, end: i });
  }

  return tokens;
}

/**
 * Generate short obfuscated names: _a, _b, ... _z, _aa, _ab, ...
 */
function nameGenerator(): () => string {
  let counter = 0;
  return () => {
    let n = counter++;
    let name = "_";
    do {
      name += String.fromCharCode(97 + (n % 26));
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return name;
  };
}

/**
 * Split a numeric literal into a sum of 2-3 random parts.
 * Uses a seeded approach based on the value itself for deterministic builds.
 * Only splits non-trivial numbers (skips 0, 1, small integers used as indices).
 */
function splitNumeric(raw: string): string {
  // Parse the numeric value
  const hasSuffix = /[uifh]$/.test(raw);
  const suffix = hasSuffix ? raw.slice(-1) : "";
  const numStr = hasSuffix ? raw.slice(0, -1) : raw;

  // Skip integers used as indices/offsets (0-99), and trivially recognizable values
  const val = parseFloat(numStr);
  if (isNaN(val) || val === 0) return raw;

  // Skip small integers (likely loop bounds, offsets, array indices)
  if (Number.isInteger(val) && Math.abs(val) < 100) return raw;

  // Skip hex literals
  if (numStr.startsWith("0x") || numStr.startsWith("0X")) return raw;

  // Determine number of terms (2 or 3)
  const terms = Math.abs(val) > 100 ? 3 : 2;

  // Generate random-looking but deterministic splits based on the value
  const seed = Math.abs(val * 7919 + 1) % 1000;
  const parts: number[] = [];
  let remaining = val;

  for (let i = 0; i < terms - 1; i++) {
    // Pick a fraction of the remaining value
    const frac = (0.3 + ((seed * (i + 1) * 13) % 100) / 200);
    const part = remaining * frac;
    // Round to avoid introducing precision artifacts
    const rounded = parseFloat(part.toPrecision(8));
    parts.push(rounded);
    remaining -= rounded;
  }
  parts.push(parseFloat(remaining.toPrecision(10)));

  // Format each part, preserving the type suffix on the last one
  const isFloat = raw.includes(".") || raw.includes("e") || raw.includes("E") || suffix === "f";

  const formatted = parts.map((p, i) => {
    let s: string;
    if (isFloat) {
      s = p.toPrecision(8);
      // Ensure it has a decimal point for WGSL float parsing
      if (!s.includes(".") && !s.includes("e") && !s.includes("E")) s += ".0";
    } else {
      s = Math.round(p).toString();
    }
    // Add suffix only to last term
    if (i === parts.length - 1 && suffix) s += suffix;
    return s;
  });

  return `(${formatted.join("+")})`;
}

interface ObfuscateFlags {
  renameIdents: boolean;
  stripComments: boolean;
  collapseWhitespace: boolean;
  splitConstants: boolean;
  inlineConsts: boolean;
}

/**
 * Inline const declarations — replace every usage of a const with its value
 * and remove the declaration. Works on the token stream before other transforms.
 */
function inlineConstDeclarations(tokens: Token[]): Token[] {
  // First pass: find all const declarations and their values
  // Pattern: "const" <ws> <ident> <ws?> ":" <type> <ws?> "=" <value tokens> ";"
  const constValues = new Map<string, Token[]>();
  const constRanges: Array<{ start: number; end: number; name: string }> = [];

  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== "ident" || tokens[i].value !== "const") continue;

    // Find the identifier name (skip whitespace)
    let j = i + 1;
    while (j < tokens.length && tokens[j].type === "whitespace") j++;
    if (j >= tokens.length || tokens[j].type !== "ident") continue;
    const name = tokens[j].value;

    // Find the "=" sign
    let eqIdx = j + 1;
    while (eqIdx < tokens.length && !(tokens[eqIdx].type === "op" && tokens[eqIdx].value === "=")) {
      eqIdx++;
    }
    if (eqIdx >= tokens.length) continue;

    // Collect value tokens until ";"
    const valueTokens: Token[] = [];
    let endIdx = eqIdx + 1;
    while (endIdx < tokens.length && !(tokens[endIdx].type === "op" && tokens[endIdx].value === ";")) {
      // Skip leading whitespace in value
      if (valueTokens.length === 0 && tokens[endIdx].type === "whitespace") {
        endIdx++;
        continue;
      }
      valueTokens.push(tokens[endIdx]);
      endIdx++;
    }

    if (valueTokens.length > 0) {
      constValues.set(name, valueTokens);
      constRanges.push({ start: i, end: endIdx + 1, name }); // +1 to include ";"
    }
  }

  // Second pass: rebuild tokens with consts removed and usages replaced
  const removeIndices = new Set<number>();
  for (const range of constRanges) {
    for (let i = range.start; i < range.end; i++) {
      removeIndices.add(i);
    }
  }

  const result: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (removeIndices.has(i)) continue;
    if (tokens[i].type === "ident" && constValues.has(tokens[i].value)) {
      result.push(...constValues.get(tokens[i].value)!);
    } else {
      result.push(tokens[i]);
    }
  }

  return result;
}

function obfuscateWgsl(src: string, preserve: Set<string>, flags: ObfuscateFlags): string {
  let tokens = tokenize(src);

  // Inline const declarations before renaming
  if (flags.inlineConsts) {
    tokens = inlineConstDeclarations(tokens);
  }

  // Build rename map
  const renameMap = new Map<string, string>();
  if (flags.renameIdents) {
    const identCounts = new Map<string, number>();
    for (const tok of tokens) {
      if (tok.type !== "ident") continue;
      if (KEYWORDS.has(tok.value)) continue;
      if (BUILTINS.has(tok.value)) continue;
      if (preserve.has(tok.value)) continue;
      if (SWIZZLE.has(tok.value)) continue;
      identCounts.set(tok.value, (identCounts.get(tok.value) ?? 0) + 1);
    }
    const sorted = [...identCounts.entries()].sort((a, b) => b[1] - a[1]);
    const nextName = nameGenerator();
    for (const [ident] of sorted) {
      renameMap.set(ident, nextName());
    }
  }

  // Rebuild source
  let out = "";
  let prevType: Token["type"] | null = null;

  for (const tok of tokens) {
    if (flags.stripComments && tok.type === "comment") continue;

    if (tok.type === "whitespace") {
      if (flags.collapseWhitespace) {
        if (prevType === "ident" || prevType === "number" || prevType === "attribute") {
          out += " ";
        }
      } else {
        out += tok.value;
      }
      prevType = tok.type;
      continue;
    }

    if (tok.type === "ident") {
      out += renameMap.get(tok.value) ?? tok.value;
      prevType = tok.type;
      continue;
    }

    if (flags.splitConstants && tok.type === "number") {
      out += splitNumeric(tok.value);
      prevType = tok.type;
      continue;
    }

    out += tok.value;
    prevType = tok.type;
  }

  return out;
}

/**
 * Extract entry point names from WGSL tokens.
 * Entry points are functions preceded by @compute, @vertex, or @fragment attributes.
 */
function extractEntryPoints(tokens: Token[]): Set<string> {
  const entryPoints = new Set<string>();
  const stageAttrs = new Set(["@compute", "@vertex", "@fragment"]);

  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== "attribute" || !stageAttrs.has(tokens[i].value)) continue;

    // Scan forward past attributes and whitespace to find "fn <name>"
    let j = i + 1;
    while (j < tokens.length) {
      if (tokens[j].type === "whitespace" || tokens[j].type === "attribute") {
        j++;
        continue;
      }
      if (tokens[j].type === "ident" && tokens[j].value === "fn") {
        // Next non-whitespace ident is the entry point name
        j++;
        while (j < tokens.length && tokens[j].type === "whitespace") j++;
        if (j < tokens.length && tokens[j].type === "ident") {
          entryPoints.add(tokens[j].value);
        }
      }
      break;
    }
  }

  return entryPoints;
}

export function wgslObfuscate(options: ObfuscateOptions = {}): Plugin {
  const include = options.include ?? /\.wgsl/;
  const manualPreserve = new Set(options.preserve ?? []);
  const flags: ObfuscateFlags = {
    renameIdents: options.renameIdents ?? true,
    stripComments: options.stripComments ?? true,
    collapseWhitespace: options.collapseWhitespace ?? true,
    splitConstants: options.splitConstants ?? true,
    inlineConsts: options.inlineConsts ?? true,
  };

  return {
    name: "vite-plugin-wgsl-obfuscate",
    apply: "build",
    transform(code, id) {
      if (!include.test(id)) return null;

      const rawMatch = code.match(/^export default "(.*)"$/s);
      if (rawMatch) {
        const wgsl = rawMatch[1]
          .replace(/\\n/g, "\n")
          .replace(/\\t/g, "\t")
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, "\\");

        // Auto-detect entry points and merge with manual preserve list
        const tokens = tokenize(wgsl);
        const entryPoints = extractEntryPoints(tokens);
        const preserve = new Set([...manualPreserve, ...entryPoints]);

        const obfuscated = obfuscateWgsl(wgsl, preserve, flags);

        const escaped = obfuscated
          .replace(/\\/g, "\\\\")
          .replace(/"/g, '\\"')
          .replace(/\n/g, "\\n");

        return { code: `export default "${escaped}"`, map: null };
      }

      const tokens = tokenize(code);
      const entryPoints = extractEntryPoints(tokens);
      const preserve = new Set([...manualPreserve, ...entryPoints]);

      return { code: obfuscateWgsl(code, preserve, flags), map: null };
    },
  };
}
