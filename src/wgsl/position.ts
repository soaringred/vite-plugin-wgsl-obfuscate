// Line and column of an offset, as WGSL counts lines: LF, VT, FF, CR, CR LF (one break), NEL, LS and PS
// each end one. Columns are 1-based UTF-16 code units, as in a JS string.

export interface Position {
  /** 1-based. */
  line: number;
  /** 1-based, in UTF-16 code units. */
  column: number;
}

/** True when the code unit at `i` ends a line. The CR of a CR LF does not; its LF does. */
function endsLine(source: string, i: number): boolean {
  switch (source.charCodeAt(i)) {
    case 0x0a:
    case 0x0b:
    case 0x0c:
    case 0x85:
    case 0x2028:
    case 0x2029:
      return true;
    case 0x0d:
      return source.charCodeAt(i + 1) !== 0x0a;
    default:
      return false;
  }
}

/** Offset-to-position lookup for `source`. It indexes the lines once, so many lookups stay linear. */
export function positionsIn(source: string): (offset: number) => Position {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (endsLine(source, i)) starts.push(i + 1);
  return (offset) => {
    const at = Math.max(0, Math.min(offset, source.length));
    // The last line start at or before `at`
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= at) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: at - starts[lo] + 1 };
  };
}

/** 1-based line and column of `offset` in `source`. */
export function positionAt(source: string, offset: number): Position {
  return positionsIn(source)(offset);
}
