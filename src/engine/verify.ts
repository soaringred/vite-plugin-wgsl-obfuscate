import type { Token } from "@/wgsl/tokenizer";
import { tokenize, attributeName, isGap } from "@/wgsl/tokenizer";
import { resolve } from "@/analysis/resolver";
import { positionAt } from "@/wgsl/position";
import type { FileAnalysis } from "@/analysis/resolver";
import type { ProjectBuild } from "@/engine/project";

// Self-checks on every output: a violation throws a VerifyError rather than ship a doubtful shader.
// Only the binding check resolves the output, so it catches allocation mistakes (a name capturing
// another) but not resolver mistakes; the test suite's compilers catch those.

export class VerifyError extends Error {
  constructor(
    /** File id, or "project" for a project-wide check. */
    readonly file: string,
    /** Where the violation is, e.g. "token 12 (input 3:5, output 1:40)". */
    readonly position: string,
    readonly reason: string,
  ) {
    super(
      `WGSL obfuscation self-check failed in ${file} at ${position}: ${reason}. This is a bug in ` +
        "vite-plugin-wgsl-obfuscate: please report it with the shader at https://github.com/soaringred/vite-plugin-wgsl-obfuscate/issues.",
    );
    this.name = "VerifyError";
  }
}

/** 1-based "line:column" of `offset` in `source`, with WGSL's line breaks. */
function lineColumn(source: string, offset: number): string {
  const { line, column } = positionAt(source, offset);
  return `${line}:${column}`;
}

/** Position of significant token `k` in the input and in the output. */
function positionOf(input: Token[], inputSource: string, output: Token[], outputSource: string, k: number): string {
  const parts: string[] = [];
  if (k < input.length) parts.push(`input ${lineColumn(inputSource, input[k].start)}`);
  if (k < output.length) parts.push(`output ${lineColumn(outputSource, output[k].start)}`);
  return `token ${k}${parts.length > 0 ? ` (${parts.join(", ")})` : ""}`;
}

function significant(tokens: Token[]): Token[] {
  return tokens.filter((t) => !isGap(t));
}

function describeToken(token: Token | undefined): string {
  return token === undefined ? "nothing" : `${token.type} "${token.value}"`;
}

// ── Token shape ─────────────────────────────────────────────────────

/** The output has the input's significant tokens, with the same text except identifiers the input does not
 * class as `keyword` or `context`. Attributes compare by name. */
export function checkTokenShape(file: string, input: FileAnalysis, output: string): void {
  const inputSource = input.tokens.map((t) => t.value).join("");
  const inputTokens = input.sig.map((i) => input.tokens[i]);
  const outputTokens = significant(tokenize(output));
  const fail = (k: number, reason: string): never => {
    throw new VerifyError(file, positionOf(inputTokens, inputSource, outputTokens, output, k), reason);
  };

  const length = Math.min(inputTokens.length, outputTokens.length);
  for (let k = 0; k < length; k++) {
    const a = inputTokens[k];
    const b = outputTokens[k];
    if (a.type !== b.type) {
      fail(k, `${describeToken(a)} became ${describeToken(b)}`);
    } else if (a.type === "attribute") {
      if (attributeName(a) !== attributeName(b)) fail(k, `attribute @${attributeName(a)} became @${attributeName(b)}`);
    } else if (a.type !== "ident") {
      if (a.value !== b.value) fail(k, `${describeToken(a)} became ${describeToken(b)}`);
    } else if (input.classes[k] === "keyword" || input.classes[k] === "context") {
      if (a.value !== b.value) fail(k, `${input.classes[k]} "${a.value}" was renamed to "${b.value}"`);
    }
  }
  if (inputTokens.length !== outputTokens.length) {
    fail(
      length,
      `the output has ${outputTokens.length} tokens and the input ${inputTokens.length}; ` +
        `${describeToken(inputTokens[length])} in the input, ${describeToken(outputTokens[length])} in the output`,
    );
  }
}

// ── Binding shape ───────────────────────────────────────────────────

/** In the resolved output every identifier keeps its class and binds to the declaration at the same index.
 * Unresolved names stay or follow the module map; members follow the member map. */
export function checkBindingShape(
  file: string,
  input: FileAnalysis,
  output: string,
  moduleMap: ReadonlyMap<string, string>,
  memberMap: ReadonlyMap<string, string>,
): void {
  const inputSource = input.tokens.map((t) => t.value).join("");
  const inputTokens = input.sig.map((i) => input.tokens[i]);
  const result = resolve(tokenize(output));
  const outputTokens = result.sig.map((i) => result.tokens[i]);
  const fail = (k: number, reason: string): never => {
    throw new VerifyError(file, positionOf(inputTokens, inputSource, outputTokens, output, k), reason);
  };

  if (inputTokens.length !== outputTokens.length) {
    fail(Math.min(inputTokens.length, outputTokens.length), "the output does not have the input's token shape");
  }

  for (let k = 0; k < inputTokens.length; k++) {
    const cls = input.classes[k];
    if (cls === undefined) continue;
    const before = inputTokens[k].value;
    const after = outputTokens[k].value;
    if (result.classes[k] !== cls) {
      fail(k, `"${before}" is ${cls} in the input but "${after}" is ${result.classes[k] ?? "not an identifier"} in the output`);
    }

    if (cls === "decl" || cls === "ref") {
      const declIn = input.symbols[input.bindings[k]].decl;
      const declOut = result.symbols[result.bindings[k]]?.decl ?? -1;
      if (declIn !== declOut) {
        fail(
          k,
          `"${before}" binds to the declaration at token ${declIn}, ` +
            `but "${after}" binds to the declaration at token ${declOut}`,
        );
      }
    } else if (cls === "unresolved") {
      if (after !== before && after !== moduleMap.get(before)) {
        fail(k, `unresolved "${before}" became "${after}", which is not its module map name`);
      }
    } else if (cls === "member-decl" || cls === "member-ref") {
      const expected = memberMap.get(before) ?? before;
      if (after !== expected) fail(k, `member "${before}" became "${after}" instead of "${expected}"`);
    }
  }
}

// ── Project consistency ─────────────────────────────────────────────

/** Names declared at module scope, from a plain scan at brace depth 0 without the resolver. */
export function scanModuleDeclarations(source: string): Set<string> {
  const toks = significant(tokenize(source));
  const names = new Set<string>();
  let depth = 0;
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.type === "op" && t.value === "{") depth++;
    else if (t.type === "op" && t.value === "}") depth--;
    else if (depth === 0 && t.type === "ident" && /^(fn|const|override|var|struct|alias)$/.test(t.value)) {
      let j = k + 1;
      if (t.value === "var" && toks[j]?.value === "<") {
        while (j < toks.length && !toks[j].value.startsWith(">")) j++;
        j++;
      }
      if (toks[j]?.type === "ident") names.add(toks[j].value);
    }
  }
  return names;
}

/** Identifier texts in `sources`, without the resolver. */
function scanIdentifiers(sources: string[]): Set<string> {
  const names = new Set<string>();
  for (const source of sources) {
    for (const t of tokenize(source)) if (t.type === "ident") names.add(t.value);
  }
  return names;
}

/** The maps are one-to-one, generated names are new, and every renamed module-scope name is declared somewhere. */
export function checkProjectConsistency(build: ProjectBuild): void {
  const sources = build.files.map((f) => f.source);
  const identifiers = scanIdentifiers(sources);
  const declared = new Set(sources.flatMap((source) => [...scanModuleDeclarations(source)]));

  const checkMap = (label: string, map: ReadonlyMap<string, string>) => {
    const originals = new Map<string, string>();
    for (const [from, to] of map) {
      const other = originals.get(to);
      if (other !== undefined) {
        throw new VerifyError("project", label, `"${other}" and "${from}" are both renamed to "${to}"`);
      }
      originals.set(to, from);
      if (identifiers.has(to)) {
        throw new VerifyError("project", label, `"${from}" is renamed to "${to}", which appears in the sources`);
      }
    }
  };
  checkMap("module map", build.moduleMap);
  checkMap("member map", build.memberMap);

  for (const name of build.localNames) {
    if (identifiers.has(name)) {
      throw new VerifyError("project", "local names", `generated local name "${name}" appears in the sources`);
    }
  }

  for (const name of build.moduleMap.keys()) {
    if (!declared.has(name)) {
      throw new VerifyError("project", "module map", `"${name}" is renamed but nothing declares it at module scope`);
    }
  }

  // A changed unresolved identifier must follow the module map for a name some file declares
  for (const file of build.files) {
    const { analysis, names } = file;
    for (let k = 0; k < analysis.sig.length; k++) {
      if (analysis.classes[k] !== "unresolved" || names[k] === undefined) continue;
      const name = analysis.tokens[analysis.sig[k]].value;
      if (names[k] === name) continue;
      if (!declared.has(name) || build.moduleMap.get(name) !== names[k]) {
        const offset = analysis.tokens[analysis.sig[k]].start;
        throw new VerifyError(
          file.id,
          `token ${k} (input ${lineColumn(file.source, offset)})`,
          `unresolved "${name}" was renamed to "${names[k]}" but no file declares it at module scope`,
        );
      }
    }
  }
}

/** Run all three checks on a built project. Throws a VerifyError on the first violation. */
export function verifyBuild(build: ProjectBuild): void {
  for (const file of build.files) {
    checkTokenShape(file.id, file.analysis, file.output);
    checkBindingShape(file.id, file.analysis, file.output, build.moduleMap, build.memberMap);
  }
  checkProjectConsistency(build);
}
