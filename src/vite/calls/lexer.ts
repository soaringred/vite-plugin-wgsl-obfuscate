// A quick read of a JS module before parsing it: does code (not a comment, string or regex) call a shader
// call with a literal first argument? Parsing a module the size of three.js costs about 100 ms; this read,
// a few. When the code confuses it, it says yes and the parser decides.

/** Words after which `/` starts a regular expression rather than a division. */
const BEFORE_EXPRESSION = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await",
]);

/** Keywords whose parenthesised head can be followed by a regular expression: `if (a) /x/.test(b)`. */
const HEADS = new Set(["if", "while", "for", "with"]);

/** What a string, a template or a regular expression ends at, or breaks at. */
const STRING_STOPS: Record<string, RegExp> = { '"': /["\\\n\r]/g, "'": /['\\\n\r]/g };
const TEMPLATE_STOPS = /[`\\$]/g;
const LINE_END = /[\n\r\u2028\u2029]/g;

/** Whitespace and comments. */
const GAP = /(?:\s+|\/\*[\s\S]*?\*\/|\/\/[^\n\r\u2028\u2029]*)*/y;

/** A character of a JS identifier, approximately, and never whitespace. */
const WORD_CHAR = /(?!\s)(?:[\w$]|[^\x00-\x7f])/;

/** Stack markers besides the offset of an open `(`. */
const BRACE = -1;
const SUBSTITUTION = -2;

/** The stops of `mayCallShader`: characters that change what the code is, and `words`, the call names as an
 * alternation. */
export function lexerStops(words: string): RegExp {
  return new RegExp(`["'\`(){}/]|(?<![\\w$])(?:${words})(?![\\w$])`, "g");
}

/** False only when no code in `code` passes a string, template or object literal to a call that `stops` names. */
export function mayCallShader(code: string, stops: RegExp): boolean {
  const comments = new Map<number, number>(); // end to start, to look back past them
  const stack: number[] = [];
  let openParen = -1;
  let closeParen = -1;

  /** Index just after the last significant character before `i`. */
  const back = (i: number): number => {
    for (;;) {
      while (i > 0 && /\s/.test(code[i - 1])) i--;
      const start = comments.get(i);
      if (start === undefined) return i;
      i = start;
    }
  };
  const wordBefore = (end: number): string => {
    let start = end;
    while (start > 0 && WORD_CHAR.test(code[start - 1])) start--;
    return code.slice(start, end);
  };
  const skipGap = (i: number): number => {
    GAP.lastIndex = i;
    GAP.test(code);
    return GAP.lastIndex;
  };

  /** Whether a `/` at `i` that starts no comment starts a regular expression, from what precedes it. */
  const startsRegex = (i: number): boolean => {
    const j = back(i);
    if (j === 0) return true;
    const c = code[j - 1];
    if (c === ")") return j - 1 === closeParen && HEADS.has(wordBefore(back(openParen)));
    if (c === "]" || c === '"' || c === "'" || c === "`") return false;
    if (c === "+" || c === "-") return code[j - 2] !== c;
    if (c === ".") return code[j - 2] === ".";
    if (WORD_CHAR.test(c)) {
      const word = wordBefore(j);
      return BEFORE_EXPRESSION.has(word) && code[j - word.length - 1] !== ".";
    }
    return true;
  };

  /** End of the string, template part or regex that starts at `i`, or -1 where it breaks. */
  const stringEnd = (i: number): number => {
    const stops = STRING_STOPS[code[i]];
    stops.lastIndex = i + 1;
    for (let m; (m = stops.exec(code)); ) {
      if (m[0] === code[i]) return m.index + 1;
      if (m[0] !== "\\") return -1;
      stops.lastIndex = m.index + (code.startsWith("\r\n", m.index + 1) ? 3 : 2);
    }
    return -1;
  };
  const templateEnd = (i: number): number => {
    TEMPLATE_STOPS.lastIndex = i;
    for (let m; (m = TEMPLATE_STOPS.exec(code)); ) {
      if (m[0] === "`") return m.index + 1;
      if (m[0] === "\\") TEMPLATE_STOPS.lastIndex = m.index + 2;
      else if (code[m.index + 1] === "{") {
        stack.push(SUBSTITUTION);
        return m.index + 2;
      }
    }
    return -1;
  };
  const regexEnd = (i: number): number => {
    let inClass = false;
    for (let j = i + 1; j < code.length; j++) {
      const c = code[j];
      if (c === "\\") j++;
      else if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) {
        while (WORD_CHAR.test(code[j + 1] ?? "")) j++;
        return j + 1;
      }
      else if (c === "\n" || c === "\r" || c === "\u2028" || c === "\u2029") return -1;
    }
    return -1;
  };

  /** A call name ending at `i`: called with a literal, used as a template tag, or renamed by an import. */
  const calledWithLiteral = (i: number): boolean => {
    let k = skipGap(i);
    if (code.startsWith("?.", k)) k = skipGap(k + 2);
    if (code[k] === "`") return true;
    if (code.startsWith("as", k) && !WORD_CHAR.test(code[k + 2] ?? "")) return true;
    if (code[k] !== "(") return false;
    do k = skipGap(k + 1);
    while (code[k] === "(");
    return code[k] === '"' || code[k] === "'" || code[k] === "`" || code[k] === "{";
  };

  stops.lastIndex = code.startsWith("#!") ? code.search(LINE_END) >>> 0 : 0;
  for (let m; (m = stops.exec(code)); ) {
    const i = m.index;
    let next = i + 1;
    switch (m[0]) {
      case '"':
      case "'":
        next = stringEnd(i);
        break;
      case "`":
        next = templateEnd(i + 1);
        break;
      case "(":
        stack.push(i);
        break;
      case ")":
        openParen = stack.pop() ?? -1;
        if (openParen < 0) return true;
        closeParen = i;
        break;
      case "{":
        stack.push(BRACE);
        break;
      case "}": {
        const open = stack.pop();
        if (open === SUBSTITUTION) next = templateEnd(i + 1);
        else if (open !== BRACE) return true;
        break;
      }
      case "/":
        if (code[i + 1] === "/") {
          LINE_END.lastIndex = i;
          next = LINE_END.exec(code)?.index ?? code.length;
          comments.set(next, i);
        } else if (code[i + 1] === "*") {
          const end = code.indexOf("*/", i + 2);
          next = end < 0 ? -1 : end + 2;
          comments.set(next, i);
        } else if (startsRegex(i)) {
          next = regexEnd(i);
        }
        break;
      default:
        if (calledWithLiteral(i + m[0].length)) return true;
        next = i + m[0].length;
    }
    if (next < 0) return true;
    stops.lastIndex = next;
  }
  return stack.length > 0;
}
