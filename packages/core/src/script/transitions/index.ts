import type { SceneTransition } from "../types.js";

/**
 * Per-transition default duration in seconds. Tuned so the transition reads
 * as deliberate without eating spoken-word timing — narration starts at the
 * scene's `start` mark and the transition completes well before any
 * meaningful word lands.
 */
export const TRANSITION_DURATIONS: Record<SceneTransition, number> = {
  cut: 0,
  fade: 0.45,
  "wipe-left": 0.55,
  "wipe-right": 0.55,
  "zoom-in": 0.5,
  "zoom-out": 0.5,
  "whip-pan": 0.32,
};

/**
 * Picks the transition a scene gets when the planner doesn't supply one.
 * Hooks default to `cut` because the kinetic content already provides
 * impact — fading in over a per-letter cascade muddies the entrance.
 * Most other templates default to `fade` (cross-fade with neighbour) which
 * reads as cinema, not slideshow.
 */
export function defaultTransitionForTemplate(templateId: string): SceneTransition {
  switch (templateId) {
    case "hook-bigtext":
    case "hook-statreveal":
      return "cut";
    case "chart-scene":
      return "fade";
    case "comparison":
      return "zoom-in";
    case "concept-callout":
      return "wipe-left";
    case "aroll-text":
      return "fade";
    case "quote":
      return "fade";
    case "outro-cta":
      return "zoom-out";
    default:
      return "fade";
  }
}

export const TRANSITION_IDS: SceneTransition[] = [
  "cut",
  "fade",
  "wipe-left",
  "wipe-right",
  "zoom-in",
  "zoom-out",
  "whip-pan",
];
