import { describe, it, expect } from "vitest";
import { obfuscate } from "@/index";
import { expectSafeEverywhere } from "@tests/helpers/differential";

// Syntax built to confuse the tokenizer, emitter and resolver: attributes and comments
// everywhere, odd files, numbers, template lists beside comparisons. Every option set.

const OUT = `@group(0) @binding(0) var<storage, read_write> out: array<f32>;`;
const D = "@diagnostic(off, derivative_uniformity)";

describe("attributes", () => {
  it("on every declaration and interface position", async () => {
    await expectSafeEverywhere(`
enable f16;
diagnostic(off, derivative_uniformity);
const WG = 4u;
override HEIGHT: u32 = 2u;
@id(7) override gain: f32 = 1.0;
struct VertexOut { @builtin(position) pos: vec4f, @location(0) @interpolate(flat) tag: u32, @location(1) @interpolate(perspective, centroid) uv: vec2f, @location(2) @interpolate(linear, sample) w: f32 }
struct Buf { @align(16) a: f32, @size(32) b: vec2f, c: array<f32, 4> }
@group(0) @binding(0) var<storage, read_write> buf: Buf;
@must_use fn twice(v: f32) -> f32 { return v * 2.0; }
@vertex fn vs(@builtin(vertex_index) index: u32, @location(0) at: vec3f) -> VertexOut {
  var o: VertexOut; o.pos = vec4f(at, 1.0); o.tag = index; o.uv = at.xy; o.w = twice(at.z) * gain; return o;
}
@fragment fn fs(@builtin(position) @invariant p: vec4f, @location(0) @interpolate(flat) tag: u32) -> @location(0) vec4f {
  ${D} if (tag > 0u) { return vec4f(dpdx(p.x)); }
  return vec4f(p.xy, 0.0, 1.0);
}
@compute @workgroup_size(WG, HEIGHT,) fn cs(@builtin(local_invocation_id) lid: vec3u) { buf.c[lid.x % 4u] = f32(lid.y) + buf.a; buf.b = vec2f(1.0,); }`);
  });

  it("on statements and on every kind of body (Tint)", async () => {
    await expectSafeEverywhere(`${OUT}
fn f(x: i32) -> i32 ${D} {
  var y = 0;
  switch x ${D} { case 1 ${D} { y = 1; } default ${D} { y = 2; } }
  loop ${D} { y++; continuing ${D} { break if y > 3; } }
  while (y < 9) ${D} { y++; }
  for (var i = 0; i < 2; i++) ${D} { y += i; }
  if y > 0 ${D} { y--; } else ${D} { y++; }
  ${D} loop { y++; if y > 12 { break; } }
  ${D} { y++; }
  return y;
}
@compute @workgroup_size(1) fn main() { out[0] = f32(f(1)); }`);
  });

  it("with arguments that name declarations, and naga's and Tint's extension attributes", async () => {
    await expectSafeEverywhere(`
enable dual_source_blending;
const GROUP = 0;
const BINDING: u32 = 1u;
const LOC = 0;
const ALIGN = 16;
const SIZE = 32u;
const ID = 11;
override WIDTH: u32 = 8u;
struct Blend { @location(LOC) @blend_src(0) a: vec4f, @location(LOC) @blend_src(1) b: vec4f }
struct Padded { @align(ALIGN) x: f32, @size(SIZE) y: f32 }
struct Varyings { @builtin(position) p: vec4f, @location(LOC + 1) @interpolate(flat, either) i: u32, @location(2) @interpolate(flat, first) j: u32 }
@group(GROUP) @binding(BINDING) var<storage, read_write> padded: Padded;
@id(ID) override scale: f32 = 1.0;
@fragment fn fs(v: Varyings) -> Blend { return Blend(v.p * scale, vec4f(f32(v.i + v.j))); }
@compute @workgroup_size(WIDTH, WIDTH / 2u, 1) fn cs() { padded.y = padded.x * scale; }`);
  });
});

describe("comments", () => {
  it("in every position, nested, and at the end without a line break", async () => {
    await expectSafeEverywhere(`${OUT}
struct /* a */ Thing /* b */ { /* c */ value /* d */ : /* e */ f32 /* f */, }
@/* g */compute @ /* h */ workgroup_size( /* i */ 1 /* j */ ) fn /* k */ main /* l */ ( /* m */ ) {
  let /* n */ t /* o */ : /* p */ Thing = Thing( /* q */ 2.0 );
  out /* r */ [ /* s */ 0 ] = t /* t */ . /* u */ value; // v */
  /* nested /* comment */ still */ var<function> /* w */ x: f32 = 1.0; x += 1.0; out[1] = x;
  let/* touching */y = x; out[2] = y;
} // tail`);
  });
});

describe("unusual files", () => {
  it.each([
    ["empty", ""],
    ["only comments", "// nothing here\n/* at all */"],
    ["only directives", "enable f16;\nrequires readonly_and_readwrite_storage_textures;\ndiagnostic(off, derivative_uniformity);"],
    ["only semicolons", ";;;"],
  ])("%s", (_, src) => {
    expect(() => obfuscate(src)).not.toThrow();
    expect(obfuscate(src, { collapseWhitespace: false }).trim()).toBe(src.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, " ").trim());
  });

  it("every WGSL line break and blankspace character", async () => {
    await expectSafeEverywhere(`${OUT}\r// a\r\n@compute\v@workgroup_size(1)\ffn‎main()‏{\u0085out[0] = 1.0;\t}`);
  });
});

describe("numbers", () => {
  it("every literal form next to renamed names and unary minus", async () => {
    await expectSafeEverywhere(`${OUT}
fn f(a: f32, b: f32) -> f32 { return a- -b + 1.e2 + .5 + 0x1p-2f + 0x1.8p1 + 1e-5f + 2f + a-b + 0x.8p1 + 0X1P+2; }
@compute @workgroup_size(1) fn main() { out[0] = f(1.0, 2.0) + f32(0x10u) + f32(7i); }`);
  });
});

describe("template lists", () => {
  it("with trailing commas, `>=` and `>>=` right after them", async () => {
    await expectSafeEverywhere(`${OUT}
struct S { m: f32 }
fn f(p: ptr<function, S,>) -> f32 {
  let arr: array<S, 2,>= array<S, 2>(S(1.0), (*p));
  var v: vec3<f32,>= vec3(1.0);
  var grid: array<array<f32, 2>, 2>;
  let q: ptr<function, array<array<f32, 2>, 2>>= &grid;
  return arr[1].m + v.x + q[0][1];
}
@compute @workgroup_size(1) fn main() { var s = S(2.0); out[0] = f(&s); }`);
  });

  it("next to comparisons and shifts that look like them", async () => {
    await expectSafeEverywhere(`${OUT}
struct S { m: f32, n: u32 }
fn f(s: S, a: i32, b: i32) -> f32 {
  let c = (a < b) && (b > (a));
  let d = 0.5 > (s).m;
  let e = a < b || 1 > (b);
  let v = vec2<u32>(s.n >> (s).n, s.n << 1u);
  return select(0.0, 1.0, c && d && e) + f32(v.x >> (v).y);
}
@compute @workgroup_size(1) fn main() { out[0] = f(S(1.0, 2u), 1, 2); }`);
  });
});

describe("pointers and overrides", () => {
  it("pointers to structs, fields and arrays", async () => {
    await expectSafeEverywhere(`${OUT}
struct S { f: f32, g: array<f32, 2> }
fn assign(p: ptr<function, S>) { (*p).f = 1.0; p.g[1] = 2.0; let q = &(*p).g; q[0] = 3.0; }
@compute @workgroup_size(1) fn main() { var s: S; assign(&s); let r = &s; out[0] = r.f + (*r).g[0] + s.g[1]; }`);
  });

  it("overrides in workgroup sizes and array lengths", async () => {
    await expectSafeEverywhere(`${OUT}
override N: u32 = 4u;
@id(3) override M: u32 = 2u;
var<workgroup> tile: array<f32, N>;
@compute @workgroup_size(N, M) fn main(@builtin(local_invocation_index) i: u32) { tile[i % N] = f32(M); workgroupBarrier(); out[i] = tile[0]; }`);
  });
});
