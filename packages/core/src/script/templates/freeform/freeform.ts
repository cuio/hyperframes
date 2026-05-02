/**
 * The `freeform` template. Unlike every other builtin, its `render()`
 * doesn't generate HTML directly — it emits whatever the resolver
 * pre-stamped onto `props.generatedHtml`. The pre-resolution step
 * (`resolveFreeformScenes()`) walks a planned script BEFORE
 * `assembleMaster()` runs and fills in the html for every freeform
 * scene by either reading the cache or calling Gemini.
 *
 * Why this two-step pattern:
 *   - `assembleMaster()` is sync. Making it async would ripple through
 *     every caller (CLI, studio, optimizer).
 *   - The Gemini call has to be async + may be slow (seconds per scene).
 *   - Keeping the async work in a separate phase means the existing
 *     contract is preserved and the cache is the only thing that needs
 *     to be aware of network calls.
 */

import type { Template, TemplateRenderContext } from "../types.js";
import { asString, formatSec } from "../util.js";
import { readFreeformCache, writeFreeformCache, hashFreeformKey } from "./cache.js";
import { generateFreeformScene, FREEFORM_GENERATOR_VERSION } from "./generator.js";
import type { FreeformCacheKey } from "./types.js";

/** Fallback HTML when a freeform scene reaches the renderer without a
 *  pre-resolved generation (e.g. the resolver was never called, or it
 *  failed and the caller didn't fall back to a different template).
 *
 *  This is a visible "broken scene" placeholder rather than empty
 *  output so the failure mode is obvious in the rendered video. */
const RESOLVE_FAILURE_PLACEHOLDER = (sceneId: string, dur: string): string =>
  `<div id="${sceneId}" data-composition-id="${sceneId}" data-scene-id="${sceneId}" data-duration="${dur}" style="position:absolute;inset:0;background:#1a1a1a;color:#999;display:flex;align-items:center;justify-content:center;font-family:monospace;font-size:14px;">freeform scene ${sceneId} was not pre-resolved (call resolveFreeformScenes before assemble)</div>`;

export const FREEFORM_TEMPLATE: Template = {
  id: "freeform",
  description:
    "Gemini-generated scene. The planner picks this when no hand-authored template fits the reference profile, " +
    "or when the user explicitly opts in. The actual HTML is generated at the resolveFreeformScenes() step BEFORE " +
    "assembleMaster() runs; this template's render() then just emits the pre-stamped html.",
  whenToUse: [
    "Reference profile recommends an aesthetic no hand-authored template approximates well",
    "Hook scenes where freeform creative latitude lifts retention above what fixed templates produce",
    "Mid-narrative beats with a unique moment the planner wants to author specifically",
  ],
  durationRange: { min: 1.5, max: 9 },
  propsSchema: {
    type: "object",
    properties: {
      narration: {
        type: "string",
        description:
          "The scene narration. The resolver passes this to Gemini; the rendered HTML must support it.",
      },
      accentWord: {
        type: "string",
        description: "Optional focal word the resolver passes through to Gemini.",
      },
      designNotes: {
        type: "string",
        description:
          "1-2 sentences from Gemini explaining its visual choice. Surfaced in the studio overlay.",
      },
      // generatedHtml is filled in by the resolver. The schema declares it
      // so the planner doesn't strip it; the resolver's pre-fill writes
      // the value before the render is called.
      generatedHtml: {
        type: "string",
        description: "INTERNAL — set by resolveFreeformScenes(). Not for the planner to populate.",
      },
    },
    required: ["narration"],
  },
  render(props, ctx: TemplateRenderContext): string {
    const html = asString(props.generatedHtml);
    if (html) return html;
    return RESOLVE_FAILURE_PLACEHOLDER(ctx.sceneId, formatSec(ctx.durationSeconds));
  },
};

// ── Resolver ───────────────────────────────────────────────────────────────

export interface ResolveFreeformScenesOptions {
  apiKey: string;
  projectDir: string;
  themeTokens: FreeformCacheKey["themeTokens"];
  /** Optional reference profile that the generator threads into its
   *  prompt. The cache key includes its shape so a new profile rotates
   *  every freeform scene's hash. */
  referenceProfile?: FreeformCacheKey["referenceProfileShape"];
  /** Optional model override. Default: gemini-2.5-flash. */
  model?: string;
  /** Per-scene callback used by the CLI to surface progress. */
  onScene?: (info: {
    sceneId: string;
    cached: boolean;
    durationMs: number;
    promptTokens: number;
    outputTokens: number;
  }) => void;
}

export interface ResolveFreeformScenesResult {
  /** Scene ids that were resolved (subset of input freeform scenes). */
  resolved: string[];
  /** Scene ids that failed to resolve — caller should swap them to a
   *  hand-authored template or skip the render. */
  failed: Array<{ sceneId: string; reason: string }>;
  /** Total Gemini cost for this batch (sum of per-scene usage). */
  totalUsage: { promptTokens: number; outputTokens: number };
  /** Cache stats for the optimizer's audit log. */
  cacheStats: { hits: number; misses: number };
}

/**
 * Resolve every freeform scene in a planned script. Mutates the
 * scene's `props.generatedHtml` and `props.designNotes` in-place so
 * the existing assembleMaster() pipeline picks them up unchanged.
 *
 * Caller passes a `Script | PlannedScript`-like object with
 * `scenes: SceneRef[]`. We only mutate props of scenes whose
 * template === "freeform".
 *
 * The function is async but doesn't block on scenes that aren't
 * freeform — they pass through untouched. The result reports per-scene
 * cache hit / miss + token usage so the CLI can surface progress.
 */
export async function resolveFreeformScenes<S extends { scenes: ResolveSceneShape[] }>(
  script: S,
  opts: ResolveFreeformScenesOptions,
): Promise<ResolveFreeformScenesResult> {
  const resolved: string[] = [];
  const failed: ResolveFreeformScenesResult["failed"] = [];
  const totalUsage = { promptTokens: 0, outputTokens: 0 };
  const cacheStats = { hits: 0, misses: 0 };

  for (const scene of script.scenes) {
    if (scene.template !== "freeform") continue;
    const start = Date.now();
    const narration = asString(scene.text || (scene.props as Record<string, unknown>).narration);
    const accentWord = asString((scene.props as Record<string, unknown>).accentWord);
    const cacheKey: FreeformCacheKey = {
      narration,
      sceneId: scene.id,
      referenceProfileShape: opts.referenceProfile ?? {},
      themeTokens: opts.themeTokens,
      generatorVersion: FREEFORM_GENERATOR_VERSION,
    };
    const cached = readFreeformCache(opts.projectDir, cacheKey);
    if (cached) {
      cacheStats.hits += 1;
      // Mutate the scene's props in place so the existing assembler
      // picks the html up via FREEFORM_TEMPLATE.render.
      (scene.props as Record<string, unknown>).generatedHtml = cached.html;
      resolved.push(scene.id);
      opts.onScene?.({
        sceneId: scene.id,
        cached: true,
        durationMs: Date.now() - start,
        promptTokens: 0,
        outputTokens: 0,
      });
      continue;
    }
    cacheStats.misses += 1;
    try {
      const result = await generateFreeformScene({
        apiKey: opts.apiKey,
        sceneId: scene.id,
        narration,
        ...(accentWord ? { accentWord } : {}),
        ...(scene.hook ? { isHook: true } : {}),
        themeTokens: opts.themeTokens,
        ...(opts.referenceProfile ? { referenceProfile: opts.referenceProfile } : {}),
        ...(opts.model ? { model: opts.model } : {}),
      });
      writeFreeformCache(opts.projectDir, cacheKey, result.generation);
      (scene.props as Record<string, unknown>).generatedHtml = result.generation.html;
      totalUsage.promptTokens += result.generation.usage.promptTokens;
      totalUsage.outputTokens += result.generation.usage.outputTokens;
      resolved.push(scene.id);
      opts.onScene?.({
        sceneId: scene.id,
        cached: false,
        durationMs: Date.now() - start,
        promptTokens: result.generation.usage.promptTokens,
        outputTokens: result.generation.usage.outputTokens,
      });
    } catch (err) {
      failed.push({
        sceneId: scene.id,
        reason: err instanceof Error ? err.message : String(err),
      });
      opts.onScene?.({
        sceneId: scene.id,
        cached: false,
        durationMs: Date.now() - start,
        promptTokens: 0,
        outputTokens: 0,
      });
    }
  }
  return { resolved, failed, totalUsage, cacheStats };
}

/**
 * Convenience: shape every scene the resolver touches must satisfy.
 * Loose typing keeps this compatible with both Script (raw) and
 * PlannedScript (post-synth).
 */
export interface ResolveSceneShape {
  id: string;
  text?: string;
  template: string;
  props: Record<string, unknown>;
  hook?: boolean;
}

// Re-export the cache key hasher so the optimizer / CLI can surface
// the cache key in audit logs without re-importing the cache module.
export { hashFreeformKey };
