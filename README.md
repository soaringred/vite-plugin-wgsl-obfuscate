# vite-plugin-wgsl-obfuscate

A Vite plugin that renames declared WGSL identifiers, removes comments and collapses whitespace. It treats every WGSL module in the build as one project, so a name shared between files gets the same new name in all of them. Structural input checks report errors with the file, line and column; output consistency checks run by default. It only runs in `vite build`: `vite dev` serves your shaders as written.

## Install and usage

```sh
npm install --save-dev vite-plugin-wgsl-obfuscate
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { wgslObfuscate } from "vite-plugin-wgsl-obfuscate";

export default defineConfig({ plugins: [wgslObfuscate()] });
```

Import your shaders as strings with `?raw`:

```ts
import shade from "./shaders/shade.wgsl?raw";
```

A `.wgsl` file imported with another query, such as `?url`, ships as written; if it uses a name the plugin renamed, the build fails.

## Example

`src/shaders/shade.wgsl`:

```wgsl
// Diffuse lighting
struct Light {
  direction: vec3f,
  intensity: f32,
}

@group(0) @binding(0) var<uniform> light: Light;

fn lambert(normal: vec3f) -> f32 {
  return max(dot(normal, -light.direction), 0.0) * light.intensity;
}

@fragment
fn fs_main(@location(0) normal: vec3f) -> @location(0) vec4f {
  let brightness = lambert(normalize(normal));
  return vec4f(vec3f(brightness), 1.0);
}
```

After `vite build`:

```wgsl
struct _b{_a:vec3f,_b:f32,}@group(0)@binding(0)var<uniform>_a:_b;fn _c(_b:vec3f)->f32{return max(dot(_b,-_a._a),0.0)*_a._b;}@fragment fn fs_main(@location(0)_b:vec3f)->@location(0)vec4f{let _a=_c(normalize(_b));return vec4f(vec3f(_a),1.0);}
```

## What is kept

The plugin renames only what your shaders declare, and keeps a name as written when renaming it could break code it cannot see, or when you ask. A module-scope name or struct field kept in one file is kept in every file.

| Kept as written | To rename it |
|---|---|
| Entry points (`@vertex`, `@fragment`, `@compute` and naga's stages) | Not possible |
| `override`s without `@id` | Give it an `@id(n)` and set it by number |
| Parameters of a function that starts a file (after any directives) and is not an entry point, for three.js `wgslFn` | `wgslFnParams: "rename"` |
| Struct fields with an access the plugin cannot prove is on a struct your shaders declare | Do what the build warning says |
| Declarations with an attribute the plugin does not know, and names in its arguments | Not possible |
| Names that WGSL itself uses: a module-scope name that is also a builtin (`fn saturate`), enumerants (`read`, `rgba8unorm`), swizzle-like fields (`xy`, `rgba`) and fields named like builtin results (`fract`, `exp`) | Not possible |
| Names in `preserve`; with `topLevel: "keep"`, every module-scope name and struct field | Change the option |

## WGSL in JS strings

The plugin does not obfuscate WGSL written in a JS or TS string. A string literal passed straight to `wgslFn`, `wgsl` or `createShaderModule` (as `code`) that uses a renamed name fails the build:

```
[plugin vite-plugin-wgsl-obfuscate]
RolldownError: A shader in a JS string uses names that the plugin renamed, so it will not link with the obfuscated shaders:
  - src/effects.ts:4: `wgslFn(...)` uses `lambert`
Move the shader into a `.wgsl` file imported with `?raw`, so that it is obfuscated with the others. If it cannot move, add the names to `preserve`. If it is never linked with the obfuscated shaders and the match is a coincidence, add the names to `leakIgnore`.
```

A template literal with `${...}` in such a call only warns, because the plugin cannot see what it inserts. A string that reaches those calls any other way, such as through a variable, is not checked; the only guard for it is compiling the production build's shaders before you deploy. The fix is a `.wgsl` file imported with `?raw`:

```ts
import desaturateSource from "./shaders/desaturate.wgsl?raw";

const desaturate = wgslFn(desaturateSource);
```

For three.js, the file must start with `fn`, so it cannot begin with a comment: `wgslFn` throws on a leading comment, which you will see in `vite dev`.

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `include` | `RegExp` | `/\.wgsl($\|\?)/` | Modules to obfuscate, tested against the module id with its query. |
| `preserve` | `string[]` | `[]` | Names never renamed. |
| `strict` | `boolean` | `false` | Turn the warnings about names kept for safety, and about modules not obfuscated with the others, into errors. |
| `leakCheck` | `"off" \| "warn" \| "error"` | `"error"` | Fail when WGSL the plugin does not obfuscate uses a renamed name: a shader in a `wgslCalls` call (`"warn"` warns), or a `.wgsl` file that ships as written (always fails). |
| `leakIgnore` | `string[]` | `[]` | Names the leak check ignores. |
| `wgslCalls` | `string[]` | `["wgslFn", "wgsl", "createShaderModule"]` | Calls whose literal argument the leak check reads; `[]` turns that part off. |
| `topLevel` | `"rename" \| "keep"` | `"rename"` | `"keep"` renames only parameters and locals. |
| `wgslFnParams` | `"keep" \| "rename"` | `"keep"` | `"rename"` renames the parameters of a function that starts a file; safe only if every `wgslFn` call passes arguments by position. |
| `prefix` | `string` | `"_"` | Start of every generated name. |
| `renameIdents` | `boolean` | `true` | `false` renames nothing: it only removes comments and collapses whitespace. |
| `collapseWhitespace` | `boolean` | `true` | `false` keeps line breaks and indentation. |
| `verify` | `boolean` | `true` | Check token structure, resolved bindings and rename-map consistency; fail the build on a mismatch. |

## Build warnings

The build warns, once per cause, about every name kept because renaming it could not be proven safe, with where and what would let the plugin rename it. `strict: true` turns these warnings into build errors.

## Limits

The plugin checks structure, not meaning. It rejects what is plainly not WGSL, such as `#include` or `${...}`, but it is not a compiler: a type error or a missing `;` inside an expression passes through unchanged. The self-checks (`verify`) catch a renaming mistake, not a shader that was wrong to begin with. Your WGSL compiler remains the authority.

What the plugin cannot see or hide, and what covers it:

- WGSL that is not in the build, such as a shader fetched from a server: add the names it uses to `preserve`.
- A `.wgsl` file loaded with `new URL(..., import.meta.url)` or `?url` is not read before renaming. If it uses a renamed name, the build fails; import it with `?raw`, or add the names to `preserve`.
- WGSL in a JS string that is not passed straight to a `wgslCalls` call, a string holding just a name, as a lookup does, and names built at runtime, such as `"base" + "Color"`: `preserve` the names they use.
- Outside code that might use a generated name (`_a`, `_b`, ...): set a `prefix` that it does not use.
- JS that matches shader names to object keys, as reflection libraries do (`uniforms.set({ viewProj })`): `preserve`, or `topLevel: "keep"`.
- Modules the build marks as external, including dependencies that SSR builds externalise: `preserve` the names their WGSL uses.
- Workers: a worker bundle is a separate build with its own project. List the plugin in `worker.plugins` too, and do not join shader text across that boundary.
- Source maps: the plugin keeps `.wgsl` modules out of them, but WGSL in JS files stays in. Do not deploy `.map` files if that matters.
- Obfuscation does not hide numbers, operators, builtin calls or the shape of the maths.

## Supported Vite versions

Vite 5, 6 and 7, and Vite 8 from 8.0.9 (8.0.0 to 8.0.8 write the original shaders into source maps). Node.js 18 or later.

## Migrating from 0.1.x

- A name gets the same new name in every file of the build, so shaders joined at runtime still compile.
- Names a shader uses but does not declare are no longer renamed.
- More names are kept (see [What is kept](#what-is-kept)), and the build warns about the ones kept for safety.
- Constants are no longer inlined. `inlineConsts` is ignored with a warning.
- Unexpanded `#include` and `${...}`, unbalanced brackets and other detected structural errors fail the build. This is not full WGSL validation.
- `include` defaults to `/\.wgsl($|\?)/`, and only modules imported with `?raw` or without a query are obfuscated.
- With `collapseWhitespace: false`, each comment becomes one space.
- The plugin runs with `enforce: "post"`, after normal plugins such as a preprocessor that expands `#include`.
- `obfuscate()` throws on detected structural errors. For shaders joined at runtime, use `obfuscateProject()`.
- New options: `strict`, `leakCheck`, `leakIgnore`, `wgslCalls`, `topLevel`, `wgslFnParams`, `prefix` and `verify`.
- The peer range is `^5.0.0 || ^6.0.0 || ^7.0.0 || ^8.0.9`.

## Standalone API

`obfuscate(source, options?)` obfuscates one shader. `obfuscateProject(files, options?)` obfuscates a set of shaders, keyed by any id, as one project and returns `{ files, report }`.

Files that are linked together at runtime must be passed to `obfuscateProject` together: obfuscated separately, their shared names no longer match. If other WGSL uses their names, list those names in `preserve`.

## License

MIT
