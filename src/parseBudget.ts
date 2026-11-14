export const MAX_PARSE_CONTAINERS = 100000;
const MAX_PARSE_DEPTH = 512;

// Share one budget across a document's JSON/XML entries before allocating parsed objects.
export function checkParseBudget(
  text: string,
  xml = false,
  budget = { count: 0 },
): void {
  let quoted = false, escaped = false, depth = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    if (xml) {
      if (char === 60 && ++budget.count > MAX_PARSE_CONTAINERS)
        throw new Error("Document exceeds the 100000 structure limit");
    } else if (quoted) {
      if (escaped) escaped = false;
      else if (char === 92) escaped = true;
      else if (char === 34) quoted = false;
    } else if (char === 34) quoted = true;
    else if (char === 123 || char === 91) {
      if (++budget.count > MAX_PARSE_CONTAINERS || ++depth > MAX_PARSE_DEPTH)
        throw new Error("Document exceeds the 100000 structure or 512 nesting limit");
    } else if (char === 125 || char === 93) depth--;
  }
}
