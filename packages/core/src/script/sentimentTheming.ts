/**
 * sentimentTheming — map per-scene sentiment to bgOverride atmospheres.
 *
 * Driven by the Haiku scoreScript() output. Each scene's `sentiment` label
 * (alarming / aspirational / curious / warm / cold / neutral) maps to a
 * matching bgOverride gradient. When sentiment-driven theming is enabled
 * via `hyperframes score --apply-themes`, scenes without an author-set
 * bgOverride get the matching atmosphere applied.
 *
 * This is heuristic on top of the Haiku scorer output — pure transformation,
 * no AI. Conservative: only applies to scenes whose templates accept
 * bgOverride (chart-scene, chart-payoff for the editorial register).
 *
 * Color choices: dark gradients designed to read across all 4 built-in
 * themes (HACKERNOON_FT cream / DATA_DRIFT_DARK / DREAMSPACE / CYBERLOFI).
 * For light themes (cream FT) we use lighter parchment tones; for dark
 * themes (DATA_DRIFT_DARK / DREAMSPACE / CYBERLOFI) we use deeper inks.
 * The mapping is theme-agnostic by design — bgOverride sets a CSS
 * gradient that interpolates with whatever fg/accent colors the theme
 * provides.
 */

import type { Script, SceneRef } from "./types.js";
import type { SceneScore, Sentiment } from "./scriptScorer.js";

/**
 * Map of sentiment → bgOverride CSS expression. `null` means leave the
 * scene's background alone (use theme bg).
 *
 * Light-theme variants (cream FT): we never override; the parchment bg
 * is part of the editorial register's identity. Dark themes get the
 * gradients below.
 *
 * Future: per-theme variants. For now one gradient per sentiment, tuned
 * to dark themes.
 */
export const SENTIMENT_BG_OVERRIDES: Record<Sentiment, string | null> = {
  alarming: "linear-gradient(135deg, #1a0505 0%, #0a0000 60%, #050000 100%)",
  aspirational: "radial-gradient(ellipse at top, #0a1a3a 0%, #0a0a14 70%)",
  curious: "radial-gradient(ellipse at top, #1a1530 0%, #0d0d18 65%, #08080f 100%)",
  warm: "linear-gradient(135deg, #2a1a0a 0%, #1a0a05 100%)",
  cold: "linear-gradient(135deg, #1a1a1f 0%, #0a0a0f 100%)",
  neutral: null,
};

/** Templates that honour bgOverride (i.e. apply sentiment theming to). */
const BG_OVERRIDE_TEMPLATES: ReadonlySet<string> = new Set(["chart-scene", "chart-payoff"]);

/** Themes considered "light" — we skip sentiment overrides on these to
 *  preserve the parchment/cream identity of editorial register. */
const LIGHT_THEME_NAMES: ReadonlySet<string> = new Set(["hackernoon-ft"]);

export interface ApplySentimentThemingOptions {
  /** Per-scene scores from scoreScript(). Used to map sentiment → atmosphere. */
  sceneScores: SceneScore[];
  /** Currently active project-wide theme. Light themes are skipped. */
  projectTheme?: string;
  /** Override BG mapping (for testing or custom palettes). */
  bgOverrides?: Record<Sentiment, string | null>;
}

export interface SentimentThemingChange {
  sceneId: string;
  sentiment: Sentiment;
  bgApplied: string | null;
  reason: string | null;
}

export interface SentimentThemingReport {
  changes: SentimentThemingChange[];
  skipped: SentimentThemingChange[];
}

/**
 * Apply sentiment-driven theming to a Script. Returns the edited Script +
 * a report of which scenes got new bgOverrides.
 *
 * Skips scenes that:
 *   - Already have an author-set `bgOverride`
 *   - Use a template that doesn't honour bgOverride
 *   - Have neutral sentiment (no atmosphere change warranted)
 *   - Project is using a light theme (parchment) — preserve identity
 */
export function applySentimentTheming(
  script: Script,
  opts: ApplySentimentThemingOptions,
): { script: Script; report: SentimentThemingReport } {
  const overrides = opts.bgOverrides ?? SENTIMENT_BG_OVERRIDES;
  const skipLight = opts.projectTheme && LIGHT_THEME_NAMES.has(opts.projectTheme);
  const scoreById = new Map<string, SceneScore>();
  for (const s of opts.sceneScores) scoreById.set(s.sceneId, s);

  const changes: SentimentThemingChange[] = [];
  const skipped: SentimentThemingChange[] = [];

  const scenes = script.scenes.map((s) => {
    const score = scoreById.get(s.id);
    if (!score) return s;
    if (skipLight) {
      skipped.push({
        sceneId: s.id,
        sentiment: score.sentiment,
        bgApplied: null,
        reason: "project uses a light theme — preserving cream identity",
      });
      return s;
    }
    if (!BG_OVERRIDE_TEMPLATES.has(s.template)) {
      skipped.push({
        sceneId: s.id,
        sentiment: score.sentiment,
        bgApplied: null,
        reason: `template ${s.template} does not honour bgOverride`,
      });
      return s;
    }
    const props = (s.props ?? {}) as Record<string, unknown>;
    if (typeof props.bgOverride === "string" && props.bgOverride.length > 0) {
      skipped.push({
        sceneId: s.id,
        sentiment: score.sentiment,
        bgApplied: null,
        reason: "author-set bgOverride preserved",
      });
      return s;
    }
    const bgValue = overrides[score.sentiment];
    if (!bgValue) {
      // Neutral or no mapping — no change.
      skipped.push({
        sceneId: s.id,
        sentiment: score.sentiment,
        bgApplied: null,
        reason: `sentiment ${score.sentiment} maps to no atmosphere`,
      });
      return s;
    }
    const updated: SceneRef = {
      ...s,
      props: { ...props, bgOverride: bgValue },
    };
    changes.push({
      sceneId: s.id,
      sentiment: score.sentiment,
      bgApplied: bgValue,
      reason: null,
    });
    return updated;
  });

  return {
    script: { meta: script.meta, scenes },
    report: { changes, skipped },
  };
}
