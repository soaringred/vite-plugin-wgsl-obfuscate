import type { Token } from "@/wgsl/tokenizer";
import { tokenize, attributeName, isGap } from "@/wgsl/tokenizer";
import { positionAt } from "@/wgsl/position";
import {
  RESERVED,
  KEYWORDS,
  STATEMENT_KEYWORDS,
  PUNCTUATION,
  DIRECTIVES,
  attributeArguments,
} from "@/wgsl/grammar";

export { positionAt } from "@/wgsl/position";

// Structural checks before resolving catch common unsupported constructs and malformed declarations.
// This is not complete WGSL syntax or type validation.

/** Thrown when an input fails the structural checks. */
export class ObfuscateError extends Error {
  constructor(
    /** File id, as passed to `obfuscateProject` ("source" for `obfuscate`). */
    readonly file: string,
    /** 1-based line of the offending text. */
    readonly line: number,
    /** 1-based column, in UTF-16 code units. */
    readonly column: number,
    readonly reason: string,
  ) {
    super(`Cannot obfuscate ${file}:${line}:${column}: ${reason}`);
    this.name = "ObfuscateError";
  }
}

/** Check the structure of `source`, or throw an `ObfuscateError`. Does not fully validate WGSL. */
export function validate(source: string, file = "source"): void {
  validateTokens(file, source, tokenize(source));
}

/** `validate` on the `tokenize()` output of `source`. */
export function validateTokens(file: string, source: string, tokens: Token[]): void {
  new Validator(file, source, tokens).run();
}

const OPENING: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
const CLOSING: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

/** Module-scope declarations that run up to a `;`. */
const SEMICOLON_ITEMS = new Set(["const", "override", "var", "alias", "const_assert"]);

/** Statements in a function body that are declarations running up to a `;`. */
const LOCAL_SEMICOLON_ITEMS = new Set(["let", "var", "const", "const_assert"]);

/** Why a character is not WGSL, with a hint for the common cases. */
function characterReason(char: string, next: string | undefined): string {
  switch (char) {
    case "#":
      return "`#` is not WGSL. Preprocessor directives such as `#include` and `#define` must be expanded before the shader is obfuscated";
    case "$":
      return next === "{"
        ? "`${` is not WGSL. A template placeholder must be filled in before the shader is obfuscated"
        : "`$` is not WGSL";
    case '"':
    case "'":
      return `\`${char}\` is not WGSL: WGSL has no string literals`;
    case "`":
      return "a backtick is not WGSL: WGSL has no string literals";
    case "?":
      return "`?` is not WGSL: WGSL has no `?:` operator (use `select(ifFalse, ifTrue, condition)`)";
    case "\\":
      return "`\\` is not WGSL";
    case "﻿":
      return "the byte order mark U+FEFF is not WGSL: save the file without one";
    default: {
      const code = char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");
      return `the character U+${code} is not WGSL`;
    }
  }
}

/** True when a block comment's text closes every `/*` it opens. */
function blockCommentClosed(text: string): boolean {
  let depth = 1;
  let i = 2;
  while (i < text.length) {
    if (text.startsWith("/*", i)) {
      depth++;
      i += 2;
    } else if (text.startsWith("*/", i)) {
      depth--;
      i += 2;
      if (depth === 0) return i === text.length;
    } else {
      i++;
    }
  }
  return false;
}

class Validator {
  /** Significant tokens: everything but whitespace and comments. */
  private readonly s: Token[];
  /** Index of the matching bracket for every `(`, `)`, `[`, `]`, `{`, `}`; -1 otherwise. */
  private readonly match: number[];
  /** Directive ranges [first, last], whose names are all context. */
  private readonly directives: [number, number][] = [];

  constructor(
    private readonly file: string,
    private readonly source: string,
    private readonly tokens: Token[],
  ) {
    this.s = tokens.filter((t) => !isGap(t));
    this.match = new Array(this.s.length).fill(-1);
  }

  run(): void {
    this.characters();
    this.brackets();
    this.moduleScope();
    this.reservedWords();
  }

  private fail(offset: number, reason: string): never {
    const { line, column } = positionAt(this.source, offset);
    throw new ObfuscateError(this.file, line, column, `${reason}.`);
  }

  /** Fail at significant token `k`, or at the end of the source past the last token. */
  private failAt(k: number, reason: string): never {
    const token = this.s[k];
    return this.fail(token ? token.start : (this.s[this.s.length - 1]?.end ?? 0), reason);
  }

  private isOp(k: number, value: string): boolean {
    const t = this.s[k];
    return t !== undefined && t.type === "op" && t.value === value;
  }

  private isIdent(k: number): boolean {
    return this.s[k]?.type === "ident";
  }

  /** Text of token `k` for a message, or "the end of the file". */
  private describe(k: number): string {
    const t = this.s[k];
    return t === undefined ? "the end of the file" : `\`${t.value}\``;
  }

  // ── Characters and comments ─────────────────────────────────────

  private characters(): void {
    for (const t of this.tokens) {
      if (t.type === "comment" && t.value.startsWith("/*") && !blockCommentClosed(t.value)) {
        this.fail(t.start, "unterminated block comment: this `/*` is never closed");
      } else if (t.type === "op" && !PUNCTUATION.has(t.value)) {
        this.fail(t.start, characterReason(t.value, this.source[t.end]));
      } else if (t.type === "attribute" && attributeName(t) === "") {
        this.fail(t.start, "`@` is not followed by an attribute name");
      }
    }
  }

  // ── Brackets ────────────────────────────────────────────────────

  private brackets(): void {
    const open: number[] = [];
    this.s.forEach((t, k) => {
      if (t.type !== "op") return;
      if (OPENING[t.value]) {
        open.push(k);
      } else if (CLOSING[t.value]) {
        const top = open.pop();
        if (top === undefined) this.failAt(k, `\`${t.value}\` has no matching \`${CLOSING[t.value]}\``);
        if (this.s[top].value !== CLOSING[t.value]) {
          const { line, column } = positionAt(this.source, this.s[top].start);
          this.failAt(k, `\`${t.value}\` does not match the \`${this.s[top].value}\` at ${line}:${column}`);
        }
        this.match[top] = k;
        this.match[k] = top;
      }
    });
    const unclosed = open.pop();
    if (unclosed !== undefined) this.failAt(unclosed, `this \`${this.s[unclosed].value}\` is never closed`);
  }

  // ── Module-scope items ──────────────────────────────────────────

  /** Index after the attribute at `k` and its argument list. */
  private afterAttribute(k: number): number {
    return this.isOp(k + 1, "(") ? this.match[k + 1] + 1 : k + 1;
  }

  /** Module-scope items. Attributes before `;` or the end of the file are not WGSL, but naga and the resolver ignore them. */
  private moduleScope(): void {
    let k = 0;
    while (k < this.s.length) {
      const t = this.s[k];
      if (t.type === "attribute") {
        k = this.afterAttribute(k);
        continue;
      }
      if (t.type === "op" && t.value === ";") {
        k++;
        continue;
      }
      if (t.type === "ident" && DIRECTIVES.has(t.value)) {
        const end = this.semicolonItem(k, `\`${t.value}\` directive`);
        this.directives.push([k, end]);
        k = end + 1;
      } else if (t.type === "ident" && SEMICOLON_ITEMS.has(t.value)) {
        k = this.semicolonItem(k, t.value === "const_assert" ? "`const_assert`" : `\`${t.value}\` declaration`) + 1;
      } else if (t.type === "ident" && t.value === "struct") {
        k = this.struct(k);
      } else if (t.type === "ident" && t.value === "fn") {
        k = this.function(k);
      } else {
        this.failAt(
          k,
          `expected a module-scope declaration (\`fn\`, \`const\`, \`override\`, \`var\`, \`struct\`, \`alias\`, ` +
            `\`const_assert\`) or a directive, found \`${t.value}\``,
        );
      }
    }
  }

  /** A directive or declaration from its keyword at `k` to its `;`, whose index it returns.
   * Anything that can only start the next item or statement means the `;` is missing. */
  private semicolonItem(k: number, what: string): number {
    for (let j = k + 1; j < this.s.length; j++) {
      const t = this.s[j];
      if (t.type === "op" && t.value === ";") return j;
      const next =
        (t.type === "ident" && STATEMENT_KEYWORDS.has(t.value)) ||
        t.type === "attribute" ||
        (t.type === "op" && (t.value === "{" || t.value === "}"));
      if (next) this.failAt(j, `expected \`;\` to end the ${what} before \`${t.value}\``);
    }
    return this.failAt(this.s.length, `expected \`;\` to end the ${what} at the end of the file`);
  }

  /** `struct Name { ... }` at `k`. Returns the index after the closing brace. */
  private struct(k: number): number {
    if (!this.isIdent(k + 1) || KEYWORDS.has(this.s[k + 1].value)) {
      this.failAt(k + 1, `expected a struct name after \`struct\`, found ${this.describe(k + 1)}`);
    }
    if (!this.isOp(k + 2, "{")) {
      this.failAt(k + 2, `expected \`{\` after \`struct ${this.s[k + 1].value}\`, found ${this.describe(k + 2)}`);
    }
    return this.match[k + 2] + 1;
  }

  /** `fn name(params) [-> [attributes] type] [attributes] { body }` at `k`. Returns the index after the body. */
  private function(k: number): number {
    if (!this.isIdent(k + 1) || KEYWORDS.has(this.s[k + 1].value)) {
      this.failAt(k + 1, `expected a function name after \`fn\`, found ${this.describe(k + 1)}`);
    }
    const name = this.s[k + 1].value;
    if (!this.isOp(k + 2, "(")) {
      this.failAt(k + 2, `expected \`(\` after \`fn ${name}\`, found ${this.describe(k + 2)}`);
    }

    let body = this.match[k + 2] + 1;
    if (this.isOp(body, "->")) {
      let q = body + 1;
      while (this.s[q]?.type === "attribute") q = this.afterAttribute(q);
      if (!this.isIdent(q)) this.failAt(q, `expected the return type of \`fn ${name}\` after \`->\`, found ${this.describe(q)}`);
      while (q < this.s.length && !this.isOp(q, "{")) {
        const t = this.s[q];
        if (this.isOp(q, "(") || this.isOp(q, "[")) {
          q = this.match[q] + 1;
          continue;
        }
        const end =
          (t.type === "op" && (t.value === ";" || t.value === "}")) ||
          (t.type === "ident" && STATEMENT_KEYWORDS.has(t.value)) ||
          t.type === "attribute";
        if (end) break;
        q++;
      }
      while (this.s[q]?.type === "attribute") q = this.afterAttribute(q);
      if (!this.isOp(q, "{")) this.failAt(q, `expected the body \`{\` of \`fn ${name}\`, found ${this.describe(q)}`);
      body = q;
    } else {
      while (this.s[body]?.type === "attribute") body = this.afterAttribute(body);
      if (!this.isOp(body, "{")) {
        this.failAt(body, `expected \`->\` or the body \`{\` of \`fn ${name}\`, found ${this.describe(body)}`);
      }
    }
    this.localDeclarations(body);
    return this.match[body] + 1;
  }

  /** In the body at `body`, every `let`, `var`, `const` and `const_assert` must reach its `;`. */
  private localDeclarations(body: number): void {
    const end = this.match[body];
    for (let j = body + 1; j < end; j++) {
      const t = this.s[j];
      if (t.type !== "ident" || !LOCAL_SEMICOLON_ITEMS.has(t.value)) continue;
      j = this.semicolonItem(j, t.value === "const_assert" ? "`const_assert`" : `\`${t.value}\` declaration`);
    }
  }

  // ── Reserved words ──────────────────────────────────────────────

  /** A reserved word that is not a keyword is newer WGSL syntax or an invalid name. Exempt: directives,
   * non-expression attribute arguments, names after `.`, and the `<...>` list after `var`. */
  private reservedWords(): void {
    const directiveEnd = new Map(this.directives);
    let k = 0;
    while (k < this.s.length) {
      const t = this.s[k];
      const skipTo = directiveEnd.get(k);
      if (skipTo !== undefined) {
        k = skipTo + 1;
        continue;
      }
      if (t.type === "attribute") {
        k = attributeArguments(attributeName(t)) === "expression" ? k + 1 : this.afterAttribute(k);
        continue;
      }
      if (t.type === "ident") {
        if (this.isOp(k - 1, ".")) {
          k++;
          continue;
        }
        if (t.value === "var" && this.isOp(k + 1, "<")) {
          k += 2;
          while (k < this.s.length && !this.s[k].value.startsWith(">")) k++;
          continue;
        }
        if (RESERVED.has(t.value) && !KEYWORDS.has(t.value)) {
          this.failAt(k, `\`${t.value}\` is a reserved word: WGSL does not allow it as a name, and the plugin does not know syntax that uses it`);
        }
      }
      k++;
    }
  }
}
