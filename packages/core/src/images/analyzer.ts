/**
 * Gemini image analyzer — runs once per ingested image and tags it with
 * structured creative metadata that the visual director then consumes as a
 * soft prior.
 *
 * Why this matters: the visual director currently sees only what the user
 * (or the manifest defaults) provided — role is null on every fresh upload,
 * description is empty, tags are empty. With nothing to go on, the LLM
 * either picks treatments at random or always defaults to editorial-bleed.
 * A 1-shot Gemini Flash analysis gives every uploaded image a baseline
 * role + suggested treatment + vibe before the user does any manual
 * tagging, so the very first render already has intentional visual logic.
 *
 * The analyzer is pure with respect to the project — it doesn't touch
 * disk; the studio route writes the patched fields into the manifest.
 *
 *   analyzeImage(apiKey, fileBytes, mimeType) → AnalyzedImage
 *
 * Inline-data path (base64) is preferred over the Files API for analyzer
 * runs because the input is a single thumbnail-sized webp (<1MB) and the
 * caller wants the whole flow to take 1-2 seconds, not 10-30 (Files API
 * needs a separate upload + poll-until-ACTIVE).
 */

import { generateStructured, GeminiError, DEFAULT_GEMINI_MODEL } from "../gemini/client.js";
import type { ToolFunctionDeclaration } from "../gemini/client.js";
import { TREATMENT_IDS, type TreatmentId } from "../script/templates/image-scene.js";
import type { ImageRole } from "./manifest.js";

const VALID_ROLES: ReadonlyArray<ImageRole> = ["hero", "subject", "atmosphere", "graphic"];

export interface AnalyzedImage {
  /** Inferred role classification. Soft suggestion — user can override. */
  role: ImageRole;
  /** Mood phrase, ≤60 chars. Used for design-brief threading and tag suggestions. */
  vibe: string;
  /**
   * Recommended treatment for image-scene template. The visual director
   * uses this as a soft prior; not a hard binding. null = the analyzer
   * thinks this image is best left as backdrop / atmosphere with no
   * specific image-scene treatment.
   */
  suggestedTreatment: TreatmentId | null;
  /**
   * 1-10 score: how strong is this image as a retention driver if used in
   * a hook scene? High = striking subject, strong contrast, clear focal
   * point. Low = busy, low-contrast, ambiguous subject. Soft signal only.
   */
  retentionStrengthAtAttachment: number;
  /** One-sentence analyst rationale shown in the studio image card. */
  rationale: string;
}

interface AnalyzeImageToolInput {
  role?: string;
  vibe?: string;
  suggestedTreatment?: string | null;
  retentionStrengthAtAttachment?: number;
  rationale?: string;
}

const ANALYZER_TOOL: ToolFunctionDeclaration = {
  name: "image_analysis",
  description:
    "Classify a project image's creative role, vibe, and suggested image-scene treatment, plus a 1-10 retention-strength estimate.",
  parameters: {
    type: "object",
    properties: {
      role: {
        type: "string",
        enum: [...VALID_ROLES],
        description:
          "hero=full-bleed dominant subject; subject=detail/supporting/callout; atmosphere=pure mood backdrop; graphic=abstract/iconographic accent.",
      },
      vibe: {
        type: "string",
        description:
          "Single mood phrase ≤60 chars (e.g. 'gritty desert noir', 'clean editorial blue', 'dreamy gradient').",
      },
      suggestedTreatment: {
        type: "string",
        enum: [...TREATMENT_IDS],
        description:
          "editorial-bleed for hero/subject with strong silhouette; duotone-bg for atmosphere/graphic backdrops; type-mask-fill for high-contrast big-reveal moments. Pick the single best fit.",
      },
      retentionStrengthAtAttachment: {
        type: "integer",
        minimum: 1,
        maximum: 10,
        description:
          "1-10. How strong is this image as a hook visual? 9-10 = striking, instantly readable subject. 5-6 = decent supporting shot. 1-3 = busy, low-contrast, weak focal point.",
      },
      rationale: {
        type: "string",
        description: "One sentence: why this role + treatment + score for this image.",
      },
    },
    required: ["role", "vibe", "suggestedTreatment", "retentionStrengthAtAttachment", "rationale"],
  },
};

const SYSTEM_PROMPT =
  "You are a senior video director auditioning an image for a short-form retention-optimized video. " +
  "You are looking at one image. Answer in the function call. " +
  "Be honest about retention strength — busy, ambiguous, or low-contrast images deserve scores of 3-5, " +
  "not 8. The user benefits more from accurate signal than from flattery. " +
  "For role: prefer 'subject' over 'hero' unless the image truly has a single dominant subject filling " +
  "most of the frame. For treatment: pick the SINGLE best fit; the visual director will decide whether " +
  "to honor it.";

const USER_PROMPT =
  "Analyze the attached image and call the image_analysis tool with your assessment.";

export interface AnalyzeImageResult {
  analyzed: AnalyzedImage;
  usage: {
    promptTokens: number;
    outputTokens: number;
  };
}

/**
 * Run Gemini Flash on an image and return structured analysis. Throws
 * GeminiError on API failure; callers should treat that as a soft signal
 * (mark analysis as failed in the manifest, fall back to user-typed
 * metadata) rather than blocking the upload.
 */
export async function analyzeImage(
  apiKey: string,
  fileBytes: Uint8Array | Buffer,
  mimeType: string,
  opts: { model?: string } = {},
): Promise<AnalyzeImageResult> {
  if (!fileBytes || fileBytes.byteLength === 0) {
    throw new GeminiError("analyzeImage: fileBytes is empty");
  }
  if (!mimeType || !mimeType.startsWith("image/")) {
    throw new GeminiError(`analyzeImage: unsupported mimeType "${mimeType}"`);
  }
  // Buffer.toString("base64") works for both Buffer and Uint8Array via the
  // Buffer.from coercion — keeps the call site simple for browser-fetch
  // typed arrays AND node fs.readFileSync buffers.
  const base64 =
    fileBytes instanceof Buffer
      ? fileBytes.toString("base64")
      : Buffer.from(fileBytes).toString("base64");

  const { result, usage } = await generateStructured<AnalyzeImageToolInput>(apiKey, {
    model: opts.model ?? DEFAULT_GEMINI_MODEL,
    parts: [{ inlineData: { mimeType, data: base64 } }, { text: USER_PROMPT }],
    systemInstruction: SYSTEM_PROMPT,
    tool: ANALYZER_TOOL,
    temperature: 0.3,
    maxOutputTokens: 1024,
  });

  return {
    analyzed: normalizeAnalysis(result),
    usage: {
      promptTokens: usage.promptTokenCount ?? 0,
      outputTokens: usage.candidatesTokenCount ?? 0,
    },
  };
}

/**
 * Defensive normalization of the model's tool input. Pure — exported so
 * tests can verify clamping/coercion without invoking Gemini.
 */
export function normalizeAnalysis(raw: AnalyzeImageToolInput): AnalyzedImage {
  const role = coerceRole(raw.role);
  const treatment = coerceTreatment(raw.suggestedTreatment);
  const vibe = typeof raw.vibe === "string" ? raw.vibe.trim().slice(0, 60) : "";
  const score = clampScore(raw.retentionStrengthAtAttachment);
  const rationale = typeof raw.rationale === "string" ? raw.rationale.trim().slice(0, 240) : "";
  return {
    role,
    vibe,
    suggestedTreatment: treatment,
    retentionStrengthAtAttachment: score,
    rationale,
  };
}

function coerceRole(value: unknown): ImageRole {
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if ((VALID_ROLES as readonly string[]).includes(lower)) {
      return lower as ImageRole;
    }
  }
  // Default to subject — safest middle ground. Subject can underlay or
  // foreground; misclassifying as hero would over-promote a weak image.
  return "subject";
}

function coerceTreatment(value: unknown): TreatmentId | null {
  if (value === null) return null;
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if ((TREATMENT_IDS as readonly string[]).includes(lower)) {
      return lower as TreatmentId;
    }
  }
  return null;
}

function clampScore(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 5;
  return Math.max(1, Math.min(10, Math.round(value)));
}

/**
 * Map a role to the analyzer's preferred default treatment. Used when the
 * model omits suggestedTreatment but a role is present, and as a sanity
 * check by tests. Pure helper.
 */
export function defaultTreatmentForRole(role: ImageRole): TreatmentId | null {
  switch (role) {
    case "hero":
      return "editorial-bleed";
    case "subject":
      return "editorial-bleed";
    case "atmosphere":
      return "duotone-bg";
    case "graphic":
      return "duotone-bg";
    default:
      return null;
  }
}
