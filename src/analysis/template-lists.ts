import type { Token } from "@/wgsl/tokenizer";

// WGSL's template list discovery (spec, "Template Lists") over one file's significant tokens. The spec reads
// code points, and a `>>` or `>=` holds two that may each end a list, so operator tokens are read by character;
// a gap between tokens stands for the blankspace or comment there.

export interface TemplateLists {
  /** For a `<` token that opens a template list: the token holding its closing `>`. */
  closeOf: Map<number, number>;
  /** For a token holding closing `>`s (`>`, `>>`, `>=`, `>>=`): the `<` tokens its leading `>`s close, in order.
   * Only leading ones can close: a `>` that closes nothing leaves the state unchanged. */
  closes: Map<number, number[]>;
}

/** A unit of the stream the algorithm reads. */
type Unit =
  | { kind: "gap" }
  | { kind: "literal" }
  | { kind: "ident" }
  | { kind: "char"; char: string; token: number; offset: number };

function units(tokens: Token[]): Unit[] {
  const out: Unit[] = [];
  tokens.forEach((t, k) => {
    if (k > 0 && tokens[k - 1].end !== t.start) out.push({ kind: "gap" });
    if (t.type === "number" || (t.type === "ident" && (t.value === "true" || t.value === "false"))) {
      out.push({ kind: "literal" });
    } else if (t.type === "ident") {
      // A lone `_` is not an identifier-pattern token
      out.push(t.value === "_" ? { kind: "char", char: "_", token: k, offset: 0 } : { kind: "ident" });
    } else if (t.type === "attribute") {
      // `@`, then the name, which is an identifier-pattern token
      out.push({ kind: "char", char: "@", token: k, offset: 0 }, { kind: "gap" }, { kind: "ident" });
    } else {
      for (let i = 0; i < t.value.length; i++) out.push({ kind: "char", char: t.value[i], token: k, offset: i });
    }
  });
  return out;
}

/** Run the discovery over the significant tokens of one file. */
export function discoverTemplateLists(tokens: Token[]): TemplateLists {
  const result: TemplateLists = { closeOf: new Map(), closes: new Map() };
  const u = units(tokens);
  const pending: { token: number; depth: number }[] = [];
  let depth = 0;
  const charAt = (i: number): string | undefined => {
    const unit = u[i];
    return unit?.kind === "char" ? unit.char : undefined;
  };
  const popToDepth = () => {
    while (pending.length > 0 && pending[pending.length - 1].depth >= depth) pending.pop();
  };

  let i = 0;
  while (i < u.length) {
    while (i < u.length && (u[i].kind === "gap" || u[i].kind === "literal")) i++;
    if (i >= u.length) break;
    const unit = u[i];

    if (unit.kind === "ident") {
      i++;
      while (i < u.length && u[i].kind === "gap") i++;
      const lt = u[i];
      if (lt?.kind === "char" && lt.char === "<") {
        pending.push({ token: lt.token, depth });
        i++;
        if (charAt(i) === "<" || charAt(i) === "=") {
          // `<<` or `<=`
          pending.pop();
          i++;
        }
      }
      continue;
    }

    const c = charAt(i)!;
    if (c === ">") {
      const top = pending[pending.length - 1];
      if (top && top.depth === depth) {
        const close = unit as Extract<Unit, { kind: "char" }>;
        result.closeOf.set(top.token, close.token);
        result.closes.set(close.token, [...(result.closes.get(close.token) ?? []), top.token]);
        pending.pop();
        i++;
      } else {
        i++;
        if (charAt(i) === "=") i++; // `>=`
      }
    } else if (c === "(" || c === "[") {
      depth++;
      i++;
    } else if (c === ")" || c === "]") {
      popToDepth();
      depth = Math.max(0, depth - 1);
      i++;
    } else if (c === "!") {
      i++;
      if (charAt(i) === "=") i++; // `!=`
    } else if (c === "=") {
      i++;
      if (charAt(i) === "=") {
        i++; // `==`
      } else {
        // An assignment: no template list continues across it
        depth = 0;
        pending.length = 0;
      }
    } else if (c === ";" || c === "{" || c === ":") {
      depth = 0;
      pending.length = 0;
      i++;
    } else if ((c === "&" && charAt(i + 1) === "&") || (c === "|" && charAt(i + 1) === "|")) {
      popToDepth();
      i += 2;
    } else {
      i++;
    }
  }
  return result;
}
