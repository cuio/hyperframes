/**
 * Pure helpers for the Storyline view. Kept React-free so they're cheap to
 * test and stay reusable for both the UI and any future server-side analysis
 * (lint, retention scoring, AI-action arg-building).
 *
 * Design intent: a "scene" in the Storyline view is the *audio* (the narration
 * the audience actually hears) wrapped in a frame of visual decisions. These
 * helpers reduce that frame to the small handful of facts that matter for
 * directorial choices:
 *
 *   - on-screen text — what the headline / subtitle says, per template
 *   - emphasis word — the word that's been told to land louder
 *   - data points — concrete numbers / percents / money in the narration
 *   - visual word budget — how many on-screen words this template can carry
 *
 * Everything is conservative: missing fields don't throw, malformed shapes
 * fall through to safe defaults, and every list helper is bounded so a
 * malformed prop blob can't take the panel down.
 */

export interface StorylineSceneInput {
  id: string;
  text: string;
  template: string;
  hook?: boolean;
  durationHint?: number;
  reasoning?: string;
  voiceId?: string;
  props: Record<string, unknown>;
  audio?: {
    path?: string;
    durationSeconds?: number;
  };
}

/**
 * Per-template upper bound on the on-screen-text word count. Mirrors the
 * playbook budget the planner is held to. Used in the UI to surface a green
 * "✓" when copy fits and an amber "⚠" when it overshoots — not enforced here.
 */
export const VISUAL_WORD_BUDGET: Record<string, number> = {
  "hook-bigtext": 8,
  "hook-vhs-rip": 5,
  "kinetic-words": 6,
  "editorial-serif": 4,
  "hook-statreveal": 12,
  "aroll-text": 28,
  "concept-callout": 24,
  comparison: 20,
  quote: 30,
  "outro-cta": 14,
  "image-scene": 12,
  "chart-scene": 16,
};

/**
 * Count words in a phrase. Splits on whitespace and ignores empty fragments
 * so leading/trailing space and runs of spaces don't inflate the count.
 */
export function countWords(text: string | undefined | null): number {
  if (!text) return 0;
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

/**
 * Pull the headline that's actually rendered on screen for a scene, given its
 * template + props. Different templates carry the headline in different prop
 * names — we centralise the lookup so the card UI doesn't have to know each
 * template's contract.
 */
export function pickOnScreenHeadline(
  template: string,
  props: Record<string, unknown>,
): string | null {
  if (template === "kinetic-words") {
    const words = props.words;
    if (Array.isArray(words)) {
      return words
        .map((w) => (typeof w === "string" ? w : ""))
        .filter((w) => w.length > 0)
        .join(" ");
    }
    return null;
  }
  if (template === "editorial-serif") {
    return typeof props.phrase === "string" ? props.phrase : null;
  }
  if (template === "hook-statreveal") {
    return typeof props.value === "string" ? props.value : null;
  }
  // Default contract: title is the headline (hook-bigtext, hook-vhs-rip,
  // aroll-text, concept-callout, comparison, image-scene, chart-scene).
  return typeof props.title === "string" ? props.title : null;
}

/**
 * Pull the secondary line that supports the headline (subtext / subhead /
 * label). Used for the second line in the card preview.
 */
export function pickOnScreenSubtext(
  template: string,
  props: Record<string, unknown>,
): string | null {
  if (template === "hook-statreveal") {
    return typeof props.label === "string" ? props.label : null;
  }
  if (template === "image-scene") {
    return typeof props.subhead === "string" ? props.subhead : null;
  }
  if (typeof props.subtitle === "string") return props.subtitle;
  if (typeof props.subtext === "string") return props.subtext;
  return null;
}

/**
 * Extract concrete numerical claims from the narration so the card can show
 * the data backbone of each scene (numbers / percentages / money).
 *
 * Conservative regex: each match is a contiguous span of digits-and-decimals,
 * optionally prefixed by `$` and optionally suffixed by `%` / `B` / `M` / `K`
 * / "billion" / "million" / "trillion". Capped at 6 hits to keep the panel
 * readable.
 */
const DATA_POINT_RE =
  /\$?\d{1,3}(?:[\d,]*\d)?(?:\.\d+)?(?:\s?%|\s?(?:billion|million|trillion|B|M|K|T)\b)?/gi;

export function extractDataPoints(text: string | undefined | null, max = 6): string[] {
  if (!text) return [];
  const matches = text.match(DATA_POINT_RE) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of matches) {
    const cleaned = raw.trim();
    // Drop bare "1" / "2" / etc.: those are ordinals, not data — keep only
    // numbers that have a unit, decimal, or comma (signals a real claim).
    if (!/[%$.,\s]|[A-Za-z]/.test(cleaned) && cleaned.length < 2) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Pull the directorial accent — which word in the headline gets the louder
 * treatment (italic accent in hook-bigtext, emphasis-index in kinetic-words).
 * Returns null when no accent has been set, so the card can offer "Suggest
 * emphasis" as an AI action.
 */
export function pickAccentWord(template: string, props: Record<string, unknown>): string | null {
  if (template === "kinetic-words") {
    const idxRaw = Number(props.emphasisIndex);
    const words = props.words;
    if (Array.isArray(words) && Number.isFinite(idxRaw) && idxRaw >= 0 && idxRaw < words.length) {
      const w = words[idxRaw];
      return typeof w === "string" ? w : null;
    }
    if (Array.isArray(words) && words.length > 0) {
      const last = words[words.length - 1];
      return typeof last === "string" ? last : null;
    }
    return null;
  }
  return typeof props.accentWord === "string" ? props.accentWord : null;
}

/**
 * Pull the imageId assigned to the scene (either via the planner directly or
 * the visual director). Returns null for typography-only scenes.
 */
export function pickImageId(props: Record<string, unknown>): string | null {
  return typeof props.imageId === "string" && props.imageId.length > 0 ? props.imageId : null;
}

/**
 * Word-budget audit for a scene's on-screen copy. Returns:
 *   - actual word count
 *   - the budget for this template (or null if unknown)
 *   - status: "ok" / "warn" (within 1.25× budget) / "over" (above 1.25×)
 *
 * Drives the green ✓ / amber ⚠ chip on the card without the UI having to
 * know each template's budget by hand.
 */
export type WordBudgetStatus = "ok" | "warn" | "over" | "unknown";
export interface WordBudgetAudit {
  count: number;
  budget: number | null;
  status: WordBudgetStatus;
}

export function auditWordBudget(template: string, headline: string | null): WordBudgetAudit {
  const count = countWords(headline);
  const budget = VISUAL_WORD_BUDGET[template] ?? null;
  if (budget == null) return { count, budget: null, status: "unknown" };
  if (count === 0) return { count: 0, budget, status: "unknown" };
  if (count <= budget) return { count, budget, status: "ok" };
  if (count <= Math.ceil(budget * 1.25)) return { count, budget, status: "warn" };
  return { count, budget, status: "over" };
}

/**
 * Compose a one-line "scene summary" that condenses everything in a card
 * header: id · template · duration · hook flag. Used when the card is
 * collapsed and we still want a scannable row.
 */
export function summarizeScene(scene: StorylineSceneInput): {
  id: string;
  template: string;
  durationLabel: string;
  hook: boolean;
} {
  const dur = scene.audio?.durationSeconds ?? scene.durationHint ?? 0;
  return {
    id: scene.id,
    template: scene.template,
    durationLabel: dur > 0 ? `${dur.toFixed(2)}s` : "—",
    hook: scene.hook === true,
  };
}
