// Random, valid WGSL over a typed model: every name means what the model says. Names come
// from a small pool, so one name plays many roles. Module items and statements are here.

import { BOOL, COMMON_FIELD_NAMES, F32, FIELD_NAMES, I32, U32, Random } from "@tests/helpers/random/model";
import type { AliasDecl, Decl, FnDecl, StructDecl, Ty, ValueDecl } from "@tests/helpers/random/model";
import { Expressions } from "@tests/helpers/random/expressions";

export interface Program {
  /**
   * Declarations outside the project, linked with it at runtime. Their fields share
   * names with the project's, so the member proof must tell them apart.
   */
  external: string;
  /** The project as one shader. */
  source: string;
  /** The same project in several files, each module-scope item in one of them. */
  files: Record<string, string>;
}

/** Generate one random program; disable statement attributes when only Naga is available. */
export function generate(seed: number, { statementAttributes = true } = {}): Program {
  return new Generator(new Random(seed), statementAttributes).program();
}

class Generator extends Expressions {
  private items: string[] = [];
  private depth = 0;

  constructor(r: Random, private readonly statementAttributes: boolean) {
    super(r);
  }

  // ── Module ────────────────────────────────────────────────────────

  program(): Program {
    // Outside code first, so that it can only use outside declarations
    if (this.r.chance(0.7)) this.declarations(3);
    const external = this.items.join("\n");
    this.items = ["@group(0) @binding(0) var<storage, read_write> out: array<f32>;"];
    this.declarations(4);
    this.entryPoint();

    const source = this.items.join("\n");
    const files: Record<string, string> = {};
    this.items.forEach((item, i) => {
      const id = `part-${i % 3}.wgsl`;
      files[id] = files[id] === undefined ? item : `${files[id]}\n${item}`;
    });
    return { external, source, files };
  }

  /** Module-scope declarations: up to `most` structs, and fewer of the rest. */
  private declarations(most: number): void {
    for (let i = this.r.int(most); i > 0; i--) this.struct();
    for (let i = this.r.int(3); i > 0; i--) this.moduleConst();
    if (this.structs.length > 0 && this.r.chance(0.5)) this.alias();
    for (let i = this.r.int(3); i > 0; i--) this.privateVar();
    for (let i = 1 + this.r.int(most - 1); i > 0; i--) this.fn();
  }

  private struct(): void {
    const decl: StructDecl = { kind: "struct", name: this.freshModuleName(), fields: [] };
    const used = new Set<string>();
    for (let i = 1 + this.r.int(3); i > 0; i--) {
      const pool = this.r.chance(0.7) ? COMMON_FIELD_NAMES : FIELD_NAMES;
      let name = this.r.pick(pool);
      while (used.has(name)) name = this.r.pick(FIELD_NAMES);
      used.add(name);
      decl.fields.push({ name, ty: this.randomType(1) });
    }
    this.moduleScope.set(decl.name, decl);
    this.structs.push(decl);
    const fields = decl.fields.map((f) => `${this.comment()}${f.name}: ${this.typeName(f.ty)}`).join(", ");
    this.items.push(`struct ${decl.name} { ${fields}${this.r.chance(0.3) ? "," : ""} }`);
  }

  private alias(): void {
    const decl: AliasDecl = { kind: "alias", name: this.freshModuleName(), target: this.r.pick(this.structs) };
    this.items.push(`alias ${decl.name} = ${decl.target.name};`);
    this.moduleScope.set(decl.name, decl);
  }

  private moduleConst(): void {
    const ty = this.r.pick([F32, I32, U32]);
    const decl: ValueDecl = { kind: "value", name: this.freshModuleName(), ty, mutable: false, local: false };
    const typed = this.r.chance(0.5) ? `: ${this.typeName(ty)}` : "";
    this.items.push(`const ${decl.name}${typed} = ${this.literal(ty, true)};`);
    this.moduleScope.set(decl.name, decl);
  }

  private privateVar(): void {
    const ty = this.randomType();
    const decl: ValueDecl = { kind: "value", name: this.freshModuleName(), ty, mutable: true, local: false };
    this.items.push(`var<private> ${decl.name}: ${this.typeName(ty)};`);
    this.moduleScope.set(decl.name, decl);
  }

  private fn(): void {
    const decl: FnDecl = { kind: "fn", name: this.freshModuleName(), params: [], ret: this.randomType() };
    // The header's types are read at module scope, so they are written first
    this.scopes = [];
    const written: string[] = [];
    const params = new Map<string, Decl>();
    for (let i = this.r.int(4); i > 0; i--) {
      const pointer = this.structs.length > 0 && this.r.chance(0.2);
      const ty = pointer ? ({ kind: "struct", decl: this.r.pick(this.structs) } as Ty) : this.randomType();
      this.scopes = [params];
      // A pointer cannot stand in for the struct it points to, so it never shadows one
      const name = this.freshLocalName(pointer ? F32 : ty);
      this.scopes = [];
      const param: ValueDecl = { kind: "value", name, ty, mutable: false, local: true, pointer };
      written.push(`${name}: ${pointer ? `ptr<function, ${this.typeName(ty)}>` : this.typeName(ty)}`);
      decl.params.push(param);
      params.set(name, param);
    }
    const header = `fn ${decl.name}(${written.join(", ")}) -> ${this.typeName(decl.ret)}`;
    this.moduleScope.set(decl.name, decl);
    this.scopes = [params];
    const body = this.block(3, () => `return ${this.expr(decl.ret)};`, true);
    this.items.push(`${header} ${body}`);
    this.fns.push(decl);
    this.scopes = [];
  }

  private entryPoint(): void {
    this.scopes = [new Map()];
    const statements: string[] = [];
    for (let i = 0; i < 1 + this.r.int(3); i++) statements.push(`out[${i}] = ${this.expr(F32)};`);
    this.items.push(`@compute @workgroup_size(1) fn main() { ${statements.join(" ")} }`);
    this.scopes = [];
  }

  // ── Statements ────────────────────────────────────────────────────

  /**
   * `{ statements }` in a new scope, ending with `last()`. A function body
   * shares the scope of the parameters: a local there cannot redeclare one.
   */
  private block(count: number, last?: () => string, functionBody = false): string {
    if (!functionBody) this.scopes.push(new Map());
    const out: string[] = [];
    for (let i = this.r.int(count + 1); i > 0; i--) out.push(this.statement());
    if (last) out.push(last());
    if (!functionBody) this.scopes.pop();
    return `{ ${out.join(this.r.chance(0.2) ? "\n" : " ")} }`;
  }

  private statement(): string {
    this.depth++;
    try {
      const roll = this.r.int(this.depth > 2 ? 6 : 12);
      if (roll < 3) return this.declaration();
      if (roll < 5) return this.assignment() ?? this.declaration();
      if (roll === 5) return `_ = ${this.expr(this.randomType())};`;
      // Statements that may carry attributes (Tint; naga rejects them)
      // Draw even when disabled, so each seed otherwise produces the same program.
      const attribute = this.r.chance(0.05) && this.statementAttributes ? "@diagnostic(off, derivative_uniformity) " : "";
      if (roll === 6) return `${attribute}if ${this.condition()} ${this.block(2)} else ${this.block(2)}`;
      if (roll === 7) return `${attribute}${this.forLoop()}`;
      if (roll === 8) return `${attribute}${this.block(2)}`;
      if (roll === 9) return `${attribute}${this.loop()}`;
      if (roll === 10) return `${attribute}${this.whileLoop()}`;
      return `${attribute}${this.switchStatement()}`;
    } finally {
      this.depth--;
    }
  }

  private declaration(): string {
    const ty = this.randomType();
    if (!this.writable(ty)) return `_ = ${this.expr(ty)};`;
    const init = this.expr(ty);
    const name = this.freshLocalName(ty);
    const keyword = this.r.pick(["let", "var", "const"] as const);
    // A `const` needs a constant initializer: only scalar literals here
    if (keyword === "const") {
      if (ty.kind !== "scalar" || ty.name === "bool") return `_ = ${init};`;
      const typeName = this.typeName(ty);
      this.declareLocal({ kind: "value", name, ty, mutable: false, local: true });
      return `const ${name}: ${typeName} = ${this.literal(ty, true)};`;
    }
    const typed = this.r.chance(0.5) ? `: ${this.typeName(ty)}` : "";
    // A whole initializer may be an unparenthesised comparison: its `;` ends any template list
    const value = ty.kind === "scalar" && ty.name === "bool" && this.r.chance(0.5) ? this.condition() : init;
    this.declareLocal({ kind: "value", name, ty, mutable: keyword === "var", local: true });
    return `${keyword} ${name}${typed}${this.r.chance(0.2) ? "" : " "}= ${value};`;
  }

  private assignment(): string | undefined {
    const targets = this.values().filter((d) => d.mutable || d.pointer);
    if (targets.length === 0) return undefined;
    const target = this.r.pick(targets);
    const [path, ty] = this.pathInto(target.pointer ? `(*${target.name})` : target.name, target.ty);
    const numeric = ty.kind === "scalar" && ty.name !== "bool";
    if (numeric && this.r.chance(0.3)) return `${path} ${this.r.pick(["+=", "-=", "*="])} ${this.expr(ty)};`;
    if (numeric && ty.kind === "scalar" && ty.name !== "f32" && this.r.chance(0.2)) return `${path}${this.r.pick(["++", "--"])};`;
    if (ty.kind === "scalar" && ty.name === "u32" && this.r.chance(0.2)) return `${path} ${this.r.pick([">>=", "<<="])} 1u;`;
    return `${path} = ${this.expr(ty)};`;
  }

  /**
   * A condition of `if`, `while` or `break if`: a comparison may stand
   * unparenthesised, because the `{` or `;` after it ends any template list.
   */
  private condition(): string {
    return this.r.chance(0.3) ? `${this.expr(F32, 2)} ${this.r.pick(["<", ">", "<=", ">="])} ${this.expr(F32, 2)}` : this.expr(BOOL);
  }

  /** `while` whose body runs once. */
  private whileLoop(): string {
    const condition = this.condition();
    this.scopes.push(new Map());
    const body = this.statement();
    this.scopes.pop();
    return `while ${condition} { ${body} break; }`;
  }

  /** `loop` with a `continuing` block that ends in `break if`. */
  private loop(): string {
    this.scopes.push(new Map());
    const body: string[] = [];
    for (let i = this.r.int(2); i >= 0; i--) body.push(this.statement());
    const continuing = `continuing { ${this.r.chance(0.5) ? this.statement() : ""} break if ${this.condition()}; }`;
    this.scopes.pop();
    return `loop { ${body.join(" ")} ${continuing} }`;
  }

  private forLoop(): string {
    this.scopes.push(new Map());
    const name = this.freshLocalName(I32);
    this.declareLocal({ kind: "value", name, ty: I32, mutable: true, local: true });
    const loop = `for (var ${name} = 0; (${name} < 3); ${name}++) ${this.block(2)}`;
    this.scopes.pop();
    return loop;
  }

  private switchStatement(): string {
    return `switch ${this.expr(I32)} { case 0: ${this.block(1)} case 1, 2: ${this.block(1)} default: ${this.block(1)} }`;
  }
}
