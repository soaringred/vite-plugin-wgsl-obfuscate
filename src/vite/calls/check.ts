import { tokenize } from "@/wgsl/tokenizer";
import type { ShaderLiteral } from "@/vite/calls/find";

// The check at `buildEnd`. A literal handed to a shader call is WGSL by definition, and the plugin does not
// obfuscate it, so a name in it that the project renamed will not link.

/** A shader literal and where its module has it. */
export interface ShaderCall extends ShaderLiteral {
  /** `file:line`, in the module as written. */
  place: string;
}

/** Identifiers in the text of `parts`. One that touches a `${...}` may be part of a longer name, so it does not count. */
export function namesUsed(parts: string[]): Set<string> {
  const names = new Set<string>();
  parts.forEach((part, p) => {
    for (const token of tokenize(part)) {
      if (token.type !== "ident") continue;
      if ((p > 0 && token.start === 0) || (p < parts.length - 1 && token.end === part.length)) continue;
      names.add(token.value);
    }
  });
  return names;
}

/** Messages of the check, null when it has nothing to say. */
export interface CallFindings {
  /** Shaders that use renamed names: an error, or a warning under `leakCheck: "warn"`. */
  broken: string | null;
  /** Shaders built with `${...}` that the check cannot read: always a warning. */
  unchecked: string | null;
}

function code(text: string): string {
  return text.includes("`") ? text : `\`${text}\``;
}

export function checkCalls(calls: ShaderCall[], renamed: (name: string) => boolean): CallFindings {
  const broken: string[] = [];
  const unchecked: string[] = [];
  for (const { place, call, parts } of calls) {
    const used = [...namesUsed(parts)].filter(renamed).sort();
    if (used.length > 0) broken.push(`  - ${place}: ${code(call)} uses ${used.map(code).join(", ")}`);
    else if (parts.length > 1) unchecked.push(`  - ${place}: ${code(call)}`);
  }
  return {
    broken: broken.length > 0 ? brokenMessage(broken) : null,
    unchecked: unchecked.length > 0 ? uncheckedMessage(unchecked) : null,
  };
}

function brokenMessage(lines: string[]): string {
  const one = lines.length === 1;
  return [
    `${one ? "A shader in a JS string uses" : `${lines.length} shaders in JS strings use`} names that the plugin ` +
      `renamed, so ${one ? "it" : "they"} will not link with the obfuscated shaders:`,
    ...lines,
    `Move ${one ? "the shader" : "each shader"} into a \`.wgsl\` file imported with \`?raw\`, so that it is obfuscated ` +
      "with the others. If it cannot move, add the names to `preserve`. If it is never linked with the obfuscated " +
      "shaders and the match is a coincidence, add the names to `leakIgnore`.",
  ].join("\n");
}

function uncheckedMessage(lines: string[]): string {
  const one = lines.length === 1;
  return [
    `Cannot check ${one ? "a shader" : `${lines.length} shaders`} built with \`\${...}\`: the plugin cannot see ` +
      "what the substitutions insert.",
    ...lines,
    `If ${one ? "it uses" : "one uses"} a name that the plugin renames, it will not link with the obfuscated shaders. ` +
      "Move it into a `.wgsl` file imported with `?raw`, or add the names it uses to `preserve`.",
  ].join("\n");
}
