import { BOOL, F32, I32, U32, VEC3, same } from "@tests/helpers/random/model";
import type { Decl, Ty, ValueDecl } from "@tests/helpers/random/model";
import { Scopes } from "@tests/helpers/random/scopes";

// Expressions of a given type, in the forms the member proof reads.

export class Expressions extends Scopes {
  /** Values that can be read here: parameters, locals, module consts and vars. */
  protected values(): ValueDecl[] {
    const all = new Map<string, Decl>();
    for (const [name, decl] of this.moduleScope) all.set(name, decl);
    for (const scope of this.scopes) for (const [name, decl] of scope) all.set(name, decl);
    return [...all.values()].filter((d): d is ValueDecl => d.kind === "value");
  }

  /** A random `.field` and `[index]` path from a value of type `ty`. */
  protected pathInto(base: string, ty: Ty): [string, Ty] {
    let path = base;
    for (let i = 0; i < 3; i++) {
      if (ty.kind === "struct" && this.r.chance(0.6)) {
        const field = this.r.pick(ty.decl.fields);
        path = `${path}${this.comment()}.${field.name}`;
        ty = field.ty;
      } else if (ty.kind === "array" && this.r.chance(0.6)) {
        path = `${path}[${this.r.int(ty.length)}]`;
        ty = ty.element;
      } else {
        break;
      }
    }
    return [path, ty];
  }

  protected literal(ty: Ty, constant = false): string {
    if (ty.kind !== "scalar") return this.expr(ty);
    switch (ty.name) {
      case "f32":
        return this.r.pick(["1.5", "2.0", "0.25", "3.", ".5", "1e1", "0x1p-2", "4f"]);
      case "i32":
        return this.r.pick(["0", "1", "2", "7i", "9", "0x3"]);
      case "u32":
        return this.r.pick(["0u", "1u", "3u", "0x8u", "9u"]);
      case "bool":
        return constant ? "true" : this.r.pick(["true", "false"]);
    }
  }

  /** An expression of type `ty`. */
  protected expr(ty: Ty, depth = 0): string {
    const options: (() => string | undefined)[] = [
      () => this.reference(ty),
      () => this.reference(ty),
      () => this.memberRead(ty, depth),
      () => this.call(ty, depth),
    ];
    if (depth < 3) options.push(() => this.compound(ty, depth), () => this.compound(ty, depth));
    for (let attempt = 0; attempt < 4; attempt++) {
      const made = this.r.pick(options)();
      if (made !== undefined) return made;
    }
    return this.construct(ty, depth);
  }

  /** A name whose value has type `ty`. */
  protected reference(ty: Ty): string | undefined {
    const matches = this.values().filter((d) => same(d.ty, ty) && !d.pointer);
    return matches.length > 0 ? this.r.pick(matches).name : undefined;
  }

  /** A field or element of some value, in one of the forms the member proof reads. */
  private memberRead(ty: Ty, depth: number): string | undefined {
    const structs = this.structs.filter((s) => this.visible(s));
    const holders = structs.filter((s) => s.fields.some((f) => same(f.ty, ty)));
    if (holders.length === 0 || depth > 2) return undefined;
    const holder = this.r.pick(holders);
    const field = this.r.pick(holder.fields.filter((f) => same(f.ty, ty)));
    const sty: Ty = { kind: "struct", decl: holder };
    const pointers = this.values().filter((d) => d.pointer && d.ty.kind === "struct" && d.ty.decl === holder);
    const forms: (() => string)[] = [
      () => `${this.expr(sty, depth + 1)}.${field.name}`,
      () => `(${this.expr(sty, depth + 1)}).${field.name}`,
      () => `array(${this.expr(sty, depth + 1)})[0]${this.comment()}.${field.name}`,
    ];
    if (this.writable(sty)) {
      forms.push(() => `array<${this.typeName(sty)}, 2>(${this.expr(sty, depth + 1)}, ${this.expr(sty, depth + 1)})[1].${field.name}`);
    }
    if (pointers.length > 0) {
      const p = this.r.pick(pointers).name;
      forms.push(() => `${p}.${field.name}`, () => `(*${p}).${field.name}`);
    }
    const read = this.r.pick(forms)();
    // A bool read would otherwise sit next to other operators unparenthesised
    return ty.kind === "scalar" && ty.name === "bool" ? `(${read})` : read;
  }

  private call(ty: Ty, depth: number): string | undefined {
    const callable = this.fns.filter((f) => same(f.ret, ty) && this.visible(f));
    if (callable.length === 0 || depth > 2) return undefined;
    const fn = this.r.pick(callable);
    const args: string[] = [];
    for (const p of fn.params) {
      if (p.pointer) {
        // Only a local `var` of the struct can be passed by pointer
        const vars = this.values().filter((d) => d.mutable && d.local && !d.pointer && same(d.ty, p.ty));
        if (vars.length === 0) return undefined;
        args.push(`&${this.r.pick(vars).name}`);
      } else {
        args.push(this.expr(p.ty, depth + 1));
      }
    }
    return `${fn.name}(${args.join(", ")})`;
  }

  /** Operators and builtins over smaller expressions. */
  private compound(ty: Ty, depth: number): string | undefined {
    const e = (t: Ty) => this.expr(t, depth + 1);
    // Factors are literals or names, so a constant product cannot overflow
    const factor = (t: Ty) => this.reference(t) ?? this.literal(t);
    if (ty.kind === "scalar") {
      switch (ty.name) {
        case "f32":
          return this.r.pick([
            () => `(${e(F32)} + ${e(F32)})`,
            () => `(${factor(F32)} * ${e(F32)})`,
            () => `(${e(F32)} - ${e(F32)})`,
            () => `-(${e(F32)})`,
            () => `abs(${e(F32)})`,
            () => `max(${e(F32)}, ${e(F32)})`,
            () => `f32(${e(I32)})`,
            () => `${e(VEC3)}.${this.r.pick(["x", "y", "z"])}`,
            () => `dot(${e(VEC3)}, ${e(VEC3)})`,
            () => `select(${e(F32)}, ${e(F32)}, ${e(BOOL)})`,
          ])();
        case "i32":
          return this.r.pick([() => `(${e(I32)} + ${e(I32)})`, () => `(${factor(I32)} * ${factor(I32)})`, () => `i32(${e(U32)})`])();
        case "u32":
          return this.r.pick([() => `(${e(U32)} + ${e(U32)})`, () => `(${e(U32)} >> 1u)`, () => `u32(abs(${e(F32)}))`])();
        case "bool":
          return this.r.pick([
            () => `(${e(F32)} < ${e(F32)})`,
            () => `(${e(I32)} >= ${e(I32)})`,
            () => `(${e(F32)} > (${e(F32)}))`,
            () => `!(${e(BOOL)})`,
            () => `(${e(BOOL)} && ${e(BOOL)})`,
          ])();
      }
    }
    return this.construct(ty, depth);
  }

  /** A literal or constructor of `ty`: always possible. */
  private construct(ty: Ty, depth: number): string {
    const e = (t: Ty) => (depth > 3 ? this.construct(t, depth + 1) : this.expr(t, depth + 1));
    switch (ty.kind) {
      case "scalar":
        return this.literal(ty);
      case "vec3f":
        return this.r.chance(0.5) ? `vec3f(${e(F32)}, ${e(F32)}, ${e(F32)})` : `vec3<f32>(${e(F32)})`;
      case "array": {
        const elements = Array.from({ length: ty.length }, () => e(ty.element));
        return this.writable(ty) && this.r.chance(0.6)
          ? `array<${this.typeName(ty.element)}, ${ty.length}>(${elements.join(", ")})`
          : `array(${elements.join(", ")})`;
      }
      case "struct":
        // A struct is shadowed only by a local holding a value of it (freshLocalName)
        if (!this.visible(ty.decl)) return this.reference(ty)!;
        return `${this.typeName(ty)}(${ty.decl.fields.map((f) => e(f.ty)).join(", ")})`;
    }
  }

  protected comment(): string {
    return this.r.chance(0.08) ? this.r.pick(["/* c */", "/* /* nested */ */", "\n// line\n"]) : "";
  }
}
