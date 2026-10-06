import type { SymbolInfo, TokenRange } from "@/analysis/resolver";
import { isPredeclared } from "@/wgsl/grammar";
import { ProofSyntax } from "@/analysis/proof/proof-syntax";
import type { TypeNode } from "@/analysis/proof/proof-syntax";
import { ASSIGN_FIRST, merge, unknown } from "@/analysis/proof/proof-types";
import type { ProjectDeclaration, ProofFile, ProofType } from "@/analysis/proof/proof-types";

// What the member proof knows without reading an expression: where a name can bind across the
// project, what a written type denotes, and what `.field` and `[index]` give.

/** How deeply the proof nests. Deeper is unknown, which is sound and keeps well inside the JS stack.
 * Declaration chains do not count against it: `warm` types them in declaration order first. */
const MAX_DEPTH = 200;

export class DeclaredTypes extends ProofSyntax {
  private readonly rangeTypes = new Map<string, ProofType>();
  /** Current nesting of `typeOfExpr`, `valueType` and `typeOfRange`. */
  private depth = 0;

  constructor(
    files: ProofFile[],
    /** Module-scope declarations by name, across the project. */
    protected readonly declarations: ReadonlyMap<string, ProjectDeclaration[]>,
  ) {
    super(files);
  }

  /** Run `find` one level deeper, or give unknown past `MAX_DEPTH`. */
  protected nested(find: () => ProofType): ProofType {
    if (this.depth >= MAX_DEPTH) {
      return unknown("the expression or declaration nests too deeply for the proof to follow", ASSIGN_FIRST);
    }
    this.depth++;
    try {
      return find();
    } finally {
      this.depth--;
    }
  }

  // ── Declarations ──────────────────────────────────────────────────

  /** Declarations an identifier can bind to, in its own file or at module scope in the others; else why not. */
  protected declarationsOf(f: number, k: number): ProjectDeclaration[] | { why: string; action?: string } {
    const { analysis } = this.files[f];
    const cls = analysis.classes[k];
    const name = this.text(f, k);
    if (cls === "ref") return [{ file: f, symbol: analysis.symbols[analysis.bindings[k]] }];
    if (cls !== "unresolved") return { why: `\`${name}\` is not a name the proof can follow` };
    if (isPredeclared(name)) return { why: `\`${name}\` is predeclared by WGSL` };
    const declarations = this.declarations.get(name) ?? [];
    if (declarations.length === 0) return { why: `\`${name}\` is not declared in the project` };
    return declarations;
  }

  /** A name's type from its declarations' types. When one of several is not proven, the reason says so. */
  protected mergeDeclarations(name: string, declarations: ProjectDeclaration[], types: ProofType[]): ProofType {
    const type = merge(types);
    if (type.kind !== "unknown" || declarations.length < 2) return type;
    const where = [...new Set(declarations.map((d) => this.files[d.file].id))].sort().join(", ");
    return unknown(
      `\`${name}\` is declared more than once in the project (${where}), and for one of them ${type.why.reason}`,
      `give the declarations of \`${name}\` different names`,
    );
  }

  // ── Types ─────────────────────────────────────────────────────────

  /** The type written in [start, end) of file `f`, resolved at module scope. */
  protected typeOfRange(f: number, range: TokenRange): ProofType {
    const known = this.rangeTypes.get(`${f}:${range[0]}:${range[1]}`);
    if (known) return known;
    return this.nested(() => this.findTypeOfRange(f, range));
  }

  private findTypeOfRange(f: number, [start, end]: TokenRange): ProofType {
    const key = `${f}:${start}:${end}`;
    // A cycle through aliases (invalid WGSL) ends as unknown
    this.rangeTypes.set(key, unknown("the type refers to itself", ASSIGN_FIRST));
    const node = this.parseType(f, start, end);
    const type = node
      ? this.resolveType(f, node)
      : unknown("its declared type is not a form the proof covers", ASSIGN_FIRST);
    this.rangeTypes.set(key, type);
    return type;
  }

  protected aliasType(f: number, alias: SymbolInfo): ProofType {
    return alias.type ? this.typeOfRange(f, alias.type) : unknown(`alias \`${alias.name}\` has no type`, ASSIGN_FIRST);
  }

  private resolveType(f: number, node: TypeNode): ProofType {
    const name = this.text(f, node.k);
    const { analysis } = this.files[f];
    const cls = analysis.classes[node.k];

    if (node.args !== null) {
      // Only the predeclared `array`, `binding_array` and `ptr` are followed
      const predeclared = cls === "unresolved" && !this.declarations.has(name);
      if (predeclared && (name === "array" || name === "binding_array")) {
        const element = node.args[0];
        return {
          kind: "array",
          element: element ? this.resolveType(f, element) : unknown("the array's element type is not written", ASSIGN_FIRST),
        };
      }
      if (predeclared && name === "ptr") {
        const pointee = node.args[1];
        return {
          kind: "ptr",
          pointee: pointee ? this.resolveType(f, pointee) : unknown("the pointer's store type is not written", ASSIGN_FIRST),
        };
      }
      return unknown(`\`${name}<...>\` is not a struct the project declares`, ASSIGN_FIRST);
    }

    const target = this.declarationsOf(f, node.k);
    if ("why" in target) {
      return unknown(
        target.why,
        target.action ?? (isPredeclared(name) ? ASSIGN_FIRST : `declare \`${name}\` in a project file`),
      );
    }
    return this.mergeDeclarations(
      name,
      target,
      target.map(({ file, symbol }) => {
        if (symbol.kind === "struct") return { kind: "struct", file, symbol: symbol.id };
        if (symbol.kind === "alias") return this.aliasType(file, symbol);
        return unknown(`\`${name}\` is not a type`, ASSIGN_FIRST);
      }),
    );
  }

  // ── Steps ─────────────────────────────────────────────────────────

  /** The struct that `.name` reads from `type`, after one automatic dereference, for every option of a union. */
  protected structOf(type: ProofType, name: string, dereference = true): ProofType {
    if (type.kind === "union") return merge(type.options.map((option) => this.structOf(option, name, dereference)));
    if (type.kind === "ptr" && dereference) return this.structOf(type.pointee, name, false);
    if (type.kind === "unknown") return type;
    if (type.kind !== "struct") return unknown(`\`.${name}\` is applied to an array or a pointer to a pointer`, ASSIGN_FIRST);
    const struct = this.files[type.file].analysis.symbols[type.symbol];
    if (!struct.fields?.some((field) => field.name === name)) {
      // A struct name that several files declare: say which one
      if ((this.declarations.get(struct.name)?.length ?? 0) > 1) {
        return unknown(
          `\`${struct.name}\` is declared more than once in the project, and the struct \`${struct.name}\` ` +
            `in ${this.files[type.file].id} has no field \`${name}\``,
          `give the declarations of \`${struct.name}\` different names`,
        );
      }
      return unknown(`struct \`${struct.name}\` has no field \`${name}\``, ASSIGN_FIRST);
    }
    return type;
  }

  protected fieldType(type: ProofType, name: string): ProofType {
    const ofStruct = (base: ProofType): ProofType => {
      if (base.kind === "union") return merge(base.options.map(ofStruct));
      if (base.kind !== "struct") return base;
      const struct = this.files[base.file].analysis.symbols[base.symbol];
      const field = struct.fields!.find((candidate) => candidate.name === name)!;
      return this.typeOfRange(base.file, field.type);
    };
    return ofStruct(this.structOf(type, name));
  }

  /** Type of `[index]` on `type`, after automatic dereference (once), for every option of a union. */
  protected elementType(type: ProofType, dereference = true): ProofType {
    if (type.kind === "union") return merge(type.options.map((option) => this.elementType(option, dereference)));
    if (type.kind === "ptr" && dereference) return this.elementType(type.pointee, false);
    if (type.kind === "unknown") return type;
    if (type.kind !== "array") return unknown("an index is applied to something that is not an array", ASSIGN_FIRST);
    return type.element;
  }
}
