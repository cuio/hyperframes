/**
 * Canonical Script DSL.
 *
 * A Script is the planner's output: a flat list of Scenes, each with a
 * narration text, a chosen template, the props that template needs, and
 * timing/voice metadata. Markdown/text input is fed to the planner; the
 * resulting Script is what the renderer consumes.
 */

export type SceneTransition = "cut" | "fade";

export interface SceneRef {
  /** Stable id, e.g. "s01". Used for filenames and cache keys. */
  id: string;
  /** Spoken narration text. Empty means a silent visual-only scene. */
  text: string;
  /** Template id from the catalog. */
  template: string;
  /** Template-specific props (heading, accentWord, items, etc.). */
  props: Record<string, unknown>;
  /** True for the first 0–30s of the video — renderer uses for stronger motion. */
  hook?: boolean;
  /** Optional voice override (defaults to script.meta.voiceId). */
  voiceId?: string;
  /** Optional duration hint in seconds. Real duration comes from measured audio. */
  durationHint?: number;
  /** How this scene transitions in. Default "cut". */
  transition?: SceneTransition;
}

export interface ScriptMeta {
  title?: string;
  /** Default voice for all scenes that don't override. */
  voiceId?: string;
  /** Inferred or user-provided. Used by planner for tone calibration. */
  audience?: string;
  tone?: string;
  /** Target overall duration in seconds. Soft hint for the planner. */
  targetDurationSeconds?: number;
  /** Brand/design hint (used by Phase 4 design system). */
  design?: string;
}

export interface Script {
  meta: ScriptMeta;
  scenes: SceneRef[];
}

/**
 * After audio synthesis, each scene is enriched with the audio file path,
 * its measured duration, and the content hash used for cache lookup.
 */
export interface PlannedScene extends SceneRef {
  audio?: {
    path: string;
    durationSeconds: number;
    contentHash: string;
  };
}

export interface PlannedScript {
  meta: ScriptMeta;
  scenes: PlannedScene[];
  totalDurationSeconds: number;
}
