import { F32, I32, U32, VEC3, NAMES, Random } from "@tests/helpers/random/model";
import type { AliasDecl, Decl, FnDecl, StructDecl, Ty, ValueDecl } from "@tests/helpers/random/model";

// What each name means where the generator writes it, fresh names, and the
// types it can write there.

export class Scopes {
  protected readonly moduleScope = new Map<string, Decl>();
  protected scopes: Map<string, Decl>[] = [];
  protected readonly structs: StructDecl[] = [];
  protected readonly fns: FnDecl[] = [];

  constructor(protected readonly r: Random) {}

  protected lookup(name: string): Decl | undefined {
    for (let s = this.scopes.length - 1; s >= 0; s--) {
      const found = this.scopes[s].get(name);
      if (found) return found;
    }
    return this.moduleScope.get(name);
  }

  /** True when `decl` is what its name means here. */
  protected visible(decl: Decl): boolean {
    return this.lookup(decl.name) === decl;
  }

  protected freshModuleName(): string {
    for (;;) {
      const name = this.r.pick(NAMES);
      if (!this.moduleScope.has(name)) return name;
    }
  }

  /**
   * A name new to the innermost scope. It shadows a struct or alias only when it holds
   * a value of that struct, so the struct can still be written.
   */
  protected freshLocalName(ty: Ty): string {
    const inner = this.scopes[this.scopes.length - 1];
    for (;;) {
      const name = this.r.pick(NAMES);
      if (inner.has(name)) continue;
      const shadowed = this.lookup(name);
      const struct = shadowed?.kind === "struct" ? shadowed : shadowed?.kind === "alias" ? shadowed.target : undefined;
      if (struct && !(ty.kind === "struct" && ty.decl === struct)) continue;
      return name;
    }
  }

  protected declareLocal(decl: ValueDecl): void {
    this.scopes[this.scopes.length - 1].set(decl.name, decl);
  }

  /** The written name of a type, through an alias sometimes. */
  protected typeName(ty: Ty): string {
    switch (ty.kind) {
      case "scalar":
        return ty.name;
      case "vec3f":
        return this.r.chance(0.5) ? "vec3f" : "vec3<f32>";
      case "array":
        return `array<${this.typeName(ty.element)}, ${ty.length}>`;
      case "struct": {
        const aliases = [...this.moduleScope.values()].filter(
          (d): d is AliasDecl => d.kind === "alias" && d.target === ty.decl && this.visible(d),
        );
        if (aliases.length > 0 && this.r.chance(0.4)) return this.r.pick(aliases).name;
        return ty.decl.name;
      }
    }
  }

  /** Whether a type can be written here: its struct names must not be shadowed. */
  protected writable(ty: Ty): boolean {
    if (ty.kind === "struct") return this.visible(ty.decl);
    if (ty.kind === "array") return this.writable(ty.element);
    return true;
  }

  protected randomType(depth = 0): Ty {
    const structs = this.structs.filter((s) => this.visible(s));
    const roll = this.r.int(depth > 1 ? 5 : 7);
    if (roll < 3) return this.r.pick([F32, F32, I32, U32]);
    if (roll === 3) return VEC3;
    if (roll === 4 || structs.length === 0) return structs.length > 0 ? { kind: "struct", decl: this.r.pick(structs) } : F32;
    return { kind: "array", element: this.randomType(depth + 1), length: 2 + this.r.int(2) };
  }
}
