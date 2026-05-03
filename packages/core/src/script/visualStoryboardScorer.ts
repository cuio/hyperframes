/**
 * visualStoryboardScorer — deterministic visual rhythm scorer.
 *
 * Augments the Haiku scriptScorer (which sees TEXT only) with a mechanical
 * pass over the planned scenes' VISUAL choices. No AI; pure walk over the
 * scene list checking for retention-killing patterns:
 *
 *   - Template variety. 3+ identical templates in a row reads as a slideshow.
 *   - Atmosphere variety. Same atmosphere across all scenes is a flat
 *     visual rhythm. We want at least 2 distinct atmospheres in any 5-scene
 *     window.
 *   - Color palette evolution. If every scene uses the same theme + same
 *     bgOverride, the eye stops being surprised.
 *   - Rhythm match. Hook scenes should be SHORT (1-3s). Chart scenes
 *     should respect the format-aware caps from retention-ladder.
 *   - Hook density. The opening 5s should have ≥3 distinct beats; if
 *     scene 1 is 5s of one template, that's a retention loss.
 *
 * Pure function — feed it a Script, get a VisualScore back. Designed to
 * pair with scoreScript() in the CLI: the dashboard shows BOTH the
 * Haiku text score AND the visual score for a complete picture.
 */

import type { Script, SceneRef } from "./types.js";

// ── Output shapes ──────────────────────────────────────────────────────────

export type VisualIssueType =
  | "template-monotony"
  | "atmosphere-monotony"
  | "palette-stagnant"
  | "hook-too-long"
  | "chart-overrun"
  | "low-opening-density";

export interface VisualIssue {
  type: VisualIssueType;
  /** Scene ids the issue spans (length 1+ — points to the offending stretch). */
  sceneIds: string[];
  /** Human-readable explanation, ready to surface alongside Haiku recs. */
  message: string;
  /** Penalty applied to overall score (higher = worse). */
  penalty: number;
}

export interface VisualScore {
  /** 0-100 — starts at 100 and subtracts penalties from issues. Higher is better. */
  overall: number;
  /** Per-axis subscores. */
  variety: {
    /** 0-10 — how varied the templates are across the arc. */
    template: number;
    /** 0-10 — how varied the atmospheres are. */
    atmosphere: number;
    /** 0-10 — how much the bgOverride / theme palette evolves. */
    palette: number;
  };
  /** 0-10 — how well scene durations fit their templates' retention windows. */
  rhythm: number;
  /** 0-10 — quality of the visual opening (first 5s). */
  openingDensity: number;
  /** Specific issues flagged, sorted by penalty descending. */
  issues: VisualIssue[];
}

// ── Public entry point ─────────────────────────────────────────────────────

/**
 * Score the visual storyboard of a planned Script. Pure, no I/O.
 */
export function scoreVisualStoryboard(script: Script): VisualScore {
  const scenes = script.scenes;
  const issues: VisualIssue[] = [];

  // ── Template variety ─────────────────────────────────────────────────────
  const templateScore = scoreTemplateVariety(scenes, issues);
  // ── Atmosphere variety ──────────────────────────────────────────────────
  const atmosphereScore = scoreAtmosphereVariety(scenes, issues);
  // ── Palette evolution ───────────────────────────────────────────────────
  const paletteScore = scorePaletteEvolution(scenes, issues);
  // ── Rhythm match ────────────────────────────────────────────────────────
  const rhythmScore = scoreRhythm(scenes, issues);
  // ── Opening density ─────────────────────────────────────────────────────
  const openingDensity = scoreOpeningDensity(scenes, issues);

  // Sort issues by penalty desc.
  issues.sort((a, b) => b.penalty - a.penalty);

  const totalPenalty = issues.reduce((sum, i) => sum + i.penalty, 0);
  const overall = Math.max(0, Math.min(100, 100 - totalPenalty));

  return {
    overall,
    variety: {
      template: templateScore,
      atmosphere: atmosphereScore,
      palette: paletteScore,
    },
    rhythm: rhythmScore,
    openingDensity,
    issues,
  };
}

// ── Per-axis scorers ───────────────────────────────────────────────────────

/**
 * 0-10 — penalize 3+ identical templates in a row, AND penalize a script
 * that uses fewer than 3 distinct templates total.
 */
function scoreTemplateVariety(scenes: SceneRef[], issues: VisualIssue[]): number {
  if (scenes.length === 0) return 10;
  // Streak detection
  let runningStreak = 1;
  let runningTemplate = scenes[0]?.template ?? "";
  let maxStreak = 1;
  let streakStart = 0;
  let worstStreakStart = 0;
  let worstStreakLen = 1;
  let worstStreakTemplate = runningTemplate;
  for (let i = 1; i < scenes.length; i++) {
    const s = scenes[i];
    if (!s) continue;
    if (s.template === runningTemplate) {
      runningStreak += 1;
      if (runningStreak > maxStreak) {
        maxStreak = runningStreak;
        worstStreakStart = streakStart;
        worstStreakLen = runningStreak;
        worstStreakTemplate = runningTemplate;
      }
    } else {
      runningStreak = 1;
      runningTemplate = s.template;
      streakStart = i;
    }
  }
  if (maxStreak >= 3) {
    const sceneIds = scenes
      .slice(worstStreakStart, worstStreakStart + worstStreakLen)
      .map((s) => s.id);
    issues.push({
      type: "template-monotony",
      sceneIds,
      message: `${maxStreak} consecutive scenes use template "${worstStreakTemplate}" — visual reads as a slideshow. Vary the template or insert a bridge.`,
      penalty: 5 + (maxStreak - 3) * 3,
    });
  }
  const distinct = new Set(scenes.map((s) => s.template)).size;
  // 1 distinct template = 0/10; 5+ distinct = 10/10
  const distinctScore = Math.min(10, distinct * 2);
  // Streak penalty caps the score
  const streakScore = Math.max(0, 10 - (maxStreak - 2) * 3);
  return Math.min(distinctScore, streakScore);
}

/**
 * 0-10 — atmospheres should rotate. If every scene uses the same EXPLICIT
 * atmosphere, penalize. We don't penalize the no-opinion case (no scene
 * specifies atmosphere) — that's the assembler's default territory, not
 * a visual rhythm choice.
 */
function scoreAtmosphereVariety(scenes: SceneRef[], issues: VisualIssue[]): number {
  if (scenes.length === 0) return 10;
  const explicit: string[] = [];
  for (const s of scenes) {
    const props = (s.props ?? {}) as { background?: unknown };
    if (typeof props.background === "string") explicit.push(props.background);
  }
  // No author has set atmosphere explicitly — skip this axis (defaults are
  // the assembler's call, not a monotony issue).
  if (explicit.length === 0) return 10;
  const distinct = new Set(explicit).size;
  // Penalize only when the AUTHOR set the same atmosphere across most scenes.
  if (distinct === 1 && explicit.length >= 3) {
    issues.push({
      type: "atmosphere-monotony",
      sceneIds: scenes.map((s) => s.id),
      message: `All ${explicit.length} scenes share atmosphere "${explicit[0]}". The visual rhythm flatlines without variety.`,
      penalty: 4,
    });
    return 4;
  }
  return Math.min(10, distinct * 3);
}

/**
 * 0-10 — penalize when authors EXPLICITLY use the same theme/bgOverride
 * across the arc. Empty palette (no opinion) gets no penalty; that's
 * the assembler's default territory.
 */
function scorePaletteEvolution(scenes: SceneRef[], issues: VisualIssue[]): number {
  if (scenes.length < 4) return 10; // too short to evaluate
  const explicit: string[] = [];
  for (const s of scenes) {
    const props = (s.props ?? {}) as { bgOverride?: unknown; theme?: unknown };
    const theme = asString(props.theme);
    const bg = asString(props.bgOverride);
    if (theme || bg) explicit.push(`${theme || "default"}::${bg || "(none)"}`);
  }
  // Author hasn't set palette anywhere — skip.
  if (explicit.length === 0) return 10;
  const distinct = new Set(explicit).size;
  if (distinct === 1 && explicit.length >= 3) {
    issues.push({
      type: "palette-stagnant",
      sceneIds: scenes.map((s) => s.id),
      message:
        "Theme + bgOverride identical across every scene with an explicit palette — the eye stops being surprised. Rotate themes for distinct narrative beats.",
      penalty: 3,
    });
    return 4;
  }
  return Math.min(10, distinct * 3);
}

/**
 * 0-10 — durations should match template energy. Hook scenes that run
 * 5s+ are retention killers; chart scenes that exceed format caps the
 * retention-ladder set are over-extending.
 */
function scoreRhythm(scenes: SceneRef[], issues: VisualIssue[]): number {
  let score = 10;
  for (const scene of scenes) {
    const dur = scene.durationHint ?? 0;
    if (!dur) continue;
    const isHookTpl = isHookTemplate(scene.template) || scene.hook === true;
    if (isHookTpl && dur > 4) {
      issues.push({
        type: "hook-too-long",
        sceneIds: [scene.id],
        message: `Hook scene "${scene.id}" runs ${dur.toFixed(1)}s — hooks past 3-4s lose the cadence. Split into micro-scenes.`,
        penalty: 4,
      });
      score = Math.max(0, score - 4);
    }
    if (scene.template === "chart-scene" && dur > 10) {
      issues.push({
        type: "chart-overrun",
        sceneIds: [scene.id],
        message: `Chart scene "${scene.id}" runs ${dur.toFixed(1)}s — exceeds long-form sustain cap. Tighten or split.`,
        penalty: 3,
      });
      score = Math.max(0, score - 3);
    }
  }
  return score;
}

/**
 * 0-10 — the first 5 seconds should have ≥3 distinct beats. If the
 * opening is one long scene, retention-ladder rule violated.
 */
function scoreOpeningDensity(scenes: SceneRef[], issues: VisualIssue[]): number {
  if (scenes.length === 0) return 10;
  let cumul = 0;
  let beatCount = 0;
  const openingScenes: string[] = [];
  for (const scene of scenes) {
    const dur = scene.durationHint ?? 3;
    if (cumul >= 5) break;
    beatCount += 1;
    openingScenes.push(scene.id);
    cumul += dur;
  }
  if (beatCount < 3 && cumul >= 4) {
    issues.push({
      type: "low-opening-density",
      sceneIds: openingScenes,
      message: `First ~5s has only ${beatCount} beat${beatCount === 1 ? "" : "s"}. Retention-ladder calls for 3-5 cuts in this window.`,
      penalty: 5,
    });
    return Math.max(2, beatCount * 2);
  }
  return Math.min(10, beatCount * 2 + 2);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function isHookTemplate(template: string): boolean {
  return (
    template === "hook-bigtext" ||
    template === "kinetic-words" ||
    template === "cyber-glitch-word" ||
    template === "hook-statreveal"
  );
}

function asString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}
