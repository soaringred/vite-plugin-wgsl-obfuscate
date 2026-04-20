# vite-plugin-wgsl-obfuscate

Build-time obfuscation for WGSL shader source files. Production builds get obfuscated shaders; dev mode is unaffected.

## What it does

1. **Identifier renaming** — all user-defined names (functions, variables, structs, fields, parameters) are replaced with short meaningless names (`_a`, `_b`, etc.). WGSL keywords, builtins, and names matching vec-swizzle patterns (`x`/`y`/`z`/`w`, `r`/`g`/`b`/`a`, and 2–4 char combinations like `xy`/`rgba`/`xyzw`) are preserved so swizzle access stays valid.
2. **Comment stripping** — line comments and (nested) block comments removed.
3. **Whitespace collapse** — all whitespace reduced to the minimum required for valid syntax.
4. **Const inlining** — `const` declarations are replaced with their values at every usage site, then the declarations are removed. Eliminates named constant tables that would otherwise reveal buffer layouts. Cyclic `const` graphs (`const A = B; const B = A;`) are left untouched — the source wouldn't compile anyway.

Typical output is 40–50% the size of the source (measured across the repo's fixture shaders).

## Install

```bash
npm install vite-plugin-wgsl-obfuscate
```

## Usage

```ts
// vite.config.ts
import { wgslObfuscate } from "vite-plugin-wgsl-obfuscate";

export default defineConfig({
  plugins: [
    wgslObfuscate(),
  ],
});
```

Entry point names (functions with `@compute`, `@vertex`, or `@fragment` attributes) are automatically detected and preserved. Use `preserve` for any additional identifiers that must survive obfuscation.

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `include` | `RegExp` | `/\.wgsl/` | File pattern to match |
| `preserve` | `string[]` | `[]` | Additional identifiers to keep unrenamed (entry points are auto-detected) |
| `renameIdents` | `boolean` | `true` | Rename user-defined identifiers |
| `collapseWhitespace` | `boolean` | `true` | Minimize whitespace |
| `inlineConsts` | `boolean` | `true` | Inline const declarations at usage sites |

All features are individually toggleable. Only active in production builds (`apply: "build"`).

## Performance impact

None. All transforms are source-level. The GPU shader compiler produces identical machine code regardless of variable names, whitespace, or constant expressions.

## License

MIT
