export interface Token {
  type: "ident" | "number" | "op" | "whitespace" | "comment" | "attribute";
  value: string;
  start: number;
  end: number;
}

// ── Lexical grammar ─────────────────────────────────────────────────

/** WGSL blankspace: space, tab, the line breaks, and the two direction marks. */
const BLANKSPACE = /[\t\n\v\f\r \u0085\u200e\u200f\u2028\u2029]/;

/** WGSL line breaks. A line comment runs up to, not including, the first one. */
const LINE_BREAK = /[\n\v\f\r\u0085\u2028\u2029]/;

/** Identifier per the WGSL spec: start `[\p{XID_Start}_]`, continue `\p{XID_Continue}`. */
const IDENT = /[\p{XID_Start}_]\p{XID_Continue}*/uy;

/** The identifier at the end of an attribute token is its name. */
const TRAILING_IDENT = /[\p{XID_Start}_]\p{XID_Continue}*$/u;

/** WGSL multi-character operators, longest first. Everything else is one character. */
const MULTI_CHAR_OPS = [
  ">>=", "<<=",
  "->", "==", "!=", "<=", ">=", "&&", "||", "++", "--",
  "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<", ">>",
];

/** WGSL numeric literals; the longest match wins, as in the spec. A hex float takes an `f` or `h` suffix
 * only after its exponent, since both letters are also hex digits. */
const NUMBER_PATTERNS = [
  // Hex floats: 0x1.8p1, 0x.8, 0x1., 0x1p-2f
  /0[xX][0-9a-fA-F]*\.[0-9a-fA-F]+(?:[pP][+-]?[0-9]+[fh]?)?/y,
  /0[xX][0-9a-fA-F]+\.[0-9a-fA-F]*(?:[pP][+-]?[0-9]+[fh]?)?/y,
  /0[xX][0-9a-fA-F]+[pP][+-]?[0-9]+[fh]?/y,
  // Hex integers: 0xFF, 0xFFu
  /0[xX][0-9a-fA-F]+[iu]?/y,
  // Decimal floats: .5, 1., 1.5e-3f, 1e5, 2f
  /[0-9]*\.[0-9]+(?:[eE][+-]?[0-9]+)?[fh]?/y,
  /[0-9]+\.[0-9]*(?:[eE][+-]?[0-9]+)?[fh]?/y,
  /[0-9]+[eE][+-]?[0-9]+[fh]?/y,
  /(?:0|[1-9][0-9]*)[fh]/y,
  // Decimal integers: 0, 42, 42u, 7i
  /(?:0|[1-9][0-9]*)[iu]?/y,
];

/** Length of the pattern match at `i`, or 0. */
function matchAt(pattern: RegExp, src: string, i: number): number {
  pattern.lastIndex = i;
  const m = pattern.exec(src);
  return m ? m[0].length : 0;
}

/** Length of the longest numeric literal at `i`, or 0. */
function matchNumber(src: string, i: number): number {
  let longest = 0;
  for (const pattern of NUMBER_PATTERNS) {
    longest = Math.max(longest, matchAt(pattern, src, i));
  }
  return longest;
}

/** End of the line comment that starts at `i`. */
function lineCommentEnd(src: string, i: number): number {
  while (i < src.length && !LINE_BREAK.test(src[i])) i++;
  return i;
}

/** End of the block comment that starts at `i`. WGSL block comments nest. */
function blockCommentEnd(src: string, i: number): number {
  let depth = 1;
  i += 2;
  while (i < src.length && depth > 0) {
    if (src[i] === "/" && src[i + 1] === "*") { depth++; i += 2; }
    else if (src[i] === "*" && src[i + 1] === "/") { depth--; i += 2; }
    else { i++; }
  }
  // An unterminated comment runs to the end of the source
  return Math.min(i, src.length);
}

/** Skip blankspace and comments starting at `i`. */
function skipGap(src: string, i: number): number {
  while (i < src.length) {
    if (BLANKSPACE.test(src[i])) i++;
    else if (src.startsWith("//", i)) i = lineCommentEnd(src, i);
    else if (src.startsWith("/*", i)) i = blockCommentEnd(src, i);
    else break;
  }
  return i;
}

// ── Tokenizer ───────────────────────────────────────────────────────

/** Tokenize WGSL source into a stream of typed tokens. */
export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  const push = (type: Token["type"], start: number) => {
    tokens.push({ type, value: src.slice(start, i), start, end: i });
  };

  while (i < src.length) {
    const start = i;

    if (src.startsWith("//", i)) {
      i = lineCommentEnd(src, i);
      push("comment", start);
      continue;
    }

    if (src.startsWith("/*", i)) {
      i = blockCommentEnd(src, i);
      push("comment", start);
      continue;
    }

    if (BLANKSPACE.test(src[i])) {
      while (i < src.length && BLANKSPACE.test(src[i])) i++;
      push("whitespace", start);
      continue;
    }

    // Blankspace and comments may separate `@` from the name (`@ fragment`); the whole run is one token
    if (src[i] === "@") {
      const nameStart = skipGap(src, i + 1);
      const nameLength = matchAt(IDENT, src, nameStart);
      i = nameLength > 0 ? nameStart + nameLength : i + 1;
      push("attribute", start);
      continue;
    }

    if (/[0-9.]/.test(src[i])) {
      const length = matchNumber(src, i);
      if (length > 0) {
        i += length;
        push("number", start);
        continue;
      }
    }

    const identLength = matchAt(IDENT, src, i);
    if (identLength > 0) {
      i += identLength;
      push("ident", start);
      continue;
    }

    // Operators: longest match, else one code point
    const op = MULTI_CHAR_OPS.find((candidate) => src.startsWith(candidate, i));
    i += op ? op.length : String.fromCodePoint(src.codePointAt(i)!).length;
    push("op", start);
  }

  return tokens;
}

/** Name of an attribute token without `@`, blankspace or comments: `@ fragment` gives "fragment", `@` gives "". */
export function attributeName(token: Token): string {
  return token.value.match(TRAILING_IDENT)?.[0] ?? "";
}

/** True for tokens that only separate other tokens: whitespace and comments. */
export function isGap(token: Token): boolean {
  return token.type === "whitespace" || token.type === "comment";
}

/** Names of the functions marked `@compute`, `@vertex` or `@fragment` in `tokens`. */
export function extractEntryPoints(tokens: Token[]): Set<string> {
  const entryPoints = new Set<string>();
  const stages = new Set(["compute", "vertex", "fragment"]);

  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== "attribute" || !stages.has(attributeName(tokens[i]))) continue;

    // Skip attributes, their arguments and gaps to find `fn <name>`
    let j = i + 1;
    let parenDepth = 0;
    while (j < tokens.length) {
      if (parenDepth > 0) {
        if (tokens[j].type === "op" && tokens[j].value === "(") parenDepth++;
        else if (tokens[j].type === "op" && tokens[j].value === ")") parenDepth--;
        j++;
        continue;
      }
      if (isGap(tokens[j]) || tokens[j].type === "attribute") {
        j++;
        continue;
      }
      if (tokens[j].type === "op" && tokens[j].value === "(") {
        parenDepth++;
        j++;
        continue;
      }
      if (tokens[j].type === "ident" && tokens[j].value === "fn") {
        j++;
        while (j < tokens.length && isGap(tokens[j])) j++;
        if (j < tokens.length && tokens[j].type === "ident") {
          entryPoints.add(tokens[j].value);
        }
      }
      break;
    }
  }

  return entryPoints;
}
