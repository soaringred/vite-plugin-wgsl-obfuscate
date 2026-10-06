// The typed model behind the random WGSL generator: a seedable PRNG, the
// types and declarations it tracks, and the name pools.

/** mulberry32: a fast, seedable PRNG. */
export class Random {
  constructor(private state: number) {}
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
}

export type Scalar = "f32" | "i32" | "u32" | "bool";
export type Ty =
  | { kind: "scalar"; name: Scalar }
  | { kind: "vec3f" }
  | { kind: "struct"; decl: StructDecl }
  | { kind: "array"; element: Ty; length: number };

export interface StructDecl { kind: "struct"; name: string; fields: { name: string; ty: Ty }[] }
export interface AliasDecl { kind: "alias"; name: string; target: StructDecl }
export interface ValueDecl { kind: "value"; name: string; ty: Ty; mutable: boolean; local: boolean; pointer?: boolean }
export interface FnDecl { kind: "fn"; name: string; params: ValueDecl[]; ret: Ty }
export type Decl = StructDecl | AliasDecl | ValueDecl | FnDecl;

/** Names for everything. None is a word the generator writes as a builtin. */
export const NAMES = [
  "a", "b", "x", "y", "rgb", "xy", "value", "gain", "depth", "inner", "color", "item", "node",
  "length", "normalize", "sin", "sample", "position", "vertex_index", "fract", "exp", "whole",
  "kind", "t", "tmin", "_a", "_b", "_c", "_aa", "_ab", "_zz", "A", "B", "C", "S", "T", "Probe",
  "é", "é", "𝒙", "ñame", "data", "id", "flat", "center", "read", "uniform", "layer2", "k9",
];
/** Field names: a namespace of their own, so reserved-looking names are fine. */
export const FIELD_NAMES = [...NAMES, "size", "align", "location", "offset"];
/** Field names used most of the time, so that structs inside and outside the project share them. */
export const COMMON_FIELD_NAMES = ["value", "gain", "item", "depth", "layer2", "size", "data"];

export const F32: Ty = { kind: "scalar", name: "f32" };
export const I32: Ty = { kind: "scalar", name: "i32" };
export const U32: Ty = { kind: "scalar", name: "u32" };
export const BOOL: Ty = { kind: "scalar", name: "bool" };
export const VEC3: Ty = { kind: "vec3f" };

export function same(a: Ty, b: Ty): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "scalar") return a.name === (b as typeof a).name;
  if (a.kind === "struct") return a.decl === (b as typeof a).decl;
  if (a.kind === "array") return a.length === (b as typeof a).length && same(a.element, (b as typeof a).element);
  return true;
}
