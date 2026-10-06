import { tokenize } from "@/wgsl/tokenizer";
import { positionAt } from "@/wgsl/position";
import { PLACEHOLDER_PREFIX, findPlaceholders } from "@/vite/placeholders";
import { list } from "@/vite/report";

// Checks on the finished bundle, in `generateBundle`.

/** A chunk or an asset, as far as the checks need it. */
export type BundleFile =
  | { type: "chunk"; code: string }
  | { type: "asset"; source: string | Uint8Array; names?: string[]; originalFileNames?: string[] };

/** The text of an asset, or null when it cannot contain `needle`. Binary assets are read as Latin-1. */
function assetText(source: string | Uint8Array, needle?: string): string | null {
  if (typeof source === "string") return needle === undefined || source.includes(needle) ? source : null;
  const buffer = Buffer.from(source.buffer, source.byteOffset, source.byteLength);
  if (needle !== undefined && !buffer.includes(needle)) return null;
  return buffer.toString(needle === undefined ? "utf8" : "latin1");
}

/** Every placeholder left in the bundle, as "file (standing for module)". `describe` gives undefined for a foreign one. */
export function leftoverPlaceholders(
  bundle: Record<string, BundleFile>,
  describe: (placeholder: string) => string | undefined,
): string[] {
  const found = new Set<string>();
  for (const [fileName, file] of Object.entries(bundle)) {
    const text = file.type === "chunk" ? file.code : assetText(file.source, PLACEHOLDER_PREFIX);
    if (text === null) continue;
    for (const { placeholder } of findPlaceholders(text)) {
      const what = describe(placeholder);
      found.add(`${fileName} (${what ? `standing for ${what}` : "not made in this build"})`);
    }
  }
  return [...found];
}

export function leftoverMessage(found: string[], plugin: string): string {
  return (
    `${found.length === 1 ? "A placeholder" : `${found.length} placeholders`} of ${plugin} ` +
    `${found.length === 1 ? "is" : "are"} left in the bundle: ${list(found)}.\n` +
    "It reached the output without passing through the plugin's `renderChunk`, for example because another plugin " +
    "copied a module's code into an asset or changed a chunk after `renderChunk`, so the shader would ship as a " +
    "placeholder. Keep that plugin away from the shader, or leave the shader out of `include` so that it ships as written."
  );
}

/** A WGSL file that ships as written: emitted as an asset, or inlined into a chunk as a data URL. */
const WGSL_DATA_URL = /data:text\/wgsl((?:;[\w.+-]+(?:=[\w.+-]*)?)*),([^\s"'`()<>]*)/g;

/** The text of a WGSL data URL's payload, or null when it does not decode. */
function dataUrlText(params: string, payload: string): string | null {
  try {
    return /;base64$/i.test(params) ? Buffer.from(payload, "base64").toString("utf8") : decodeURIComponent(payload);
  } catch {
    return null;
  }
}

/** The first use of each renamed name in WGSL `text`, as "`name` at line:column", or empty. */
export function renamedUses(text: string, renamed: (name: string) => boolean): string[] {
  const first = new Map<string, number>();
  for (const t of tokenize(text)) if (t.type === "ident" && renamed(t.value) && !first.has(t.value)) first.set(t.value, t.start);
  return [...first.keys()].sort().map((name) => {
    const { line, column } = positionAt(text, first.get(name)!);
    return `\`${name}\` at ${line}:${column}`;
  });
}

/**
 * WGSL files in the bundle that use renamed names: assets that `isWgslAsset` picks, and data URLs of type
 * `text/wgsl`, which Vite inlines instead of small assets. `inlinedFrom` names the file behind a data URL if known.
 * Null when there are none.
 */
export function wgslFileLeaks(
  bundle: Record<string, BundleFile>,
  renamed: (name: string) => boolean,
  isWgslAsset: (sources: string[]) => boolean,
  inlinedFrom: (url: string) => string | undefined,
): string | null {
  const hits: string[] = [];
  for (const [fileName, file] of Object.entries(bundle)) {
    if (file.type === "chunk") {
      if (!file.code.includes("data:text/wgsl")) continue;
      for (const [url, params, payload] of file.code.matchAll(WGSL_DATA_URL)) {
        const text = dataUrlText(params, payload);
        const uses = text === null ? [] : renamedUses(text, renamed);
        if (uses.length > 0) hits.push(`  - ${inlinedFrom(url) ?? "a WGSL file"} (inlined into ${fileName}): ${uses.join(", ")}`);
      }
    } else if (isWgslAsset([...(file.originalFileNames ?? []), ...(file.names ?? []), fileName])) {
      const text = assetText(file.source);
      const uses = text === null ? [] : renamedUses(text, renamed);
      const source = file.originalFileNames?.length ? `${list(file.originalFileNames)} (emitted as ${fileName})` : fileName;
      if (uses.length > 0) hits.push(`  - ${source}: ${uses.join(", ")}`);
    }
  }
  if (hits.length === 0) return null;
  const one = hits.length === 1;
  return [
    `${one ? "A WGSL file that ships as written uses" : "WGSL files that ship as written use"} names that the plugin renamed:`,
    ...hits,
    `The plugin does not obfuscate ${one ? "it" : "them"}, for example because ${one ? "it is" : "they are"} imported ` +
      `with \`?url\` or loaded with \`new URL(..., import.meta.url)\`, so ${one ? "it" : "they"} will not compile if ` +
      "linked with the obfuscated shaders.",
    `Import ${one ? "it" : "each"} with \`?raw\` so that it is obfuscated with the other shaders, or add the names to ` +
      `\`preserve\`. If ${one ? "it" : "a file"} is used on its own and the match is a coincidence, add the names to ` +
      "`leakIgnore`.",
  ].join("\n");
}
