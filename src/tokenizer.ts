export interface Token {
  type: "ident" | "number" | "op" | "whitespace" | "comment" | "attribute";
  value: string;
  start: number;
  end: number;
}

/** Tokenize WGSL source into a stream of typed tokens. */
export function tokenize(src: string): Token[] {
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

    // Block comments (WGSL supports nesting)
    if (src[i] === "/" && src[i + 1] === "*") {
      const start = i;
      let depth = 1;
      i += 2;
      while (i < src.length - 1 && depth > 0) {
        if (src[i] === "/" && src[i + 1] === "*") { depth++; i += 2; }
        else if (src[i] === "*" && src[i + 1] === "/") { depth--; i += 2; }
        else { i++; }
      }
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
      i++;
      while (i < src.length && /[a-zA-Z_0-9]/.test(src[i])) i++;
      tokens.push({ type: "attribute", value: src.slice(start, i), start, end: i });
      continue;
    }

    // Numbers (including hex, float with suffix)
    if (
      /[0-9]/.test(src[i]) ||
      (src[i] === "." && i + 1 < src.length && /[0-9]/.test(src[i + 1]))
    ) {
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
        if (i < src.length && (src[i] === "e" || src[i] === "E")) {
          i++;
          if (i < src.length && (src[i] === "+" || src[i] === "-")) i++;
          while (i < src.length && /[0-9]/.test(src[i])) i++;
        }
      }
      // Type suffix (u, i, f, h) — only if not followed by ident chars
      if (
        i < src.length && /[uifh]/.test(src[i]) &&
        (i + 1 >= src.length || !/[a-zA-Z_0-9]/.test(src[i + 1]))
      ) i++;
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
 * Extract entry point names from WGSL tokens.
 * Entry points are functions preceded by @compute, @vertex, or @fragment.
 */
export function extractEntryPoints(tokens: Token[]): Set<string> {
  const entryPoints = new Set<string>();
  const stageAttrs = new Set(["@compute", "@vertex", "@fragment"]);

  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== "attribute" || !stageAttrs.has(tokens[i].value)) continue;

    // Scan forward past attributes, argument lists, and whitespace to find "fn <name>"
    let j = i + 1;
    let parenDepth = 0;
    while (j < tokens.length) {
      if (parenDepth > 0) {
        if (tokens[j].type === "op" && tokens[j].value === "(") parenDepth++;
        else if (tokens[j].type === "op" && tokens[j].value === ")") parenDepth--;
        j++;
        continue;
      }
      if (tokens[j].type === "whitespace" || tokens[j].type === "attribute") {
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
