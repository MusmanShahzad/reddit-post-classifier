const ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  b: "\b",
  f: "\f",
  '"': '"',
  "\\": "\\",
  "/": "/",
};

/**
 * Reads a top-level string field from JSON that is still arriving. Returns
 * the text so far, or null before the field starts. An escape cut off at
 * the end of the chunk is held back until the next chunk completes it.
 */
export function partialStringField(raw: string, key: string): string | null {
  const start = new RegExp(`"${key}"\\s*:\\s*"`).exec(raw);
  if (!start) return null;

  let out = "";
  let i = start.index + start[0].length;
  while (i < raw.length) {
    const ch = raw[i]!;
    if (ch === '"') return out;
    if (ch !== "\\") {
      out += ch;
      i += 1;
      continue;
    }

    const next = raw[i + 1];
    if (next === undefined) return out;
    if (next === "u") {
      const hex = raw.slice(i + 2, i + 6);
      if (hex.length < 4) return out;
      out += String.fromCharCode(Number.parseInt(hex, 16));
      i += 6;
      continue;
    }
    out += ESCAPES[next] ?? next;
    i += 2;
  }
  return out;
}
