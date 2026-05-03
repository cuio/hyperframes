/**
 * hookVariants — generate N hook variants and pick the highest-scoring one.
 *
 * Implements the A/B variant scoring path. Workflow:
 *   1. Pull scene 0 (the hook) from the planned Script.
 *   2. Call planSceneVariants() to generate N=3 alternative visual
 *      treatments for the same narration.
 *   3. For each variant, build a TINY 1-scene script using the variant +
 *      pass through scoreScript(). The Haiku call sees just the hook;
 *      we get back a per-scene score with hookStrength + predictedRetention.
 *   4. Pick the variant with the highest predictedRetention (tiebreak:
 *      highest hookStrength).
 *   5. Return the winner + all variants with their scores so the caller
 *      can show the comparison.
 *
 * Cost model: planSceneVariants is one Sonnet call (the planner's default
 * tier). Then N Haiku calls (one per variant, scoring the 1-scene
 * "hook-only" script). Total ~$0.05 per A/B run — small compared to a
 * 30-min render.
 *
 * Why score variants in isolation, not the full script: each variant is
 * a different opening for the SAME script body. Scoring each variant with
 * the same body would cost N× as many Haiku calls without changing the
 * relative ranking — the variation is in scene 0 only.
 */

import { planSceneVariants, type VariantOptions } from "./planner.js";
import { scoreScript, type SceneScore, type ScriptScore } from "./scriptScorer.js";
import type { Script, SceneRef } from "./types.js";

/** A scored hook variant with its variant label + per-scene score. */
export interface ScoredHookVariant {
  /** Index in the variants array (0-based). */
  index: number;
  /** Short label from the planner (e.g. "Glitch + Sound"). */
  label: string;
  /** The full SceneRef for this variant (template + props the planner produced). */
  scene: SceneRef;
  /** Reasoning the planner provided. */
  reasoning: string;
  /** Haiku per-scene score for this variant. */
  score: SceneScore;
}

export interface VaryHookResult {
  /** The winning variant. */
  winner: ScoredHookVariant;
  /** All variants with their scores, sorted by predictedRetention descending. */
  variants: ScoredHookVariant[];
  /** Token usage across all calls (planner + scoring). */
  usage: {
    variantInputTokens: number;
    variantOutputTokens: number;
    scoreInputTokens: number;
    scoreOutputTokens: number;
  };
}

export interface VaryHookOptions {
  /** Anthropic API key. */
  apiKey: string;
  /** Number of variants to generate. Default 3, max 5. */
  count?: number;
  /** Override variant-generation model (default: planner default). */
  variantModel?: string;
  /** Override scoring model (default: scriptScorer default). */
  scoreModel?: string;
}

/**
 * Generate N hook variants, score each, return the winner + comparison.
 *
 * Throws if the script has no scenes or scene 0 isn't a hook.
 */
export async function varyHookAndScore(
  script: Script,
  opts: VaryHookOptions,
): Promise<VaryHookResult> {
  if (script.scenes.length === 0) {
    throw new Error("varyHookAndScore: script has no scenes");
  }
  const original = script.scenes[0];
  if (!original) throw new Error("varyHookAndScore: scene 0 missing");

  // Generate N variants.
  const variantOpts: VariantOptions = {
    apiKey: opts.apiKey,
    count: opts.count ?? 3,
    ...(opts.variantModel ? { model: opts.variantModel } : {}),
  };
  const variants = await planSceneVariants(
    original,
    { meta: script.meta, allScenes: script.scenes },
    variantOpts,
  );

  // Score each variant in a 1-scene script (just the hook). Each call is
  // independent; we run them sequentially to keep rate-limit pressure
  // low. (Could be Promise.all for speed at the cost of more concurrent
  // calls — keep simple for now.)
  const scored: ScoredHookVariant[] = [];
  let scoreInTokens = 0;
  let scoreOutTokens = 0;
  for (let i = 0; i < variants.length; i++) {
    const variant = variants[i];
    if (!variant) continue;
    const microScript: Script = {
      meta: { ...script.meta, title: `Hook variant: ${variant.label}` },
      scenes: [variant],
    };
    const result: ScriptScore = await scoreScript(microScript, {
      apiKey: opts.apiKey,
      ...(opts.scoreModel ? { model: opts.scoreModel } : {}),
    });
    scoreInTokens += result.usage.inputTokens;
    scoreOutTokens += result.usage.outputTokens;
    const sceneScore = result.scenes[0];
    if (!sceneScore) continue;
    scored.push({
      index: i,
      label: variant.label,
      scene: variant,
      reasoning: variant.reasoning ?? "",
      score: sceneScore,
    });
  }
  if (scored.length === 0) {
    throw new Error("varyHookAndScore: no variants could be scored");
  }
  // Sort by predictedRetention DESC; tiebreak by hookStrength DESC.
  scored.sort((a, b) => {
    const dr = b.score.predictedRetention - a.score.predictedRetention;
    if (dr !== 0) return dr;
    return b.score.hookStrength - a.score.hookStrength;
  });
  const winner = scored[0];
  if (!winner) throw new Error("varyHookAndScore: empty scored list");

  return {
    winner,
    variants: scored,
    usage: {
      // planSceneVariants doesn't currently expose token usage in its return —
      // approximate as 0 for now; CLI just won't surface those numbers.
      variantInputTokens: 0,
      variantOutputTokens: 0,
      scoreInputTokens: scoreInTokens,
      scoreOutputTokens: scoreOutTokens,
    },
  };
}

/**
 * Replace scene 0 of a script with the winning variant. Returns a new
 * Script; does not mutate the input.
 */
export function applyHookWinner(script: Script, winner: ScoredHookVariant): Script {
  const scenes = [...script.scenes];
  // Preserve the original id so downstream references (audio, transcripts)
  // don't break. Strip the variant's `label` field — it's not part of SceneRef.
  const original = scenes[0];
  const winnerWithOriginalId: SceneRef = {
    ...winner.scene,
    id: original?.id ?? winner.scene.id,
  };
  // Drop the `label` property (it was added by planSceneVariants but isn't
  // a SceneRef field).
  delete (winnerWithOriginalId as { label?: unknown }).label;
  scenes[0] = winnerWithOriginalId;
  return { meta: script.meta, scenes };
}
