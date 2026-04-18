import type { Token } from "./tokenizer";
import { RESERVED, BUILTINS, SWIZZLE, SWIZZLE_PATTERN } from "./wgsl-grammar";

// ── Name generation ─────────────────────────────────────────────────

/** Generate short obfuscated names: _a, _b, ... _z, _aa, _ab, ... */
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

// ── Rename identifiers ──────────────────────────────────────────────

/**
 * Build a rename map for all user-defined identifiers.
 * Sorts by frequency so the most-used identifiers get the shortest names.
 *
 * Idents matching a vec swizzle pattern (`x`/`y`/`z`/`w`, `r`/`g`/`b`/`a`, or
 * 2–4 character combinations like `xy`/`rgba`/`xyzw`) are never renamed.
 * `obj.xy` could be either struct-field access or vec swizzle depending on
 * the base's type, and we can't reliably tell without type inference. Skipping
 * those names sacrifices a tiny amount of obfuscation (they're rare as user
 * idents, and single-char ones are already minimal) in exchange for zero
 * risk of breaking valid shaders. Use `preserve` if you ever need to force
 * a swizzle-pattern name through (won't help; it's already not renamed —
 * but the same mechanism covers any other ident you want to keep).
 */
export function buildRenameMap(
  tokens: Token[],
  preserve: Set<string>,
): Map<string, string> {
  const counts = new Map<string, number>();
  for (const tok of tokens) {
    if (tok.type !== "ident") continue;
    if (RESERVED.has(tok.value)) continue;
    if (BUILTINS.has(tok.value)) continue;
    if (preserve.has(tok.value)) continue;
    if (SWIZZLE.has(tok.value)) continue;
    if (SWIZZLE_PATTERN.test(tok.value)) continue;
    counts.set(tok.value, (counts.get(tok.value) ?? 0) + 1);
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const nextName = nameGenerator();
  const map = new Map<string, string>();
  for (const [ident] of sorted) {
    map.set(ident, nextName());
  }
  return map;
}

// ── Inline const declarations ───────────────────────────────────────

/**
 * Inline all `const` declarations at their usage sites and remove
 * the declarations. Resolves chained dependencies (const A referencing
 * const B) via topological expansion.
 *
 * If any dependency cycle is detected (`const A = B; const B = A;`), the
 * source would not compile anyway, so we bail out of inlining entirely and
 * return the original tokens. This avoids unbounded token growth inside
 * our own inliner when given broken input.
 */
export function inlineConsts(tokens: Token[]): Token[] {
  const constValues = new Map<string, Token[]>();
  const constRanges = new Map<string, { start: number; end: number }>();

  // Pass 1: find const declarations and their value tokens
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== "ident" || tokens[i].value !== "const") continue;

    let j = i + 1;
    while (j < tokens.length && tokens[j].type === "whitespace") j++;
    if (j >= tokens.length || tokens[j].type !== "ident") continue;
    const name = tokens[j].value;

    let eqIdx = j + 1;
    while (
      eqIdx < tokens.length &&
      !(tokens[eqIdx].type === "op" && tokens[eqIdx].value === "=")
    ) {
      eqIdx++;
    }
    if (eqIdx >= tokens.length) continue;

    const valueToks: Token[] = [];
    let endIdx = eqIdx + 1;
    while (
      endIdx < tokens.length &&
      !(tokens[endIdx].type === "op" && tokens[endIdx].value === ";")
    ) {
      if (valueToks.length === 0 && tokens[endIdx].type === "whitespace") {
        endIdx++;
        continue;
      }
      valueToks.push(tokens[endIdx]);
      endIdx++;
    }

    if (valueToks.length > 0) {
      constValues.set(name, valueToks);
      constRanges.set(name, { start: i, end: endIdx + 1 });
    }
  }

  // Pass 2: DFS with color coding to detect cycles AND produce a
  // topological order for acyclic consts simultaneously.
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, 0 | 1 | 2>();
  const topoOrder: string[] = [];
  let cycleFound = false;
  for (const name of constValues.keys()) color.set(name, WHITE);

  const visit = (name: string): void => {
    if (cycleFound) return;
    if (color.get(name) !== WHITE) return;
    color.set(name, GRAY);
    for (const tok of constValues.get(name) ?? []) {
      if (tok.type !== "ident" || !constValues.has(tok.value)) continue;
      const dep = tok.value;
      if (color.get(dep) === GRAY) {
        cycleFound = true;
        return;
      }
      visit(dep);
      if (cycleFound) return;
    }
    color.set(name, BLACK);
    topoOrder.push(name); // post-order: dependencies appear before dependents
  };

  for (const name of constValues.keys()) {
    visit(name);
    if (cycleFound) return tokens; // broken source; leave everything untouched
  }

  // Pass 3: expand each const in topological order.
  // Each const's dependencies are fully expanded when we get to it, so one
  // pass per const suffices (O(n·expanded-size)).
  for (const name of topoOrder) {
    const val = constValues.get(name)!;
    const expanded: Token[] = [];
    for (const tok of val) {
      if (tok.type === "ident" && constValues.has(tok.value)) {
        expanded.push(...constValues.get(tok.value)!);
      } else {
        expanded.push(tok);
      }
    }
    constValues.set(name, expanded);
  }

  // Parenthesize multi-token values to preserve operator precedence at
  // usage sites (e.g. `const K = 1+2; K*3` → `(1+2)*3`, not `1+2*3`).
  const needsParens = new Set<string>();
  for (const [name, toks] of constValues) {
    const nonWs = toks.filter((t) => t.type !== "whitespace");
    if (nonWs.length > 1) needsParens.add(name);
  }

  const removeIndices = new Set<number>();
  for (const { start, end } of constRanges.values()) {
    for (let i = start; i < end; i++) removeIndices.add(i);
  }

  const OPEN: Token = { type: "op", value: "(", start: 0, end: 0 };
  const CLOSE: Token = { type: "op", value: ")", start: 0, end: 0 };

  const result: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (removeIndices.has(i)) continue;
    if (tokens[i].type === "ident" && constValues.has(tokens[i].value)) {
      const name = tokens[i].value;
      if (needsParens.has(name)) {
        result.push(OPEN, ...constValues.get(name)!, CLOSE);
      } else {
        result.push(...constValues.get(name)!);
      }
    } else {
      result.push(tokens[i]);
    }
  }
  return result;
}

