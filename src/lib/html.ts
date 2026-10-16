const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  "#39": "'",
  nbsp: " ",
};

/**
 * YouTube's search API returns titles with HTML entities baked into the string
 * (e.g. `Rock &amp; Roll &#39;98`). React escapes on render, so decoding here
 * is what keeps the UI from showing raw entity soup.
 */
export function decodeEntities(input: string): string {
  if (!input) return "";
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    const key = body.toLowerCase();
    if (NAMED[key] !== undefined) return NAMED[key];
    if (key.startsWith("#x")) {
      const code = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (key.startsWith("#")) {
      const code = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return match;
  });
}

export function stripTags(input: string): string {
  return decodeEntities((input ?? "").replace(/<[^>]*>/g, ""));
}