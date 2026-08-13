// The scan is asked for values that would actually pass, and mostly gives
// them. What it cannot invent is a value with no source in the code, and the
// fallback for that is the name of the type. Sending "severity": "string"
// fails validation somewhere confusing, so the body editor says which fields
// are still standing in for something.

const TYPE_WORDS = /^(string|number|boolean|integer|float|date|datetime|object|array|null|any)$/i;

export function placeholderFields(body: string): string[] {
  if (!body.trim()) return [];

  let parsed: any;
  try {
    parsed = JSON.parse(body);
  } catch {
    // half typed json is the user's business, not ours
    return [];
  }

  const out: string[] = [];
  const walk = (value: any, path: string, depth: number) => {
    if (depth > 4 || value === null || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      const here = path ? `${path}.${key}` : key;
      if (typeof child === "string" && TYPE_WORDS.test(child.trim())) {
        out.push(here);
      } else {
        walk(child, here, depth + 1);
      }
    }
  };
  walk(parsed, "", 0);
  return out;
}
