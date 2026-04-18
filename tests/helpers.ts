import type { Plugin } from "vite";
import { wgslObfuscate, type PluginOptions } from "@/index";

type PluginWithTransform = Plugin & {
  transform: (code: string, id: string) => { code: string } | null;
};

export function makePlugin(options: PluginOptions = {}): PluginWithTransform {
  return wgslObfuscate(options) as PluginWithTransform;
}

export function runTransform(
  wgsl: string,
  options: PluginOptions = {},
  id = "/fake/path/shader.wgsl"
): string {
  const result = makePlugin(options).transform(wgsl, id);
  if (!result) throw new Error("transform returned null");
  return result.code;
}
