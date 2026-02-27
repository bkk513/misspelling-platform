export type SuggestedVariant = {
  value: string;
  source: "llm" | "cache" | "heuristic" | "manual";
  selected: boolean;
};

const KEY_PREFIX = "mp-variants:";

export function loadVariants(word: string): SuggestedVariant[] {
  try {
    const raw = window.localStorage.getItem(`${KEY_PREFIX}${word.toLowerCase()}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SuggestedVariant[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveVariants(word: string, items: SuggestedVariant[]) {
  window.localStorage.setItem(`${KEY_PREFIX}${word.toLowerCase()}`, JSON.stringify(items));
}

export function mergeVariants(existing: SuggestedVariant[], values: string[], source: SuggestedVariant["source"]) {
  const byValue = new Map(existing.map((v) => [v.value.toLowerCase(), v]));
  for (const value of values) {
    const cleaned = value.trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (!byValue.has(key)) {
      byValue.set(key, { value: cleaned, source, selected: true });
    }
  }
  return Array.from(byValue.values());
}
