/**
 * Gemini patch-proposer — turns a render review (Gemini-graded mp4) into
 * a list of concrete, typed patches the optimizer can apply.
 *
 * This is the "Gemini as director" surface. The render-review tool that
 * already lives in the storyline routes only SCORES the video. This
 * tool is the next step: given the same mp4 + script, propose specific
 * edits (text rewrites, template swaps, prop additions, scene splits,
 * border fixes) that should push retention toward the target.
 *
 * Why a separate tool from render-review:
 *   1. Different output shape — review returns scorecards; proposer
 *      returns a typed patch array.
 *   2. Different temperature — review wants accuracy (low temp);
 *      proposer wants creative concrete edits (slightly higher temp).
 *   3. Cache-friendly separation — we re-run the proposer on every
 *      iteration but the review prompt is cacheable since most of the
 *      context is the script structure.
 *
 * The proposer reuses the same Gemini Flash + Files API path as the
 * render review (mp4 uploaded once per iteration, used for both calls).
 * Cost: ~$0.02-0.04 per proposer call.
 */

import {
  generateStructured,
  GeminiError,
  DEFAULT_GEMINI_MODEL,
  type GeminiPart,
  type ToolFunctionDeclaration,
} from "../gemini/client.js";
import type { Script } from "./types.js";
import type { EditPatch } from "./optimizerPatches.js";
import { validatePatches } from "./optimizerPatches.js";

export interface ProposeOptimizationPatchesOptions {
  /** GEMINI_API_KEY. Caller resolves via loadGeminiKey(). */
  apiKey: string;
  /** Already-uploaded Gemini Files API URI for the rendered mp4. The
   *  optimizer uploads once per iteration, then reuses the URI for both
   *  the render review and this proposer call. */
  videoFileUri: string;
  /** Mime type that came back from uploadAndWait. */
  videoMimeType: string;
  /** The current script, post-any-prior-iteration. */
  script: Script;
  /** Per-scene timings derived from PlannedScript audio durations.
   *  Used by the prompt so Gemini's references are anchored to real
   *  timestamps the user can find in the mp4. */
  sceneTimings: ReadonlyArray<{ sceneId: string; start: number; duration: number }>;
  /** Per-scene scorecards from the most recent render review.
   *  Proposer uses these to focus on the lowest-scoring scenes. */
  perSceneScores: ReadonlyArray<{
    sceneId: string;
    visualHook: number;
    paceMatch: number;
    onBrand: number;
    note?: string;
  }>;
  /** Overall retention score from the review (0-100). Proposer prompts
   *  more aggressively when this is far below target. */
  currentRetention: number;
  /** Target retention the optimizer wants to hit. Defaults to 90. */
  targetRetention?: number;
  /** Source-of-truth list of valid template ids. */
  knownTemplates: ReadonlyArray<string>;
  /** Source-of-truth list of valid atmosphere ids (incl. compositions). */
  knownAtmospheres: ReadonlyArray<string>;
  /** Optional model override. Default: gemini-2.5-flash. */
  model?: string;
  /** Cap on the number of patches Gemini can propose per iteration.
   *  Each one risks unintended side effects; small batches converge faster. */
  maxPatches?: number;
}

const DEFAULT_TARGET_RETENTION = 90;
const DEFAULT_MAX_PATCHES = 6;

const TOOL: ToolFunctionDeclaration = {
  name: "propose_optimization_patches",
  description:
    "Propose concrete per-scene patches to push retention toward the target. Be surgical — each patch must be a single edit with a clear retention rationale.",
  parameters: {
    type: "object",
    properties: {
      strategy: {
        type: "string",
        description:
          "1-2 sentences on the overall fix strategy for this iteration. Shown to the user as the iteration's rationale.",
      },
      patches: {
        type: "array",
        items: {
          type: "object",
          properties: {
            sceneId: { type: "string", description: "Must match an existing scene id." },
            action: {
              type: "string",
              enum: ["editText", "swapTemplate", "addProp", "splitScene", "fixBorders"],
            },
            why: { type: "string", description: "One sentence: why this edit lifts retention." },
            estimatedRetentionDelta: {
              type: "number",
              description:
                "Estimated retention point swing for this patch alone (positive = improvement). Helps the optimizer prioritize.",
            },
            // editText
            text: {
              type: "string",
              description: "editText only — new narration text. Triggers re-synth on this scene.",
            },
            // swapTemplate
            newTemplate: {
              type: "string",
              description: "swapTemplate only — new template id from the catalog.",
            },
            newProps: {
              type: "object",
              description: "swapTemplate only — props for the new template.",
            },
            // addProp
            key: {
              type: "string",
              description: "addProp only — top-level scene.props key to set.",
            },
            value: {
              description:
                "addProp only — JSON value (string / number / array). Templates own validation.",
            },
            // splitScene
            firstText: {
              type: "string",
              description: "splitScene only — narration for first half.",
            },
            secondText: {
              type: "string",
              description: "splitScene only — narration for second half.",
            },
            secondTemplate: {
              type: "string",
              description: "splitScene only — optional template for second half.",
            },
            secondProps: {
              type: "object",
              description: "splitScene only — optional props for second half.",
            },
            // fixBorders
            cssOverride: {
              type: "string",
              description:
                "fixBorders only — raw CSS override for clip / overflow / border issues.",
            },
          },
          required: ["sceneId", "action", "why"],
        },
      },
    },
    required: ["strategy", "patches"],
  },
};

interface ProposerToolInput {
  strategy?: string;
  patches?: unknown[];
}

export interface ProposedOptimizations {
  /** 1-2 sentences from Gemini summarizing the iteration's strategy. */
  strategy: string;
  /** Validated patches, ready to apply via applyPatches(). */
  patches: EditPatch[];
  /** Patches Gemini proposed but didn't pass validation. Logged for the
   *  user so they can see what Gemini tried that didn't fit the
   *  validation rules. */
  rejected: Array<{ patch: unknown; reason: string }>;
  /** Token usage so the optimizer can roll up cost accurately. */
  usage: { promptTokens: number; outputTokens: number };
}

function buildSystem(targetRetention: number, maxPatches: number): string {
  return [
    "# Retention optimizer — patch proposer",
    "",
    `You are a retention engineer. The user's video is currently below the target retention of ${targetRetention}/100. Your job: propose at most ${maxPatches} surgical per-scene patches that, applied together, push retention toward the target.`,
    "",
    "## Your tools",
    "1. **editText** — Rewrite scene narration for impact. Use when copy is corporate, abstract, or doesn't hook within the first beat. Triggers ElevenLabs re-synth on that scene only.",
    "2. **swapTemplate** — Move a scene to a different template. Use when the template is structurally wrong (e.g. typography template on data-dense content; static template on high-energy moment).",
    "3. **addProp** — Add or override a single scene.props key. Useful for: setting `accentWord`, `motionIntensity`, `atmosphere`. Cheap — no re-synth.",
    "4. **splitScene** — Break one slow scene into two punchier ones. Use when narration runs >5s of static text. Re-synths both halves.",
    "5. **fixBorders** — Inject a CSS override into scene.props.cssOverride. Use when the rendered scene visibly leaks past the canvas (glow elements off the edge, padding overflow, clipped subjects).",
    "",
    "## Rules",
    "1. **Every patch must reference a SPECIFIC retention failure mode** in `why`. 'Improve flow' is unhelpful. 'Static text reads slower than narration; viewer scrolls at 4s mark' is concrete.",
    "2. **Estimate retention delta honestly**. A copy edit on one scene rarely moves overall retention by more than 2-4 points. A template swap on a hook can move it 5-10. The user uses these numbers to prioritize.",
    "3. **Don't fix what isn't broken.** Scenes scoring ≥7 across all axes don't need patches. Focus on the 🔴/🟡 scenes from the per-scene report.",
    "4. **Don't propose splitScene for scenes already <3s.** It produces choppy output.",
    "5. **Don't ALL-CAPS the narration in editText.** It changes how ElevenLabs reads the line.",
    "6. **Validate template ids and atmosphere ids against the catalogs.** Unknown ids are silently dropped at validation time.",
    "7. **Don't propose patches that the user just shipped 'as the new look'.** If a scene scored 9/9/9 in the LAST review, leaving it alone preserves your wins.",
    "",
    "## Output",
    "Call propose_optimization_patches with `strategy` (1-2 sentences) + `patches` (array). Be sparing — fewer patches that ship are better than many that get overwritten next iteration.",
  ].join("\n");
}

function buildUser(opts: {
  script: Script;
  sceneTimings: ReadonlyArray<{ sceneId: string; start: number; duration: number }>;
  perSceneScores: ReadonlyArray<{
    sceneId: string;
    visualHook: number;
    paceMatch: number;
    onBrand: number;
    note?: string;
  }>;
  currentRetention: number;
  targetRetention: number;
  knownTemplates: ReadonlyArray<string>;
  knownAtmospheres: ReadonlyArray<string>;
}): string {
  const scoresById = new Map(opts.perSceneScores.map((s) => [s.sceneId, s]));
  const sceneLines = opts.script.scenes.map((s) => {
    const t = opts.sceneTimings.find((tt) => tt.sceneId === s.id);
    const sc = scoresById.get(s.id);
    const scoreCol = sc
      ? `[hook ${sc.visualHook} · pace ${sc.paceMatch} · brand ${sc.onBrand}]`
      : "[no score]";
    const window = t ? `${t.start.toFixed(1)}-${(t.start + t.duration).toFixed(1)}s` : "?";
    return `- **${s.id}** (${window}, template=${s.template}) ${scoreCol} — ${s.text}${
      sc?.note ? `\n    note: ${sc.note}` : ""
    }`;
  });

  return [
    `## Current state`,
    `- Overall retention: **${opts.currentRetention}/100** (target: ${opts.targetRetention}/100)`,
    `- Gap: ${(opts.targetRetention - opts.currentRetention).toFixed(0)} points`,
    "",
    `## Templates available (${opts.knownTemplates.length})`,
    opts.knownTemplates.join(", "),
    "",
    `## Atmospheres available (${opts.knownAtmospheres.length})`,
    opts.knownAtmospheres.join(", "),
    "",
    `## Scenes with scores`,
    sceneLines.join("\n"),
    "",
    "Now watch the attached video and call propose_optimization_patches with surgical patches.",
  ].join("\n");
}

/**
 * Run one proposer call. Returns validated patches ready to apply.
 * Throws GeminiError on API failure — the optimizer treats that as a
 * recoverable per-iteration failure (log, skip, continue).
 */
export async function proposeOptimizationPatches(
  opts: ProposeOptimizationPatchesOptions,
): Promise<ProposedOptimizations> {
  const target = opts.targetRetention ?? DEFAULT_TARGET_RETENTION;
  const maxPatches = opts.maxPatches ?? DEFAULT_MAX_PATCHES;
  const parts: GeminiPart[] = [
    { fileData: { fileUri: opts.videoFileUri, mimeType: opts.videoMimeType } },
    {
      text: buildUser({
        script: opts.script,
        sceneTimings: opts.sceneTimings,
        perSceneScores: opts.perSceneScores,
        currentRetention: opts.currentRetention,
        targetRetention: target,
        knownTemplates: opts.knownTemplates,
        knownAtmospheres: opts.knownAtmospheres,
      }),
    },
  ];

  const { result, usage } = await generateStructured<ProposerToolInput>(opts.apiKey, {
    model: opts.model ?? DEFAULT_GEMINI_MODEL,
    parts,
    systemInstruction: buildSystem(target, maxPatches),
    tool: TOOL,
    temperature: 0.4,
    // Same Flash trap as the render review — generous headroom on the
    // patches array prevents MALFORMED_FUNCTION_CALL truncation.
    maxOutputTokens: 8192,
  });

  if (!result || typeof result !== "object") {
    throw new GeminiError("propose_optimization_patches: empty result");
  }
  const strategy = typeof result.strategy === "string" ? result.strategy.trim().slice(0, 300) : "";
  const validated = validatePatches(result.patches ?? [], opts.script, {
    knownTemplates: opts.knownTemplates,
    knownAtmospheres: opts.knownAtmospheres,
  });

  // Apply the per-iteration patch cap AFTER validation so we don't
  // discard good patches just because Gemini emitted a few bad ones.
  const capped = validated.patches.slice(0, maxPatches);
  const overflow = validated.patches.slice(maxPatches).map((p) => ({
    patch: p,
    reason: `dropped: maxPatches=${maxPatches} cap reached`,
  }));

  return {
    strategy,
    patches: capped,
    rejected: [...validated.rejected, ...overflow],
    usage: {
      promptTokens: usage.promptTokenCount ?? 0,
      outputTokens: usage.candidatesTokenCount ?? 0,
    },
  };
}
