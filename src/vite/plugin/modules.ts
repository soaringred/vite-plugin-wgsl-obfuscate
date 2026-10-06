import { validate, ObfuscateError } from "@/wgsl/validate";
import type { BuildContext } from "@/vite/plugin/context";

// What a module is: the file and query of its id, and whether its code is a string module or WGSL text.

/** The query of a module id without the `?`, or null when it has none. */
export function queryOf(id: string): string | null {
  const q = id.indexOf("?");
  return q < 0 ? null : id.slice(q + 1);
}

/** A module id without its query and without a leading `\0`. */
export function fileOf(id: string): string {
  const clean = id.startsWith("\0") ? id.slice(1) : id;
  const q = clean.indexOf("?");
  return q < 0 ? clean : clean.slice(0, q);
}

/** The text of a module that is `export default` one string literal without interpolation, else null. */
export function stringModuleText(ctx: BuildContext, code: string): string | null {
  if (!code.includes("export")) return null;
  let ast: { body?: { type: string; declaration?: Record<string, unknown> }[] };
  try {
    ast = ctx.parse(code) as typeof ast;
  } catch {
    return null;
  }
  const body = (ast.body ?? []).filter((node) => node.type !== "EmptyStatement");
  if (body.length !== 1 || body[0].type !== "ExportDefaultDeclaration") return null;
  const value = body[0].declaration ?? {};
  if (value.type === "Literal" && typeof value.value === "string") return value.value;
  if (value.type === "TemplateLiteral") {
    const { expressions, quasis } = value as { expressions: unknown[]; quasis: { value: { cooked?: string | null } }[] };
    if (expressions.length === 0 && quasis.length === 1 && typeof quasis[0].value.cooked === "string") {
      return quasis[0].value.cooked;
    }
  }
  return null;
}

/** True when `code` itself is WGSL the plugin understands. */
export function isWgsl(code: string): boolean {
  try {
    validate(code);
    return true;
  } catch (error) {
    if (error instanceof ObfuscateError) return false;
    throw error;
  }
}
