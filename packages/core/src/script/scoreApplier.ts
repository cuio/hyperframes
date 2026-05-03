/**
 * scoreApplier — convert Haiku recommendations into safe automated edits.
 *
 * Drives `hyperframes score --apply-top N`. Takes the SceneRecommendations
 * from scriptScorer + the planned Script, returns the edited Script + a
 * report of what was applied / skipped.
 *
 * Conservative by design: only the recommendation types we can SAFELY
 * automate get applied. Recs that need human judgment (split-scene,
 * merge-scene, cross-scene rewrites) are reported as skipped with a
 * reason so the author can act manually.
 *
 * What we automate:
 *   - rewrite-text     — set scene.props[field] from a parsed "→ X" pattern
 *                        in the suggestion (or the whole suggestion text
 *                        if no arrow). Only applies if confidence === "high".
 *   - duration-adjust  — parse "N s" / "Ns" target out of the suggestion,
 *                        write to scene.durationHint.
 *   - template-swap    — parse target template id from the suggestion;
 *                        only applies if the target id exists in the
 *                        catalog.
 *   - theme-shift      — parse a theme name; only applies if it's a known
 *                        registered theme.
 *
 * What we skip:
 *   - split-scene / merge-scene — structural changes need narrative
 *     judgment; we surface but don't apply.
 *   - add-hook — requires generating new content; surfaced for the
 *     author.
 *
 * Returns a tuple of (edited Script, ApplyReport) — the CLI writes the
 * Script back to disk and prints the report.
 */

import type { Script, SceneRef } from "./types.js";
import type { SceneRecommendation, Confidence } from "./scriptScorer.js";

/** Result of one attempted recommendation application. */
export interface AppliedRecommendation {
  recommendation: SceneRecommendation;
  applied: boolean;
  /** Why we didn't apply (null if applied successfully). */
  skipReason: string | null;
  /** Diff summary — "title: 'BOTS' → '49% BOTS'". */
  diff: string | null;
}

export interface ApplyReport {
  applied: AppliedRecommendation[];
  skipped: AppliedRecommendation[];
}

export interface ApplyOptions {
  /** Top N recommendations to consider (default: all). */
  topN?: number;
  /** Minimum confidence to apply. Default "high". */
  minConfidence?: Confidence;
  /** Known template ids — used to validate template-swap recs. */
  knownTemplates?: ReadonlySet<string>;
  /** Known theme names — used to validate theme-shift recs. */
  knownThemes?: ReadonlySet<string>;
}

const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

/**
 * Apply the top N recommendations to a Script, returning the edited
 * script + a report of what landed and what was skipped.
 */
export function applyRecommendations(
  script: Script,
  recommendations: SceneRecommendation[],
  opts: ApplyOptions = {},
): { script: Script; report: ApplyReport } {
  const minRank = CONFIDENCE_RANK[opts.minConfidence ?? "high"];
  const limit = opts.topN ?? recommendations.length;
  const candidates = recommendations.slice(0, limit);
  const knownTemplates = opts.knownTemplates;
  const knownThemes = opts.knownThemes;

  const applied: AppliedRecommendation[] = [];
  const skipped: AppliedRecommendation[] = [];

  // Deep-clone scenes so we don't mutate caller state.
  const sceneById = new Map<string, SceneRef>();
  const scenes = script.scenes.map((s) => {
    const clone: SceneRef = {
      ...s,
      props: { ...(s.props ?? {}) },
    };
    sceneById.set(clone.id, clone);
    return clone;
  });

  for (const rec of candidates) {
    if (CONFIDENCE_RANK[rec.confidence] < minRank) {
      skipped.push({
        recommendation: rec,
        applied: false,
        skipReason: `confidence ${rec.confidence} below threshold ${opts.minConfidence ?? "high"}`,
        diff: null,
      });
      continue;
    }
    const target = sceneById.get(rec.sceneId);
    if (!target) {
      skipped.push({
        recommendation: rec,
        applied: false,
        skipReason: `scene "${rec.sceneId}" not found`,
        diff: null,
      });
      continue;
    }
    const result = applyOne(target, rec, knownTemplates, knownThemes);
    if (result.applied) applied.push(result);
    else skipped.push(result);
  }

  return {
    script: { meta: script.meta, scenes },
    report: { applied, skipped },
  };
}

// ── Per-recommendation handlers ────────────────────────────────────────────

function applyOne(
  scene: SceneRef,
  rec: SceneRecommendation,
  knownTemplates?: ReadonlySet<string>,
  knownThemes?: ReadonlySet<string>,
): AppliedRecommendation {
  switch (rec.type) {
    case "rewrite-text":
      return applyRewriteText(scene, rec);
    case "duration-adjust":
      return applyDurationAdjust(scene, rec);
    case "template-swap":
      return applyTemplateSwap(scene, rec, knownTemplates);
    case "theme-shift":
      return applyThemeShift(scene, rec, knownThemes);
    case "split-scene":
    case "merge-scene":
    case "add-hook":
      return {
        recommendation: rec,
        applied: false,
        skipReason: `${rec.type} requires narrative judgment — surfaced but not auto-applied`,
        diff: null,
      };
    default:
      return {
        recommendation: rec,
        applied: false,
        skipReason: `unknown recommendation type ${rec.type}`,
        diff: null,
      };
  }
}

/**
 * Parse a rewrite-text suggestion. The model is taught to write things like:
 *   "'BOTS' is generic — try '49% BOTS'"
 *   "title: 'X' → 'Y'"
 *   "rewrite to 'Y'"
 * We try a few patterns to extract the target string.
 */
function applyRewriteText(scene: SceneRef, rec: SceneRecommendation): AppliedRecommendation {
  if (!rec.field) {
    return {
      recommendation: rec,
      applied: false,
      skipReason: "rewrite-text without `field` — can't infer which prop to rewrite",
      diff: null,
    };
  }
  const newValue = parseRewriteTarget(rec.suggestion);
  if (!newValue) {
    return {
      recommendation: rec,
      applied: false,
      skipReason: "couldn't parse target text from suggestion (no quoted string after → or 'try')",
      diff: null,
    };
  }
  const props = scene.props as Record<string, unknown>;
  const oldValue = props[rec.field];
  if (typeof oldValue !== "string" && oldValue !== undefined) {
    return {
      recommendation: rec,
      applied: false,
      skipReason: `prop "${rec.field}" is not a string`,
      diff: null,
    };
  }
  props[rec.field] = newValue;
  return {
    recommendation: rec,
    applied: true,
    skipReason: null,
    diff: `${rec.field}: ${oldValue ? `"${oldValue}"` : "(empty)"} → "${newValue}"`,
  };
}

/** Pull the LAST quoted string from the suggestion (the target). */
export function parseRewriteTarget(suggestion: string): string | null {
  // Match a quoted string after "→", "->", "to", or "try" — case insensitive.
  const arrowMatch = suggestion.match(/(?:→|->|\bto\b|\btry\b)\s*['"]([^'"]+)['"]/i);
  if (arrowMatch && arrowMatch[1]) return arrowMatch[1];
  // Fallback: last quoted string in the suggestion.
  const allQuoted = [...suggestion.matchAll(/['"]([^'"]+)['"]/g)];
  if (allQuoted.length > 0) {
    const last = allQuoted[allQuoted.length - 1];
    return last?.[1] ?? null;
  }
  return null;
}

function applyDurationAdjust(scene: SceneRef, rec: SceneRecommendation): AppliedRecommendation {
  const target = parseDurationTarget(rec.suggestion);
  if (target == null) {
    return {
      recommendation: rec,
      applied: false,
      skipReason: "couldn't parse target duration from suggestion (expected '→ Ns' or 'to Ns')",
      diff: null,
    };
  }
  const old = scene.durationHint ?? null;
  scene.durationHint = target;
  return {
    recommendation: rec,
    applied: true,
    skipReason: null,
    diff: `durationHint: ${old == null ? "(unset)" : `${old}s`} → ${target}s`,
  };
}

/** Pull the LAST "Ns" or "N s" pattern after "→" / "to" from the suggestion. */
export function parseDurationTarget(suggestion: string): number | null {
  const m = suggestion.match(/(?:→|->|\bto\b)\s*~?(\d+(?:\.\d+)?)\s*s\b/i);
  if (m && m[1]) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0 && n <= 60) return n;
  }
  return null;
}

function applyTemplateSwap(
  scene: SceneRef,
  rec: SceneRecommendation,
  knownTemplates?: ReadonlySet<string>,
): AppliedRecommendation {
  const target = parseTemplateTarget(rec.suggestion);
  if (!target) {
    return {
      recommendation: rec,
      applied: false,
      skipReason: "couldn't parse target template id from suggestion",
      diff: null,
    };
  }
  if (knownTemplates && !knownTemplates.has(target)) {
    return {
      recommendation: rec,
      applied: false,
      skipReason: `template "${target}" not in catalog`,
      diff: null,
    };
  }
  const old = scene.template;
  scene.template = target;
  return {
    recommendation: rec,
    applied: true,
    skipReason: null,
    diff: `template: ${old} → ${target}`,
  };
}

/** Pull a kebab-case template id from the suggestion. Prefer a match
 *  AFTER an arrow ("→" / "->"), then after "to". The "swap" word alone
 *  often introduces the SOURCE template, not the target — so we skip it
 *  unless followed by an arrow. */
export function parseTemplateTarget(suggestion: string): string | null {
  // Try arrow first — this is the unambiguous "source → target" form.
  const arrowMatch = suggestion.match(/(?:→|->)\s*([a-z][a-z0-9-]+)/i);
  if (arrowMatch && arrowMatch[1]) {
    const candidate = arrowMatch[1].toLowerCase();
    if (candidate.includes("-") || candidate.length >= 4) return candidate;
  }
  // Fall back to "to <id>" form.
  const toMatch = suggestion.match(/\bto\s+([a-z][a-z0-9-]+)/i);
  if (toMatch && toMatch[1]) {
    const candidate = toMatch[1].toLowerCase();
    if (candidate.includes("-") || candidate.length >= 4) return candidate;
  }
  return null;
}

function applyThemeShift(
  scene: SceneRef,
  rec: SceneRecommendation,
  knownThemes?: ReadonlySet<string>,
): AppliedRecommendation {
  const target = parseThemeTarget(rec.suggestion);
  if (!target) {
    return {
      recommendation: rec,
      applied: false,
      skipReason: "couldn't parse theme name from suggestion",
      diff: null,
    };
  }
  if (knownThemes && !knownThemes.has(target)) {
    return {
      recommendation: rec,
      applied: false,
      skipReason: `theme "${target}" not registered`,
      diff: null,
    };
  }
  const props = scene.props as Record<string, unknown>;
  const old = typeof props.theme === "string" ? props.theme : null;
  props.theme = target;
  return {
    recommendation: rec,
    applied: true,
    skipReason: null,
    diff: `theme: ${old ?? "(default)"} → ${target}`,
  };
}

/** Pull a kebab-case theme name. */
export function parseThemeTarget(suggestion: string): string | null {
  const m = suggestion.match(/(?:→|->|\bto\b|\btheme\b\s+(?:to\s+)?)\s*([a-z][a-z0-9-]+)/i);
  if (m && m[1]) return m[1].toLowerCase();
  return null;
}
