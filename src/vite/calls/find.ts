import { lexerStops } from "@/vite/calls/lexer";

// The WGSL a module hands to a shader call: a string or template literal passed first, or as the `code` of an
// object literal passed first, or a template the call tags. A shader that reaches a call any other way, such
// as through a variable, is not seen.

/** The calls `wgslCalls` names, ready for each step of a module's check. */
export interface ShaderCalls {
  names: ReadonlySet<string>;
  /** Finds a name as a whole word: a module without one is skipped unread. */
  mention: RegExp;
  /** For `mayCallShader`. */
  stops: RegExp;
}

export function shaderCalls(names: string[]): ShaderCalls {
  const words = names.map((name) => name.replace(/\$/g, "\\$")).join("|");
  return { names: new Set(names), mention: new RegExp(`(?<![\\w$])(?:${words})(?![\\w$])`), stops: lexerStops(words) };
}

/** A literal handed to a shader call. */
export interface ShaderLiteral {
  /** The call as messages show it: `wgslFn(...)`, `createShaderModule({ code })` or wgsl`...`. */
  call: string;
  /** Offset of the literal in the module's code. */
  offset: number;
  /** The literal's text; for a template with `${...}`, the text around the substitutions. */
  parts: string[];
}

interface Node {
  type: string;
  start?: number;
  [key: string]: unknown;
}

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

/** Call `visit` on every node of an ESTree AST, depth first. */
function walk(ast: unknown, visit: (node: Node) => void): void {
  const stack: unknown[] = [ast];
  while (stack.length > 0) {
    const value = stack.pop();
    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i--) stack.push(value[i]);
      continue;
    }
    if (!isNode(value)) continue;
    visit(value);
    for (const key in value) {
      if (key === "type" || key === "loc" || key === "range" || key === "parent") continue;
      const child = value[key];
      if (typeof child === "object" && child !== null) stack.push(child);
    }
  }
}

/** The text of a string or template literal, or undefined for any other expression. */
function textOf(node: Node): string[] | undefined {
  while (node.type === "ParenthesizedExpression") node = node.expression as Node;
  if (node.type === "Literal" && typeof node.value === "string") return [node.value];
  if (node.type !== "TemplateLiteral") return undefined;
  return (node.quasis as Node[]).map((quasi) => {
    const { cooked, raw } = quasi.value as { cooked?: string | null; raw: string };
    return cooked ?? raw;
  });
}

/** A name as written, `code` or `"code"`. */
function nameOf(node: Node): unknown {
  return node.type === "Identifier" ? node.name : node.value;
}

/** Every literal that `ast` hands to one of `names`, called bare, as a method, or by an imported alias. */
export function shaderLiterals(ast: unknown, names: ReadonlySet<string>): ShaderLiteral[] {
  const aliases = new Set<string>();
  for (const node of (ast as { body?: Node[] }).body ?? []) {
    if (node.type !== "ImportDeclaration") continue;
    for (const specifier of node.specifiers as Node[]) {
      if (specifier.type === "ImportSpecifier" && names.has(nameOf(specifier.imported as Node) as string)) {
        aliases.add((specifier.local as Node).name as string);
      }
    }
  }
  const calleeName = (callee: Node): string | undefined => {
    if (callee.type === "Identifier") {
      const name = callee.name as string;
      return names.has(name) || aliases.has(name) ? name : undefined;
    }
    if (callee.type !== "MemberExpression" || callee.computed) return undefined;
    const property = callee.property as Node;
    return property.type === "Identifier" && names.has(property.name as string) ? (property.name as string) : undefined;
  };

  const found: ShaderLiteral[] = [];
  const add = (call: string, node: Node, parts: string[]) => found.push({ call, offset: node.start ?? 0, parts });
  walk(ast, (node) => {
    if (node.type === "TaggedTemplateExpression") {
      const name = calleeName(node.tag as Node);
      if (name) add(`${name}\`...\``, node.quasi as Node, textOf(node.quasi as Node)!);
      return;
    }
    if (node.type !== "CallExpression") return;
    const name = calleeName(node.callee as Node);
    const first = (node.arguments as Node[])[0];
    if (!name || !first) return;
    const parts = textOf(first);
    if (parts) return add(`${name}(...)`, first, parts);
    if (first.type !== "ObjectExpression") return;
    for (const property of first.properties as Node[]) {
      if (property.type !== "Property" || property.computed || nameOf(property.key as Node) !== "code") continue;
      const code = textOf(property.value as Node);
      if (code) add(`${name}({ code })`, property.value as Node, code);
    }
  });
  return found.sort((a, b) => a.offset - b.offset);
}
