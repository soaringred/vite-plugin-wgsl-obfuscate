// A minimal source map reader, so that a message can give the line of the module as written, before
// other plugins (TypeScript, for one) transformed it.

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** [generated column, source index, original line, original column] per segment, per generated line. */
type Segment = [number, number, number, number];

function decodeVlq(text: string): number[] {
  const values: number[] = [];
  let value = 0;
  let shift = 0;
  for (const char of text) {
    const digit = BASE64.indexOf(char);
    if (digit < 0) throw new Error(`invalid VLQ character ${JSON.stringify(char)}`);
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
    } else {
      values.push(value & 1 ? -(value >>> 1) : value >>> 1);
      value = 0;
      shift = 0;
    }
  }
  return values;
}

export function decodeMappings(mappings: string): Segment[][] {
  const lines: Segment[][] = [];
  let source = 0;
  let originalLine = 0;
  let originalColumn = 0;
  for (const line of mappings.split(";")) {
    const segments: Segment[] = [];
    let column = 0;
    for (const text of line.split(",")) {
      if (text === "") continue;
      const fields = decodeVlq(text);
      column += fields[0];
      if (fields.length >= 4) {
        source += fields[1];
        originalLine += fields[2];
        originalColumn += fields[3];
        segments.push([column, source, originalLine, originalColumn]);
      }
    }
    lines.push(segments);
  }
  return lines;
}

/**
 * The original position of a generated one (both 0-based), from the last
 * segment at or before it on its line, or null when nothing maps it.
 */
export function originalPositionFor(
  map: { mappings: string; sources: string[] },
  line: number,
  column: number,
): { source: string; line: number; column: number } | null {
  const segments = decodeMappings(map.mappings)[line] ?? [];
  let found: Segment | undefined;
  for (const segment of segments) {
    if (segment[0] > column) break;
    found = segment;
  }
  return found ? { source: map.sources[found[1]], line: found[2], column: found[3] } : null;
}

/** 0-based line and column of `offset` in `text`, with lines split at `\n` as source maps split them. */
export function positionOf(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset).split("\n");
  return { line: before.length - 1, column: before[before.length - 1].length };
}
