import type { Token } from "@/wgsl/tokenizer";
import { tokenize, attributeName, isGap } from "@/wgsl/tokenizer";

export interface EmitOptions {
  /** Drop whitespace wherever tokens stay apart without it. Default true; false keeps it and makes each comment a space. */
  collapseWhitespace?: boolean;
  /** Output text for the `ident` token at `index`, or undefined to keep it: decided per token, not per name. */
  rename?: (token: Token, index: number) => string | undefined;
}

/** True when `a` then `b` tokenizes back to those two tokens, so the space between them can go.
 * `let` + `x`, `-` + `-`, `/` + `*` and `0` + `x1` all need it. */
export function canJoin(a: string, b: string): boolean {
  const tokens = tokenize(a + b);
  return tokens.length === 2 && tokens[0].value === a && tokens[1].value === b;
}

/** Attribute text with the gap between `@` and the name collapsed or kept. */
function attributeText(token: Token, collapse: boolean): string {
  const name = attributeName(token);
  if (collapse || token.value === `@${name}`) return `@${name}`;
  const gap = tokenize(token.value.slice(1, token.value.length - name.length))
    .map((t) => (t.type === "comment" ? " " : t.value))
    .join("");
  return `@${gap}${name}`;
}

/** Turn tokens back into source text without comments. A comment counts as whitespace, so its neighbours
 * never join; tokens that touch in the source touch in the output. */
export function emit(tokens: Token[], options: EmitOptions = {}): string {
  const collapse = options.collapseWhitespace ?? true;
  const rename = options.rename;

  // The same pairs come up again and again (`let` + ident, `)` + `{`, ...)
  const joinCache = new Map<string, boolean>();
  const joins = (a: string, b: string): boolean => {
    const key = `${a}\u0000${b}`;
    let result = joinCache.get(key);
    if (result === undefined) {
      result = canJoin(a, b);
      joinCache.set(key, result);
    }
    return result;
  };

  let out = "";
  let prev: string | null = null; // output text of the previous non-gap token
  let gap = ""; // pending gap text, used when not collapsing
  let hasGap = false;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];

    if (isGap(tok)) {
      hasGap = true;
      if (!collapse) gap += tok.type === "comment" ? " " : tok.value;
      continue;
    }

    let text = tok.value;
    if (tok.type === "ident" && rename) text = rename(tok, i) ?? tok.value;
    else if (tok.type === "attribute") text = attributeText(tok, collapse);

    if (!collapse) out += gap;
    else if (hasGap && prev !== null && !joins(prev, text)) out += " ";

    out += text;
    prev = text;
    gap = "";
    hasGap = false;
  }

  // Trailing whitespace only survives when whitespace is kept as written
  if (!collapse) out += gap;
  return out;
}
