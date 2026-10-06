import { describe, it, expect } from "vitest";
import { obfuscate, obfuscateProject } from "@/index";
import { expectSameSpirv, nagaErrors } from "@tests/helpers/compilers";
import { expectSameProgram } from "@tests/helpers/differential";
import { identifiers } from "@tests/helpers/wgsl";

// Builtins the word-list suite found missing: renamed when another file declared the
// same name. Renaming a local named like a naga ray constant even changed a value.

const RAY_QUERY = `enable wgpu_ray_query;
@group(0) @binding(0) var acc: acceleration_structure;
@group(0) @binding(1) var<storage, read_write> out: array<u32>;
@compute @workgroup_size(1) fn main() {
  var rq: ray_query;
  rayQueryInitialize(&rq, acc, RayDesc(0u, 255u, 0.1, 100.0, vec3(0.0), vec3(0.0, 1.0, 0.0)));
  rayQueryProceed(&rq);
  out[0] = rayQueryGetCommittedIntersection(&rq).kind;
}`;

describe("naga builtins that were missing", () => {
  it("a ray query function that another file declares is not linked to it", async () => {
    const other = `fn rayQueryProceed(x: f32) -> f32 { return x * 2.0; }\nfn useIt() -> f32 { return rayQueryProceed(1.0); }`;
    const { files } = obfuscateProject({ "trace.wgsl": RAY_QUERY, "other.wgsl": other });
    expect(identifiers(files["trace.wgsl"])).toContain("rayQueryProceed");
    await expectSameProgram(RAY_QUERY, files["trace.wgsl"]);
    await expectSameProgram(other, files["other.wgsl"]);
  });

  it("a cooperative matrix role that another file declares as a const", async () => {
    // `A` is predeclared only where some file enables the extension
    const coop = `enable wgpu_cooperative_matrix;\nfn f() { var m: coop_mat8x8<f32, A>; _ = m; }`;
    const other = `const A: f32 = 1.0;\nfn g() -> f32 { return A; }`;
    expect(nagaErrors(coop)).toBeNull();
    const { files, report } = obfuscateProject({ "coop.wgsl": coop, "other.wgsl": other });
    expect(report.files["other.wgsl"].kept).toContainEqual({ name: "A", space: "module", rule: "predeclared" });
    expect(nagaErrors(files["coop.wgsl"])).toBeNull();
    await expectSameProgram(other, files["other.wgsl"]);
    // Without the extension anywhere, `A` is an ordinary name
    expect(identifiers(obfuscate(other))).not.toContain("A");
  });

  it("a cooperative matrix role in a file whose `enable` comes from outside the project", () => {
    // The directive is in a JS-string prelude; the file only uses the type
    const prelude = `enable wgpu_cooperative_matrix;`;
    const coop = `fn f() { var m: coop_mat8x8<f32, A>; _ = m; }`;
    const other = `const A: f32 = 1.0;\nfn g() -> f32 { return A; }`;
    expect(nagaErrors(`${prelude}\n${coop}`)).toBeNull();
    const { files } = obfuscateProject({ "coop.wgsl": coop, "other.wgsl": other });
    expect(nagaErrors(`${prelude}\n${files["coop.wgsl"]}`)).toBeNull();
    expect(identifiers(files["other.wgsl"])).toContain("A");
  });

  it("the arguments of `@payload` and `@incoming_payload` name module-scope variables and are renamed with them", async () => {
    const src = `enable wgpu_ray_tracing_pipeline;
struct Hits { count: u32 }
var<incoming_ray_payload> hits: Hits;
@miss @incoming_payload(hits) fn onMiss() { hits.count += 1u; }`;
    expect(nagaErrors(src)).toBeNull();
    const { files, report } = obfuscateProject({ "s.wgsl": src });
    expect(identifiers(files["s.wgsl"])).not.toContain("hits");
    expect(identifiers(files["s.wgsl"])).toContain("onMiss");
    expect(report.doubts).toEqual([]);
    await expectSameProgram(src, files["s.wgsl"]);
  });

  it.each(["RAY_FLAG_NONE", "RAY_QUERY_INTERSECTION_NONE"])(
    "`%s` is read before scope lookup, so a local of that name stays as written",
    (name) => {
      const src = `enable wgpu_ray_query;
@compute @workgroup_size(1) fn main() {
  let ${name} = 7u;
  let flags: u32 = ${name};
  _ = flags;
}`;
      expect(nagaErrors(src)).toBeNull();
      const out = obfuscate(src);
      expect(identifiers(out).filter((n) => n === name)).toHaveLength(2);
      expectSameSpirv(src, out);
    },
  );
});
