# vite-plugin-wgsl-obfuscate

Build-time obfuscation for WGSL shader source files. Production builds get obfuscated shaders; dev mode is unaffected.

## What it does

1. **Identifier renaming** — all user-defined names (functions, variables, structs, fields, parameters) are replaced with short meaningless names (`_a`, `_b`, etc.). WGSL keywords, builtins, and swizzle components are preserved.
2. **Comment stripping** — all line and block comments removed.
3. **Whitespace collapse** — all whitespace reduced to minimum required for valid syntax.
4. **Constant splitting** — numeric literals are split into sums of 2-3 arbitrary parts. `3.14159` becomes `(1.4221819+1.7194108)`. The GPU shader compiler folds these at compile time — zero runtime cost.
5. **Const inlining** — all `const` declarations are replaced with their values at every usage site, then the declarations are removed. Eliminates named constant tables that would otherwise reveal buffer layouts.

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
| `preserve` | `string[]` | `[]` | Identifiers to keep (e.g. entry point names) |
| `renameIdents` | `boolean` | `true` | Rename user-defined identifiers |
| `stripComments` | `boolean` | `true` | Remove comments |
| `collapseWhitespace` | `boolean` | `true` | Minimize whitespace |
| `splitConstants` | `boolean` | `true` | Split numeric literals into sums |
| `inlineConsts` | `boolean` | `true` | Inline const declarations at usage sites |

All features are individually toggleable. Only active in production builds (`apply: "build"`).

## Performance impact

None. All transforms are source-level. The GPU shader compiler produces identical machine code regardless of variable names, whitespace, or constant expressions.

## License

MIT
