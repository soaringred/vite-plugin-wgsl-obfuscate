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

interface ConstDecl {
  id: number;
  name: string;
  value: Token[];
  scope: number;
  declStart: number;
  declEnd: number;
}

/**
 * Inline all `const` declarations at their usage sites and remove
 * the declarations. Resolves chained dependencies (const A referencing
 * const B) via topological expansion.
 *
 * Handles lexical scoping: `const` declarations inside function bodies
 * only inline within their enclosing block, and shadow module-level consts
 * of the same name. Brace depth is tracked via `{`/`}` tokens; WGSL uses
 * these only for struct and function bodies, so depth tracking is reliable
 * (const values use `()` for constructors, not `{}`).
 *
 * If any dependency cycle is detected (`const A = B; const B = A;`), the
 * source would not compile anyway, so we bail out of inlining entirely and
 * return the original tokens. This avoids unbounded token growth inside
 * our own inliner when given broken input.
 */
export function inlineConsts(tokens: Token[]): Token[] {
  // Scope tree: scopeParent[i] = parent of scope i (null for module scope).
  const scopeParent: (number | null)[] = [null];
  const scopeOf = new Array<number>(tokens.length);

  const consts: ConstDecl[] = [];
  const constsByName = new Map<string, ConstDecl[]>();

  // Pass 1: walk tokens, track brace-delimited scopes, collect const decls.
  {
    let scope = 0;
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];

      if (tok.type === "op" && tok.value === "{") {
        scopeOf[i] = scope;
        const newScope = scopeParent.length;
        scopeParent.push(scope);
        scope = newScope;
        continue;
      }
      if (tok.type === "op" && tok.value === "}") {
        const p = scopeParent[scope];
        if (p !== null) scope = p;
        scopeOf[i] = scope;
        continue;
      }
      scopeOf[i] = scope;

      if (tok.type !== "ident" || tok.value !== "const") continue;

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
        const decl: ConstDecl = {
          id: consts.length,
          name,
          value: valueToks,
          scope,
          declStart: i,
          declEnd: endIdx + 1, // include the `;`
        };
        consts.push(decl);
        const list = constsByName.get(name);
        if (list) list.push(decl);
        else constsByName.set(name, [decl]);
      }
    }
  }

  // Resolve a name at a given scope to the innermost enclosing const decl.
  // Walks up the scope chain, returning the first matching decl (shadowing).
  const resolve = (name: string, atScope: number): ConstDecl | null => {
    const candidates = constsByName.get(name);
    if (!candidates) return null;
    let cur: number | null = atScope;
    while (cur !== null) {
      for (const d of candidates) {
        if (d.scope === cur) return d;
      }
      cur = scopeParent[cur];
    }
    return null;
  };

  // Pass 2: DFS with color coding to detect cycles AND produce a
  // topological order for acyclic consts simultaneously. Keyed per-decl
  // (not per-name) so two decls sharing a name in different scopes are
  // treated independently.
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Array<0 | 1 | 2>(consts.length).fill(WHITE);
  const topoOrder: ConstDecl[] = [];
  let cycleFound = false;

  const visit = (d: ConstDecl): void => {
    if (cycleFound || color[d.id] === BLACK) return;
    color[d.id] = GRAY;
    for (const tok of d.value) {
      if (tok.type !== "ident") continue;
      const dep = resolve(tok.value, d.scope);
      if (!dep) continue;
      if (color[dep.id] === GRAY) {
        cycleFound = true;
        return;
      }
      visit(dep);
      if (cycleFound) return;
    }
    color[d.id] = BLACK;
    topoOrder.push(d); // post-order: dependencies appear before dependents
  };

  for (const d of consts) {
    visit(d);
    if (cycleFound) return tokens; // broken source; leave everything untouched
  }

  const OPEN: Token = { type: "op", value: "(", start: 0, end: 0 };
  const CLOSE: Token = { type: "op", value: ")", start: 0, end: 0 };

  // Pass 3: expand each const in topological order.
  // Each const's dependencies are fully expanded when we get to it, so one
  // pass per const suffices. Multi-token dependencies are wrapped in parens
  // to preserve precedence — e.g. `const A = 1+2; const B = A*3` must
  // expand B to `(1+2)*3`, not `1+2*3`.
  for (const d of topoOrder) {
    const expanded: Token[] = [];
    for (const tok of d.value) {
      if (tok.type === "ident") {
        const dep = resolve(tok.value, d.scope);
        if (dep) {
          const depNonWs = dep.value.filter((t) => t.type !== "whitespace").length;
          if (depNonWs > 1) expanded.push(OPEN, ...dep.value, CLOSE);
          else expanded.push(...dep.value);
          continue;
        }
      }
      expanded.push(tok);
    }
    d.value = expanded;
  }

  // Parenthesize multi-token values at usage sites to preserve precedence
  // (e.g. `const K = 1+2; K*3` → `(1+2)*3`, not `1+2*3`).
  const needsParens = new Set<number>();
  for (const d of consts) {
    const nonWs = d.value.filter((t) => t.type !== "whitespace").length;
    if (nonWs > 1) needsParens.add(d.id);
  }

  const removeIndices = new Set<number>();
  for (const d of consts) {
    for (let i = d.declStart; i < d.declEnd; i++) removeIndices.add(i);
  }

  // Pass 4: rebuild token stream. Use scopeOf[] from Pass 1 so each ident
  // use resolves relative to its enclosing block.
  const result: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (removeIndices.has(i)) continue;
    if (tokens[i].type === "ident") {
      const d = resolve(tokens[i].value, scopeOf[i]);
      if (d) {
        if (needsParens.has(d.id)) {
          result.push(OPEN, ...d.value, CLOSE);
        } else {
          result.push(...d.value);
        }
        continue;
      }
    }
    result.push(tokens[i]);
  }
  return result;
}

