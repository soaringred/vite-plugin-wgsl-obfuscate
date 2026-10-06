import type { Doubt, NameSpace, SourcePosition } from "@/engine/project";

// The plugin's build warnings: the report's doubts and the modules it could not bind late. Names kept
// for the same reason, with the same action, share one message.

/** Most source positions listed per name. */
const MAX_SITES = 3;

/** `a`, `a and b`, `a, b and c`. */
export function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A name as the reader knows it: `.field` for a struct field. */
function nameText(name: string, space: NameSpace): string {
  return space === "member" ? `\`.${name}\`` : `\`${name}\``;
}

function spaceText(space: NameSpace): string {
  return space === "member" ? "struct field" : space === "local" ? "local" : "module scope";
}

function sitesText(sites: SourcePosition[]): string {
  const shown = sites.slice(0, MAX_SITES).map((s) => `${s.file}:${s.line}:${s.column}`);
  if (sites.length > MAX_SITES) shown.push(`${sites.length - MAX_SITES} more`);
  return list(shown);
}

/** A display id split at its query: `shaders/a.wgsl?url` gives `shaders/a.wgsl` and `url`. */
function splitQuery(module: string): { file: string; query: string | null } {
  const q = module.indexOf("?");
  return q < 0 ? { file: module, query: null } : { file: module.slice(0, q), query: module.slice(q + 1) };
}

/** "it" or "they" and friends, for `n` things. */
function pronouns(n: number) {
  const one = n === 1;
  return {
    it: one ? "it" : "them",
    It: one ? "It" : "They",
    is: one ? "is" : "are",
  };
}

/** The warning for names kept by `unproven-access` or `unknown-attribute` with the same action. */
function proofWarning(doubts: Doubt[]): string {
  const n = doubts.length;
  const fields = doubts.every((d) => d.space === "member");
  const what = fields ? plural(n, "WGSL struct field", "WGSL struct fields") : plural(n, "WGSL name", "WGSL names");
  const header =
    doubts[0].rule === "unproven-access"
      ? `Kept ${what} as written because renaming ${n === 1 ? "it" : "them"} could not be proven safe:`
      : `Kept ${what} as written because ${n === 1 ? "it is" : "they are"} used with an attribute the plugin does not know:`;
  const lines = [header];
  for (const d of doubts) {
    const sites = d.sites.length > 0 ? ` (${sitesText(d.sites)})` : ` (in ${list(d.files)})`;
    lines.push(`  - ${nameText(d.name, d.space)}, ${spaceText(d.space)}: ${d.reason}${sites}.`);
  }
  lines.push(`To rename ${n === 1 ? "it" : "them"}: ${doubts[0].action}.`);
  return lines.join("\n");
}

/** One warning per cause for the report's doubts. */
export function doubtWarnings(doubts: Doubt[]): string[] {
  const groups = new Map<string, Doubt[]>();
  for (const doubt of doubts) {
    const key = `${doubt.rule}\u0000${doubt.action}`;
    const group = groups.get(key) ?? [];
    group.push(doubt);
    groups.set(key, group);
  }
  return [...groups.values()].map(proofWarning);
}

/** The warning (or, with `strict`, the error) for WGSL modules obfuscated alone in `transform`. */
export function bareWarning(files: string[], plugin: string): string {
  const n = files.length;
  const p = pronouns(n);
  return (
    `${plural(n, "WGSL file was", "WGSL files were")} obfuscated alone, because ${n === 1 ? "it" : "they"} reached the ` +
    `plugin as WGSL text rather than as a string module: ${list(files)}.\n` +
    `A plugin that runs later turns ${p.it} into JS, so this plugin could not wait until it had seen every module. ` +
    `${n === 1 ? "Its" : "Their"} module-scope names and struct fields stay as written (\`topLevel: "keep"\`); only ` +
    "locals are renamed.\n" +
    `To obfuscate ${p.it} fully, import ${p.it} with \`?raw\`, or make the plugin that wraps ${p.it} run before ${plugin}.`
  );
}

/** The leak check's message for WGSL obfuscated alone that uses names the other shaders' project renamed. */
export function bareLeakMessage(hits: string[], plugin: string): string {
  const p = pronouns(hits.length);
  return [
    `${hits.length === 1 ? "A WGSL file obfuscated alone uses" : "WGSL files obfuscated alone use"} names that the ` +
      `plugin renamed in the other shaders, so ${p.it === "it" ? "it" : "they"} will not link with them:`,
    ...hits,
    `Import ${p.it} with \`?raw\`, or make the plugin that wraps ${p.it} run before ${plugin}, so that ${p.it} ${p.is} ` +
      "obfuscated with the others; or add the names to `preserve`.",
  ].join("\n");
}

/** The warning (or, with `strict`, the error) for modules that `include` matches but that are not recognised as WGSL. */
export function unrecognisedWarning(modules: string[]): string {
  const n = modules.length;
  const p = pronouns(n);
  // A module imported with `?raw` was changed by another plugin; one without a query was loaded as JS by one
  const raw = modules.filter((m) => splitQuery(m).query === "raw");
  const plain = modules.filter((m) => splitQuery(m).query !== "raw");
  const fixes = [`If ${n === 1 ? "it is" : "they are"} not WGSL, narrow \`include\` so that it does not match ${p.it}.`];
  if (plain.length > 0) {
    const q = pronouns(plain.length);
    fixes.push(
      `If ${raw.length > 0 ? list(plain) : q.it} ${q.is} WGSL, import ${q.it} with \`?raw\`, or make the plugin that ` +
        `loads ${q.it} produce \`export default\` and one string.`,
    );
  }
  if (raw.length > 0) {
    const q = pronouns(raw.length);
    fixes.push(
      `${list(raw)} ${q.is} already imported with \`?raw\`, so another plugin changed ${q.it} before this one ran. ` +
        `If ${q.it === "it" ? "it is" : "they are"} WGSL, make that plugin leave ${q.it} as \`export default\` and one ` +
        `string, or keep ${q.it} out of that plugin.`,
    );
  }
  return (
    `Left ${plural(n, "module", "modules")} as ${n === 1 ? "it is" : "they are"} although \`include\` matches ` +
    `${p.it}: ${list(modules)}.\n` +
    "The plugin expects WGSL text, or a module that is `export default` and one string (as with `?raw`), so it cannot " +
    `tell which part of ${p.it} is WGSL, and does not check ${p.it}: WGSL in ${p.it} that uses a name the other ` +
    "shaders declare will not link with them.\n" +
    fixes.join(" ")
  );
}
