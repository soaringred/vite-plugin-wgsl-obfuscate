import type { Plugin } from "vite";
import { obfuscate, type ObfuscateOptions } from "./obfuscate";

export interface PluginOptions extends ObfuscateOptions {
  /** File pattern to match (default: /\.wgsl/) */
  include?: RegExp;
}

/**
 * Vite plugin that obfuscates WGSL shader source in production builds.
 * Only active during `vite build` — dev mode serves readable source.
 */
export function wgslObfuscate(options: PluginOptions = {}): Plugin {
  const include = options.include ?? /\.wgsl/;
  const { include: _, ...obfuscateOptions } = options;

  return {
    name: "vite-plugin-wgsl-obfuscate",
    apply: "build",
    transform(code, id) {
      if (!include.test(id)) return null;

      // Vite wraps ?raw imports as: export default "..."
      const rawMatch = code.match(/^export default "(.*)"$/s);
      if (rawMatch) {
        // Use JSON.parse for complete unescape, JSON.stringify for complete re-escape
        const wgsl = JSON.parse(`"${rawMatch[1]}"`);
        const obfuscated = obfuscate(wgsl, obfuscateOptions);
        const escaped = JSON.stringify(obfuscated);

        return { code: `export default ${escaped}`, map: null };
      }

      return { code: obfuscate(code, obfuscateOptions), map: null };
    },
  };
}
