import { callStructuredTool, AnthropicError, DEFAULT_ANTHROPIC_MODEL } from "../anthropic/index.js";
import type { ToolDefinition } from "../anthropic/index.js";
import type { Script } from "./types.js";
import type { ImageManifest } from "../images/index.js";
import type { CostEventSink } from "../telemetry/cost.js";
import type { DesignTokens } from "./templates/types.js";
import { TREATMENT_IDS, type TreatmentId } from "./templates/image-scene.js";
import { wrapUserContent } from "./planner.js";

/**
 * Visual director — second-pass LLM stage that runs AFTER the script
 * planner. Takes a planned script + the project's image manifest + theme
 * context, and outputs a per-scene visual plan: which image (if any),
 * which treatment, optional focal-point override, plus a one-line
 * rationale.
 *
 * Goal: reuse a small image library expressively. With 3-4 source images
 * across ~25 scenes, each subject image must appear in ≥3 distinct
 * treatments and atmosphere images can underlay whole acts. The director
 * makes those calls with full visibility into the script's emotional arc
 * and the available imagery — something a flat per-scene template pick
 * can't do.
 *
 * Cheap call: ~1.5K input + ~600 output tokens on Sonnet, roughly
 * $0.014 per video. Cost-tracked via onCostEvent like every other
 * Anthropic path.
 */

export interface VisualDirectorOptions {
  apiKey: string;
  model?: string;
  /** The already-planned script. The director only adds visual decisions. */
  script: Script;
  /** All available images (with role, description, focal, palette). */
  manifest: ImageManifest;
  /** Optional theme context that informs treatment choice. */
  themeContext?: {
    name?: string;
    designBrief?: string;
    tokens?: DesignTokens;
  };
  temperature?: number;
  /** Cost telemetry sink (see PlanOptions.onCostEvent in planner.ts). */
  onCostEvent?: CostEventSink;
}

export interface VisualDirectionEntry {
  /** Matches Script.scenes[i].id. */
  sceneId: string;
  /** null = the director chose pure-typography for this scene. */
  imageId: string | null;
  /** null when imageId is null. */
  treatment: TreatmentId | null;
  /** Optional override of the manifest's focal point for this specific use. */
  focalOverride?: { x: number; y: number };
  /** One-line reasoning shown in the studio overlay + the audit log. */
  rationale: string;
}

export interface VisualDirectionPlan {
  scenes: VisualDirectionEntry[];
  /** Multi-sentence summary of the visual arc the director chose. */
  overallReasoning: string;
}

interface VisualDirectionToolInput {
  scenes: Array<{
    sceneId: string;
    imageId?: string | null;
    treatment?: string | null;
    focalOverride?: { x: number; y: number };
    rationale?: string;
  }>;
  overallReasoning?: string;
}

export class VisualDirectorError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "VisualDirectorError";
  }
}

export async function planVisualDirection(
  opts: VisualDirectorOptions,
): Promise<VisualDirectionPlan> {
  if (opts.manifest.images.length === 0) {
    // Nothing to direct — emit an empty plan so callers can early-return.
    return { scenes: [], overallReasoning: "No images in manifest; visual director skipped." };
  }
  if (opts.script.scenes.length === 0) {
    return { scenes: [], overallReasoning: "Empty script; visual director skipped." };
  }

  const tool = buildTool();
  const system = buildSystem(opts);
  const userMsg = buildUser(opts);
  const model = opts.model ?? DEFAULT_ANTHROPIC_MODEL;

  let result: VisualDirectionToolInput;
  const start = Date.now();
  try {
    const { result: r, usage } = await callStructuredTool<VisualDirectionToolInput>(opts.apiKey, {
      model,
      system,
      user: userMsg,
      tool,
      maxTokens: 4096,
      temperature: opts.temperature ?? 0.55,
    });
    result = r;
    if (opts.onCostEvent) {
      opts.onCostEvent(
        "script.visualDirection",
        {
          kind: "anthropic",
          model,
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          ...(usage.cache_read_input_tokens !== undefined
            ? { cacheReadInputTokens: usage.cache_read_input_tokens }
            : {}),
          ...(usage.cache_creation_input_tokens !== undefined
            ? { cacheCreationInputTokens: usage.cache_creation_input_tokens }
            : {}),
        },
        Date.now() - start,
        {
          sceneCount: opts.script.scenes.length,
          imageCount: opts.manifest.images.length,
        },
      );
    }
  } catch (err) {
    if (err instanceof AnthropicError) {
      throw new VisualDirectorError(`Visual director API call failed: ${err.message}`, err);
    }
    throw err;
  }

  return validateAndNormalize(result, opts);
}

// ── Tool definition ────────────────────────────────────────────────────────

function buildTool(): ToolDefinition {
  return {
    name: "visual_direction",
    description:
      "Assign per-scene image + treatment for a planned script. Goal: maximum visual variety from a small image library while honoring the script's emotional arc.",
    input_schema: {
      type: "object",
      properties: {
        overallReasoning: {
          type: "string",
          description:
            "2-3 sentences describing the visual arc you chose: where image presence escalates, where atmosphere carries the act, where pure typography breathes.",
        },
        scenes: {
          type: "array",
          description: "One entry per scene in the script, in order.",
          items: {
            type: "object",
            properties: {
              sceneId: { type: "string", description: "Must match a Script.scenes[i].id" },
              imageId: {
                type: ["string", "null"],
                description:
                  "Image manifest id, or null when this scene is intentionally typography-only.",
              },
              treatment: {
                type: ["string", "null"],
                enum: [...TREATMENT_IDS, null],
                description:
                  "Required when imageId is non-null. editorial-bleed for hero subject + headline, duotone-bg for atmosphere underlay, type-mask-fill for big reveals.",
              },
              focalOverride: {
                type: "object",
                description:
                  "Optional override of the image's manifest focal point for this specific use (e.g. zoom into a detail).",
                properties: {
                  x: { type: "number", minimum: 0, maximum: 1 },
                  y: { type: "number", minimum: 0, maximum: 1 },
                },
                required: ["x", "y"],
              },
              rationale: {
                type: "string",
                description: "One sentence: why this image+treatment for this scene.",
              },
            },
            required: ["sceneId", "imageId", "treatment", "rationale"],
          },
        },
      },
      required: ["scenes", "overallReasoning"],
    },
  };
}

// ── System prompt ──────────────────────────────────────────────────────────

function buildSystem(opts: VisualDirectorOptions): string {
  const parts: string[] = [];

  parts.push(
    `# Visual director\n\n` +
      `You are the visual director for a video that already has its scene-by-scene script ` +
      `planned. Your only job is to decide WHICH IMAGE (from the project's image library) ` +
      `appears in each scene, and HOW that image is presented (treatment).\n\n` +
      `You are NOT changing scene text, template, audio, or duration. You ARE responsible ` +
      `for the entire visual arc.`,
  );

  parts.push(
    `## Image library\n\n` +
      `Below is the complete catalog of images in this project. Each image has:\n` +
      `- **role**: hero | subject | atmosphere | graphic\n` +
      `  - hero: full-bleed dominant subject, climactic moments\n` +
      `  - subject: detail / supporting, used for crops and callouts\n` +
      `  - atmosphere: pure mood, gradient/blur, lives BEHIND content\n` +
      `  - graphic: abstract / iconographic accents\n` +
      `- **description**: what the image actually shows (user-written)\n` +
      `- **focal**: x,y in 0..1 of the focal subject\n` +
      `- **palette**: dominant + 4 sampled colors\n\n` +
      buildImageCatalog(opts.manifest),
  );

  parts.push(
    `## Treatments (3 available)\n\n` +
      `**editorial-bleed** — Image full-bleed; oversized display headline crosses the subject. ` +
      `Subtle ken-burns. Use for: hero/subject images with strong silhouette in HOOK, CLIMAX, or REVEAL scenes.\n\n` +
      `**duotone-bg** — Atmosphere image as backdrop, recolored toward the theme palette + the ` +
      `image's dominant color. Backdrop-blurred plate holds content. Use for: atmosphere/graphic ` +
      `images as ACT UNDERLAY for stretches of 2–4 consecutive scenes.\n\n` +
      `**type-mask-fill** — Photo visible only inside the headline letters (background-clip:text). ` +
      `Letter-by-letter scale-in. Use for: hero/subject images at BIG-REVEAL or ACT-BREAK moments. ` +
      `Strongest visual punch — use sparingly (≤2 per video).`,
  );

  parts.push(
    `## Constraints (these matter — variety is the entire point)\n\n` +
      `1. **Re-use across treatments**: any subject/hero image you place must use ≥3 DIFFERENT ` +
      `   treatments across the video. Otherwise the same image looks the same five times in a row.\n` +
      `2. **Adjacency**: never use the same image+treatment combination within 3 scenes of itself.\n` +
      `3. **Atmosphere as underlay**: atmosphere/graphic images should underlay 2-4 CONSECUTIVE ` +
      `   scenes (an act), not single scenes. They give the act its color grade.\n` +
      `4. **Breathing room**: ~30-40% of scenes should have NO image (imageId: null). Pure ` +
      `   typography or chart-driven scenes give the eye rest. Don't fill every slot.\n` +
      `5. **Intensity arc**: open soft, escalate to climax, settle for the close. type-mask-fill ` +
      `   belongs at the climax or a major act break, not scene 1 and not the outro.\n` +
      `6. **Hook scenes**: scenes flagged as hooks deserve hero/subject imagery in editorial-bleed ` +
      `   or type-mask-fill. Atmosphere is too quiet for a hook. **Prefer images with retention ` +
      `   strength ≥7** (when the analyzer prior is shown) for hook slots — the visually strongest ` +
      `   asset earns the most-watched scene.\n` +
      `7. **Scene template hint**: scenes already using chart-scene, hook-statreveal, or quote ` +
      `   templates often work better with no image (imageId: null) so the typography sings — ` +
      `   override only when an atmosphere image makes the act cohere.\n` +
      `8. **Self-imaging templates** (hook-vhs-rip, kinetic-words): these templates paint their ` +
      `   own photo treatment (chromatic VHS distortion, word-by-word emphasis on a blurred ` +
      `   backdrop). Assign a hero/subject image to them via imageId, but pass **treatment: null** ` +
      `   so the assembler keeps the planner's chosen template instead of routing through ` +
      `   image-scene. The image will be rendered using the template's own visual language.\n` +
      `9. **editorial-serif** scenes are typography-only by design — pass imageId: null and ` +
      `   treatment: null. Don't try to attach an image; the breath scene needs negative space.\n` +
      `10. **Analyzer priors are advisory**. When a catalog entry has "(analyzer prior)" lines, ` +
      `    treat them as a starting point but override freely when scene context demands it. The ` +
      `    same hero image should still appear in ≥3 different treatments across the video — ` +
      `    don't lock yourself into the analyzer's single suggestion.`,
  );

  if (opts.themeContext?.name) {
    parts.push(`## Active theme\n\nName: **${opts.themeContext.name}**`);
  }
  if (opts.themeContext?.designBrief?.trim()) {
    parts.push(
      `## Design brief\n\n` +
        wrapUserContent("user_design_brief", opts.themeContext.designBrief.trim()),
    );
  }

  parts.push(
    `## Output\n\n` +
      `Call the visual_direction tool with one entry per scene, IN SCRIPT ORDER. ` +
      `Every sceneId in the script must appear exactly once. Don't make up image ids — only ` +
      `use ids that exist in the catalog above. Keep rationales to one sentence.`,
  );

  return parts.join("\n\n");
}

function buildImageCatalog(manifest: ImageManifest): string {
  if (manifest.images.length === 0) return "(no images)";
  return manifest.images
    .map((img) => {
      const desc =
        img.description.trim() || "(no description supplied — use the file id as the cue)";
      const lines = [
        `### ${img.id}`,
        `role: ${img.role ?? "(unset)"} · ${img.width}×${img.height} (${img.aspect.toFixed(2)})`,
        `focal: x=${img.focalPoint.x.toFixed(2)} y=${img.focalPoint.y.toFixed(2)}`,
        `dominant: ${img.dominantColor} · palette: ${img.palette.join(" ")}`,
        `tags: ${img.tags.length > 0 ? img.tags.join(", ") : "(none)"}`,
        `description: ${desc}`,
      ];
      // Surface analyzer priors when present. These are *soft* — the
      // director can override based on script context (e.g. analyzer says
      // duotone-bg but the scene wants a hook so we use editorial-bleed
      // anyway). Mark them clearly as "(analyzer prior)" so the model
      // knows they're advisory.
      if (img.vibe?.trim()) {
        lines.push(`vibe (analyzer prior): ${img.vibe.trim()}`);
      }
      if (img.suggestedTreatment) {
        lines.push(`suggested treatment (analyzer prior): ${img.suggestedTreatment}`);
      }
      if (typeof img.retentionStrengthAtAttachment === "number") {
        lines.push(`retention strength (analyzer prior): ${img.retentionStrengthAtAttachment}/10`);
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

// ── User message ───────────────────────────────────────────────────────────

function buildUser(opts: VisualDirectorOptions): string {
  const parts: string[] = [];
  parts.push(`# Script (${opts.script.scenes.length} scenes)`);
  if (opts.script.meta.title) {
    parts.push(`Title: ${opts.script.meta.title}`);
  }
  if (opts.script.meta.overallReasoning) {
    parts.push(`Planner's overall reasoning: ${opts.script.meta.overallReasoning}`);
  }
  parts.push("");

  for (const scene of opts.script.scenes) {
    const hookTag = scene.hook ? "  [HOOK]" : "";
    const tplTag = scene.template ? `  template:${scene.template}` : "";
    parts.push(`## ${scene.id}${hookTag}${tplTag}`);
    parts.push(scene.text || "(no narration)");
    parts.push("");
  }

  parts.push("Now call the visual_direction tool. Honor every constraint in the system prompt.");
  return parts.join("\n");
}

// ── Validation ─────────────────────────────────────────────────────────────

function validateAndNormalize(
  result: VisualDirectionToolInput,
  opts: VisualDirectorOptions,
): VisualDirectionPlan {
  if (!result || !Array.isArray(result.scenes)) {
    throw new VisualDirectorError("Visual director returned no scenes array.");
  }
  const knownImageIds = new Set(opts.manifest.images.map((i) => i.id));
  const knownSceneIds = new Set(opts.script.scenes.map((s) => s.id));
  const seen = new Set<string>();
  const out: VisualDirectionEntry[] = [];

  for (const raw of result.scenes) {
    if (!raw || typeof raw !== "object") continue;
    const sceneId = String(raw.sceneId ?? "");
    if (!knownSceneIds.has(sceneId) || seen.has(sceneId)) continue;
    seen.add(sceneId);

    const rawImage = raw.imageId;
    const imageId = typeof rawImage === "string" && knownImageIds.has(rawImage) ? rawImage : null;
    const rawTreatment = raw.treatment;
    const treatment =
      imageId &&
      typeof rawTreatment === "string" &&
      (TREATMENT_IDS as readonly string[]).includes(rawTreatment)
        ? (rawTreatment as TreatmentId)
        : null;

    const entry: VisualDirectionEntry = {
      sceneId,
      imageId,
      treatment,
      rationale: typeof raw.rationale === "string" ? raw.rationale : "",
    };
    if (
      raw.focalOverride &&
      typeof raw.focalOverride.x === "number" &&
      typeof raw.focalOverride.y === "number" &&
      raw.focalOverride.x >= 0 &&
      raw.focalOverride.x <= 1 &&
      raw.focalOverride.y >= 0 &&
      raw.focalOverride.y <= 1
    ) {
      entry.focalOverride = { x: raw.focalOverride.x, y: raw.focalOverride.y };
    }
    out.push(entry);
  }

  // Backfill any missing scenes with no-image entries so downstream code can
  // assume one entry per scene.
  for (const scene of opts.script.scenes) {
    if (!seen.has(scene.id)) {
      out.push({
        sceneId: scene.id,
        imageId: null,
        treatment: null,
        rationale: "(visual director did not assign — left as typography)",
      });
    }
  }

  // Re-order to script order.
  const indexById = new Map(opts.script.scenes.map((s, i) => [s.id, i]));
  out.sort((a, b) => (indexById.get(a.sceneId) ?? 0) - (indexById.get(b.sceneId) ?? 0));

  return {
    scenes: out,
    overallReasoning: typeof result.overallReasoning === "string" ? result.overallReasoning : "",
  };
}
