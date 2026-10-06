import type { SymbolInfo } from "@/analysis/resolver";
import { RESERVED } from "@/wgsl/grammar";
import { DeclaredTypes } from "@/analysis/proof/declared-types";
import { ASSIGN_FIRST, merge, unknown } from "@/analysis/proof/proof-types";
import type { ProofType, Unproven } from "@/analysis/proof/proof-types";

// Member proof: `base.m` is proven when declared types alone show that `base` is a project struct
// with a field `m`. It may miss a truth but must never claim a falsehood, so any form it does not
// recognise is unknown. This file reads expressions; proof/ holds the declarations and syntax.

export type { Unproven, ProofType, ProofFile, ProjectDeclaration } from "@/analysis/proof/proof-types";

/** The prefix a declaration without a type puts before the reason of its initializer. */
const INFERRED = /^`[^`]*` has no explicit type, and /;

/** Symbol kinds that are values, with a declared or inferred type. */
const VALUE_KINDS: ReadonlySet<SymbolInfo["kind"]> = new Set([
  "param", "let", "local-var", "local-const", "var", "const", "override",
]);

export class MemberProof extends DeclaredTypes {
  private readonly valueTypes = new Map<string, ProofType>();
  /** Type of [a, p) of an expression whose steps have been read, by "file:a:p". */
  private readonly prefixTypes = new Map<string, ProofType>();
  /** Files whose value types have been found in declaration order. */
  private readonly warmed = new Set<number>();

  /** Check the access whose member name is significant token `k` of file `f`: null when proven, else why not. */
  check(f: number, k: number): Unproven | null {
    this.warm(f);
    const name = this.text(f, k);
    if (!this.isOp(f, k - 1, ".")) return { reason: `\`${name}\` does not follow a \`.\``, action: ASSIGN_FIRST };
    const start = this.chainStart(f, k - 2);
    if (start < 0) {
      return { reason: `the expression before \`.${name}\` is not a form the proof covers`, action: ASSIGN_FIRST };
    }
    const base = this.typeOfExpr(f, start, k - 1);
    const struct = this.structOf(base, name);
    return struct.kind === "unknown" ? struct.why : null;
  }

  /** Type every value of file `f` in declaration order, so a long `let` chain is not read by deep recursion. */
  private warm(f: number): void {
    if (this.warmed.has(f)) return;
    this.warmed.add(f);
    for (const symbol of this.files[f].analysis.symbols) {
      if (VALUE_KINDS.has(symbol.kind)) this.valueType(f, symbol);
    }
  }

  /** Type of exactly [a, b): optional `&` and `*`, a primary, then `.name` and `[index]` steps. */
  private typeOfExpr(f: number, a: number, b: number): ProofType {
    return this.nested(() => this.findTypeOfExpr(f, a, b));
  }

  private findTypeOfExpr(f: number, a: number, b: number): ProofType {
    const notCovered = () => unknown("the expression is not a form the proof covers", ASSIGN_FIRST);
    if (a >= b) return notCovered();

    if (this.isOp(f, a, "&")) {
      const inner = this.typeOfExpr(f, a + 1, b);
      return inner.kind === "unknown" ? inner : { kind: "ptr", pointee: inner };
    }
    if (this.isOp(f, a, "*")) {
      const deref = (inner: ProofType): ProofType =>
        inner.kind === "union"
          ? merge(inner.options.map(deref))
          : inner.kind === "ptr"
            ? inner.pointee
            : inner.kind === "unknown"
              ? inner
              : notCovered();
      return deref(this.typeOfExpr(f, a + 1, b));
    }

    let type: ProofType;
    let p: number;
    if (this.isOp(f, a, "(")) {
      const close = this.match(f, a);
      if (close < 0 || close >= b) return notCovered();
      type = this.typeOfExpr(f, a + 1, close);
      p = close + 1;
    } else if (this.isIdent(f, a) && !RESERVED.has(this.text(f, a))) {
      if (this.isOp(f, a + 1, "(")) {
        const close = this.match(f, a + 1);
        if (close < 0 || close >= b) return notCovered();
        type = this.typeOfCall(f, a);
        p = close + 1;
      } else if (this.isOp(f, a + 1, "<")) {
        const gt = this.templateClose(f, a + 1);
        if (gt < 0 || !this.isOp(f, gt + 1, "(")) return notCovered();
        const close = this.match(f, gt + 1);
        if (close < 0 || close >= b) return notCovered();
        type = this.typeOfRange(f, [a, gt + 1]);
        if (type.kind === "unknown") type = unknown(`the result of \`${this.text(f, a)}<...>(...)\` is not a struct`, ASSIGN_FIRST);
        p = close + 1;
      } else {
        type = this.typeOfIdentifier(f, a);
        p = a + 1;
      }
    } else {
      return notCovered();
    }

    // Every access in a chain asks again, so step types are kept and a later ask resumes from the longest known prefix
    const known = this.knownPrefix(f, a, p, b);
    if (known) ({ type, p } = known);
    while (p < b) {
      if (this.isOp(f, p, ".") && this.isIdent(f, p + 1)) {
        type = this.fieldType(type, this.text(f, p + 1));
        p += 2;
      } else if (this.isOp(f, p, "[")) {
        const close = this.match(f, p);
        if (close < 0 || close >= b) return notCovered();
        type = this.elementType(type);
        p = close + 1;
      } else {
        return notCovered();
      }
      this.prefixTypes.set(`${f}:${a}:${p}`, type);
    }
    return type;
  }

  /** The longest prefix [a, e) of the steps in [start, b) whose type is already known. */
  private knownPrefix(f: number, a: number, start: number, b: number): { type: ProofType; p: number } | null {
    for (let e = b; e > start; ) {
      const type = this.prefixTypes.get(`${f}:${a}:${e}`);
      if (type) return { type, p: e };
      if (this.isIdent(f, e - 1) && this.isOp(f, e - 2, ".")) e -= 2;
      else if (this.isOp(f, e - 1, "]")) e = this.match(f, e - 1);
      else return null;
    }
    return null;
  }

  /** Type of the call whose callee is the identifier at `k`. */
  private typeOfCall(f: number, k: number): ProofType {
    const name = this.text(f, k);
    // Without a template list it is the builtin only if no project file declares it
    const builtin = this.files[f].analysis.classes[k] === "unresolved" && !this.declarations.has(name);
    if (builtin && name === "array") return this.arrayConstructorType(f, k);
    if (builtin && name === "workgroupUniformLoad") return this.loadType(f, k);

    const target = this.declarationsOf(f, k);
    if ("why" in target) {
      return unknown(`the result of \`${name}(...)\` is not proven: ${target.why}`, target.action ?? ASSIGN_FIRST);
    }
    return this.mergeDeclarations(
      name,
      target,
      target.map(({ file, symbol }) => {
        if (symbol.kind === "fn") {
          return symbol.type
            ? this.typeOfRange(file, symbol.type)
            : unknown(`\`${name}\` has no return type`, ASSIGN_FIRST);
        }
        if (symbol.kind === "struct") return { kind: "struct", file, symbol: symbol.id };
        if (symbol.kind === "alias") return this.aliasType(file, symbol);
        return unknown(`\`${name}\` is not a function or a type`, ASSIGN_FIRST);
      }),
    );
  }

  /** Argument ranges of the call whose callee is at `k`, split at top-level commas. */
  private callArguments(f: number, k: number): [number, number][] {
    const close = this.match(f, k + 1);
    const { closeOf } = this.files[f].analysis.templates;
    const args: [number, number][] = [];
    let start = k + 2;
    for (let q = start; q < close; q++) {
      if (this.isOp(f, q, "(") || this.isOp(f, q, "[")) {
        q = this.match(f, q);
      } else if (closeOf.has(q)) {
        q = closeOf.get(q)!;
      } else if (this.isOp(f, q, ",")) {
        args.push([start, q]);
        start = q + 1;
      }
    }
    if (start < close) args.push([start, close]);
    return args;
  }

  /** `array(e1, ...)`. No conversion applies to a struct or an array, so one argument of proven type is enough. */
  private arrayConstructorType(f: number, k: number): ProofType {
    const known = this.callArguments(f, k)
      .map(([a, b]) => this.typeOfExpr(f, a, b))
      .filter((type) => type.kind !== "unknown");
    if (known.length === 0) {
      return unknown("the element type of `array(...)` is not proven", "write the element type: `array<S, N>(...)`");
    }
    return { kind: "array", element: merge(known) };
  }

  /** `workgroupUniformLoad(p)`: the type that `p` points to. */
  private loadType(f: number, k: number): ProofType {
    const [first] = this.callArguments(f, k);
    if (!first) return unknown("`workgroupUniformLoad()` has no argument", ASSIGN_FIRST);
    const pointee = (type: ProofType): ProofType =>
      type.kind === "union"
        ? merge(type.options.map(pointee))
        : type.kind === "ptr"
          ? type.pointee
          : type.kind === "unknown"
            ? unknown(`the argument of \`workgroupUniformLoad\` is not proven: ${type.why.reason}`, type.why.action)
            : unknown("the argument of `workgroupUniformLoad` is not a pointer", ASSIGN_FIRST);
    return pointee(this.typeOfExpr(f, first[0], first[1]));
  }

  /** Type of the value that the identifier at `k` names. */
  private typeOfIdentifier(f: number, k: number): ProofType {
    const target = this.declarationsOf(f, k);
    const name = this.text(f, k);
    if ("why" in target) {
      return unknown(
        `the type of \`${name}\` is not proven: ${target.why}`,
        target.action ?? `declare \`${name}\` in a project file with an explicit type`,
      );
    }
    return this.mergeDeclarations(
      name,
      target,
      target.map(({ file, symbol }) => this.valueType(file, symbol)),
    );
  }

  /** Declared or inferred type of a parameter, `var`, `let`, `const` or `override`. */
  private valueType(f: number, symbol: SymbolInfo): ProofType {
    const key = `${f}:${symbol.id}`;
    const known = this.valueTypes.get(key);
    if (known) return known;
    if (!VALUE_KINDS.has(symbol.kind)) {
      return unknown(`\`${symbol.name}\` is not a value`, ASSIGN_FIRST);
    }
    return this.nested(() => this.findValueType(f, symbol, key));
  }

  private findValueType(f: number, symbol: SymbolInfo, key: string): ProofType {
    // A cycle (invalid WGSL) ends as unknown
    const giveType = `give \`${symbol.name}\` an explicit type`;
    this.valueTypes.set(key, unknown(`the type of \`${symbol.name}\` depends on itself`, giveType));
    let type: ProofType;
    if (symbol.type) {
      type = this.typeOfRange(f, symbol.type);
    } else if (symbol.init) {
      type = this.typeOfExpr(f, symbol.init[0], symbol.init[1]);
      if (type.kind === "unknown") {
        // An explicit type helps unless the initializer's own type is undeclared.
        // A chain of these reports only the last declaration and the first cause.
        const action = type.why.action === ASSIGN_FIRST ? giveType : type.why.action;
        type = unknown(`\`${symbol.name}\` has no explicit type, and ${type.why.reason.replace(INFERRED, "")}`, action);
      }
    } else {
      type = unknown(`\`${symbol.name}\` has no type`, giveType);
    }
    this.valueTypes.set(key, type);
    return type;
  }
}
