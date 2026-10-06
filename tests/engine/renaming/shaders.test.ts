import { describe, it } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { expectValid } from "@tests/helpers/compilers";
import { expectSafeEverywhere } from "@tests/helpers/differential";

// Hand-written shaders that the suite needs without the downloaded corpus:
// whole shaders of the kinds apps ship, and a spread of WGSL constructs.

const FIXTURES_DIR = join(__dirname, "..", "..", "fixtures");
const FIXTURES = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".wgsl"));

const CASES: Record<string, string> = {
  "pointers, dereference and address-of": `
    struct Counter { hits: u32, misses: u32 }
    fn bump(c: ptr<function, Counter>, hit: bool) {
      if (hit) { (*c).hits += 1u; } else { c.misses++; }
    }
    @group(0) @binding(0) var<storage, read_write> out: array<u32, 2>;
    @compute @workgroup_size(1) fn main() {
      var counter = Counter(0u, 0u);
      let p = &counter;
      bump(p, true);
      bump(&counter, false);
      out[0] = (*p).hits;
      out[1] = counter.misses;
    }
  `,

  "runtime-sized arrays, atomics and arrayLength": `
    struct Bucket { total: atomic<u32>, items: array<u32> }
    @group(0) @binding(0) var<storage, read_write> bucket: Bucket;
    @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) gid: vec3u) {
      if (gid.x >= arrayLength(&bucket.items)) { return; }
      let value = bucket.items[gid.x];
      atomicAdd(&bucket.total, value);
    }
  `,

  "workgroup memory, overrides in array sizes and workgroupUniformLoad": `
    override TILE: u32 = 16u;
    var<workgroup> tile: array<f32, TILE>;
    var<workgroup> flag: u32;
    @group(0) @binding(0) var<storage, read_write> data: array<f32>;
    @compute @workgroup_size(TILE) fn main(@builtin(local_invocation_index) lane: u32) {
      tile[lane] = data[lane];
      if (lane == 0u) { flag = 1u; }
      workgroupBarrier();
      if (workgroupUniformLoad(&flag) == 1u) { data[lane] = tile[TILE - 1u - lane]; }
    }
  `,

  "loop forms": `
    @group(0) @binding(0) var<storage, read_write> data: array<f32, 8>;
    @compute @workgroup_size(1) fn main() {
      var i = 0u;
      loop {
        if (i >= 8u) { break; }
        let doubled = data[i] * 2.0;
        continuing {
          data[i] = doubled;
          i += 1u;
          break if i == 7u;
        }
      }
      while (i > 0u) { i -= 1u; data[i] += 1.0; }
      for (var j = 0u; j < 8u; j += 2u) { if (j == 4u) { continue; } data[j] = f32(j); }
    }
  `,

  "const_assert, hex floats, abstract numbers and shifts": `
    const BITS = 6u;
    const MASK = (1u << BITS) - 1u;
    const_assert MASK == 63u;
    const HALF = 0x1p-1f;
    @group(0) @binding(0) var<storage, read_write> data: array<u32, 4>;
    @compute @workgroup_size(1) fn main() {
      const_assert BITS < 32u;
      var packed = data[0];
      packed >>= 2u;
      packed <<= 1u;
      data[1] = (packed >> 1u) & MASK;
      data[2] = u32(f32(data[3]) * HALF);
      data[3] = bitcast<u32>(0x1.8p1f);
    }
  `,

  "nested templates and closing `>>`": `
    alias Pairs = array<vec2<u32>, 4>;
    var<private> table: array<array<f32, 2>, 3>;
    @group(0) @binding(0) var<storage, read_write> data: array<vec2<u32>>;
    @compute @workgroup_size(1) fn main() {
      var pairs: Pairs;
      pairs[1] = vec2<u32>(3u, 4u);
      table[2][1] = f32(pairs[1].y);
      data[0] = pairs[1] >> vec2<u32>(1u);
      data[1] = vec2<u32>(u32(table[2][1]), 0u);
    }
  `,

  "textures and samplers as parameters": `
    @group(0) @binding(0) var colorMap: texture_2d<f32>;
    @group(0) @binding(1) var depthMap: texture_depth_2d;
    @group(0) @binding(2) var linearSampler: sampler;
    @group(0) @binding(3) var shadowSampler: sampler_comparison;
    @group(0) @binding(4) var outputMap: texture_storage_2d<rgba8unorm, write>;
    fn shade(tex: texture_2d<f32>, samp: sampler, uv: vec2f) -> vec4f {
      return textureSampleLevel(tex, samp, uv, 0.0);
    }
    fn shadow(depth: texture_depth_2d, samp: sampler_comparison, uv: vec2f, depthRef: f32) -> f32 {
      return textureSampleCompareLevel(depth, samp, uv, depthRef);
    }
    @compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) gid: vec3u) {
      let uv = vec2f(gid.xy) / vec2f(textureDimensions(outputMap));
      let lit = shade(colorMap, linearSampler, uv) * shadow(depthMap, shadowSampler, uv, 0.5);
      textureStore(outputMap, gid.xy, lit);
    }
  `,

  "vertex and fragment stages with struct IO and @must_use": `
    struct VertexOut {
      @builtin(position) clip: vec4f,
      @location(0) @interpolate(perspective, centroid) uv: vec2f,
      @location(1) @interpolate(flat) layer: u32,
    }
    @must_use fn corner(index: u32) -> vec2f {
      return vec2f(f32(index & 1u), f32(index >> 1u));
    }
    @vertex fn vs(@builtin(vertex_index) index: u32, @builtin(instance_index) instance: u32) -> VertexOut {
      let uv = corner(index);
      return VertexOut(vec4f(uv * 2.0 - 1.0, 0.0, 1.0), uv, instance);
    }
    @fragment fn fs(input: VertexOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
      let base = select(0.25, 1.0, front);
      return vec4f(input.uv, f32(input.layer), base);
    }
  `,

  "fragment outputs, discard and derivatives": `
    struct FragOut {
      @location(0) color: vec4f,
      @builtin(frag_depth) depth: f32,
    }
    @fragment fn fs(@builtin(position) pos: vec4f, @location(0) coverage: f32) -> FragOut {
      let width = fwidth(coverage);
      if (coverage < width) { discard; }
      var out: FragOut;
      out.color = vec4f(smoothstep(0.0, width, coverage));
      out.depth = pos.z;
      return out;
    }
  `,

};

describe("shaders under every option set", () => {
  it.each(FIXTURES)("%s", async (name) => {
    const src = readFileSync(join(FIXTURES_DIR, name), "utf-8");
    await expectValid(src, "input");
    await expectSafeEverywhere(src);
  });

  it.each(Object.entries(CASES))("%s", async (_, src) => {
    await expectValid(src, "input");
    await expectSafeEverywhere(src);
  });
});
