/** Escape a string for safe insertion into HTML text content. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Coerce an unknown prop value into a trimmed string, falling back to "". */
export function asString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

/** Coerce an unknown prop value into an array of strings. */
export function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((item) => asString(item)).filter((s) => s.length > 0);
}

/** Format seconds to a number GSAP understands. */
export function formatSec(n: number): string {
  return n.toFixed(2).replace(/\.?0+$/, "");
}
