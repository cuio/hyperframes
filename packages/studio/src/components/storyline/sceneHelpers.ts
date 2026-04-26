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

/**
 * For each template, the prop name that carries the on-screen headline. Lets
 * the inline-edit UI write back the user's text without knowing each
 * template's contract by hand. Mirrors the server-side TEMPLATE_HEADLINE_FIELD
 * map — kept in sync by intent so a missed entry on either side falls through
 * to the safe default ("title").
 */
export const TEMPLATE_HEADLINE_FIELD: Record<string, string> = {
  "hook-bigtext": "title",
  "hook-vhs-rip": "title",
  "aroll-text": "title",
  "concept-callout": "title",
  "image-scene": "headline",
  "chart-scene": "title",
  comparison: "title",
  quote: "quote",
  "outro-cta": "title",
  "editorial-serif": "phrase",
  "hook-statreveal": "label",
};

export const TEMPLATE_SUBTEXT_FIELD: Record<string, string> = {
  "hook-bigtext": "subtext",
  "hook-vhs-rip": "sourceTag",
  "aroll-text": "body",
  "concept-callout": "subtitle",
  "image-scene": "subhead",
  "chart-scene": "subtitle",
  comparison: "subtitle",
  quote: "attribution",
  "outro-cta": "subtitle",
  "editorial-serif": "eyebrow",
  "hook-statreveal": "label",
};

/**
 * Returns the prop key that the inline-edit UI should write the headline back
 * to. For kinetic-words there's no single key (the headline is an array) —
 * caller should branch on `null` and fall back to a different editor.
 */
export function getEditableHeadlineField(template: string): string | null {
  if (template === "kinetic-words") return null;
  return TEMPLATE_HEADLINE_FIELD[template] ?? "title";
}

export function getEditableSubtextField(template: string): string | null {
  return TEMPLATE_SUBTEXT_FIELD[template] ?? null;
}

/**
 * Build an updated props blob with a single edit applied. Used by the inline
 * editor — the caller passes the existing props, the field name, and the new
 * value; we return the merged blob ready to PUT.
 *
 * For kinetic-words the headline is `words[]` rather than a string field.
 * The caller passes `field === "words"` and a whitespace-separated string;
 * we split into the right shape.
 */
export function applyInlineEdit(
  props: Record<string, unknown>,
  field: string,
  value: string,
): Record<string, unknown> {
  if (field === "words") {
    const words = value
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 0);
    return {
      ...props,
      words,
      // Re-anchor emphasis to the final word so the punch stays at the end
      // of the array unless the user intentionally moves it elsewhere.
      emphasisIndex: Math.max(0, words.length - 1),
    };
  }
  return { ...props, [field]: value };
}

/**
 * Decide which scene is "focal" given the current scroll position of a
 * vertical card list. The focal scene is the one whose card most overlaps a
 * horizontal "focus line" near the top of the viewport — typically 1/3 of
 * the way down. Returns the index of the focal card, or -1 when no card
 * intersects the focus line.
 *
 * Kept pure (no DOM access) so it's cheap to test. Callers measure card
 * tops + heights against the viewport and feed this helper rectangles.
 */
export interface CardRect {
  /** Card top, relative to the scroll container's viewport top (px). */
  top: number;
  /** Card height in px. */
  height: number;
}

export function pickFocalCardIndex(
  cards: CardRect[],
  viewportHeight: number,
  focusLineFraction = 0.33,
): number {
  if (cards.length === 0 || viewportHeight <= 0) return -1;
  const focusLine = viewportHeight * focusLineFraction;
  // First pass: any card straddling the focus line wins.
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i]!;
    const bottom = c.top + c.height;
    if (c.top <= focusLine && bottom >= focusLine) return i;
  }
  // Fallback: pick the card whose center is closest to the focus line.
  // Useful when no card straddles (e.g. spacing is wider than card height).
  let bestIdx = -1;
  let bestDist = Infinity;
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i]!;
    const center = c.top + c.height / 2;
    const dist = Math.abs(center - focusLine);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}
