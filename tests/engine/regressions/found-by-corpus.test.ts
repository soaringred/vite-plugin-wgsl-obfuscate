import { describe, it, expect } from "vitest";
import { obfuscateProject } from "@/index";
import { expectSameSpirv, nagaErrors } from "@tests/helpers/compilers";
import { identifiers } from "@tests/helpers/wgsl";

// Bugs the corpus found, each reduced to a made-up shader that still shows it.

describe("naga's predeclared ray tracing types", () => {
  // naga treats a struct named `RayDesc` with these members as its own type, so
  // renaming it changed the SPIR-V: `RayDesc` was missing from the predeclared list
  const WRITTEN_OUT = `enable wgpu_ray_query;
struct RayDesc { flags: u32, cull_mask: u32, tmin: f32, tmax: f32, origin: vec3<f32>, dir: vec3<f32> }
@group(0) @binding(0) var acc: acceleration_structure;
@compute @workgroup_size(1) fn main() {
  var rq: ray_query;
  rayQueryInitialize(&rq, acc, RayDesc(0u, 255u, 0.1, 100.0, vec3(0.0), vec3(0.0, 1.0, 0.0)));
}`;

  it("a struct named `RayDesc` keeps its name, and the SPIR-V is unchanged", () => {
    const { files, report } = obfuscateProject({ "trace.wgsl": WRITTEN_OUT });
    expect(identifiers(files["trace.wgsl"])).toContain("RayDesc");
    expect(report.files["trace.wgsl"].kept).toContainEqual({ name: "RayDesc", space: "module", rule: "predeclared" });
    expectSameSpirv(WRITTEN_OUT, files["trace.wgsl"]);
  });

  it("another file's `RayDesc` does not capture the predeclared one", () => {
    const user = `enable wgpu_ray_query;
@group(0) @binding(0) var acc: acceleration_structure;
@compute @workgroup_size(1) fn main() {
  var rq: ray_query;
  rayQueryInitialize(&rq, acc, RayDesc(0u, 255u, 0.1, 100.0, vec3(0.0), vec3(0.0, 1.0, 0.0)));
}`;
    const other = `struct RayDesc { origin: vec3f }\nfn probe(r: RayDesc) -> vec3f { return r.origin; }`;
    const { files } = obfuscateProject({ "user.wgsl": user, "other.wgsl": other });
    expect(nagaErrors(user)).toBeNull();
    expect(nagaErrors(files["user.wgsl"])).toBeNull();
    expectSameSpirv(user, files["user.wgsl"]);
  });
});
