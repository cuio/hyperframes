/**
 * Reference profile extractor — Gemini Flash watches a reference video
 * and/or a set of reference images, returns a structured aesthetic profile
 * that the planner, visual director, and assembler can consume as a soft
 * prior. The profile is the "vibe" of what the user wants the next render
 * to look like.
 *
 * This is the foundation of the iteration loop:
 *
 *     extract(ref-images, ref-video) → profile.json
 *           ↓
 *     planner / director / assembler bias toward profile
 *           ↓
 *     render
 *           ↓
 *     "make it more like X" → re-extract with new ref → re-render
 *
 * The profile is intentionally compact (≤2KB JSON) — it's a soft prior
 * the LLMs read in their system prompts, not a hard binding. The user's
 * existing script.json + design brief always dominate; the profile fills
 * in gaps the user didn't specify.
 *
 * Why Gemini Flash: it's the only model with native multimodal video AND
 * image input that's cheap enough to run on every iteration. ~$0.01-0.05
 * per extraction depending on video length.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import {
  generateStructured,
  GeminiError,
  uploadAndWait,
  DEFAULT_GEMINI_MODEL,
  type GeminiPart,
  type ToolFunctionDeclaration,
} from "../gemini/client.js";

// ── Profile shape ──────────────────────────────────────────────────────────

/** Compact aesthetic profile fed back into planning + rendering. */
export interface ReferenceProfile {
  version: 1;
  /** ISO timestamp of extraction. */
  extractedAt: string;
  /** What the references were. */
  source: {
    videoPath?: string;
    videoSeconds?: number;
    imagePaths?: string[];
    /** Free-form one-line description from the caller, surfaced verbatim
     *  to the planner so the user's intent is on record next to Gemini's
     *  inferred vibe. */
    userIntent?: string;
  };

  // ── Aesthetic descriptors ────────────────────────────────────────────────

  /** ≤120 chars — the single-sentence vibe (e.g. "gritty editorial documentary
   *  with soft grain and slow zooms"). The planner reads this. */
  vibe: string;

  /** 4–6 hex colors. The visual director uses this as a palette prior;
   *  the user's theme tokens still win when they conflict. */
  palette: string[];

  /** soft = subtle entrances, easings, breathing room. medium = standard
   *  Reels pacing. loud = aggressive cuts, kinetic everything. */
  typographyEnergy: "soft" | "medium" | "loud";

  /** slow = contemplative (3-5s/scene), medium = standard, fast = TikTok
   *  fast cuts (~1.5s/scene). Influences scene durations. */
  pacingDensity: "slow" | "medium" | "fast";

  /** Free-form motion descriptor for the assembler (e.g. "subtle vertical
   *  parallax, no rotation; type fades in word-by-word"). */
  motionVibe: string;

  // ── Structural priors ────────────────────────────────────────────────────

  /**
   * Atmospheres the planner should prefer. From the registered
   * BUILTIN_ATMOSPHERES list. Empty = no preference, use theme defaults.
   * The planner gets these as a positive list.
   */
  recommendedAtmospheres: string[];

  /**
   * Atmospheres the planner should AVOID even if the theme suggests them.
   * The user-driven complaint surface (e.g. "no star/dot patterns" maps
   * to ["cosmic-dust", "particle-field", "geometric-grid"]).
   */
  avoidAtmospheres: string[];

  /**
   * Treatment bias for the visual director. Same ids as
   * packages/core/src/script/templates/image-scene.ts (editorial-bleed,
   * duotone-bg, type-mask-fill). null = no preference.
   */
  treatmentBias: string | null;

  /** Top-2 templates the user's reference favors (e.g. ["kinetic-words",
   *  "hook-bigtext"]). Soft prior — the planner can override. */
  preferredTemplates: string[];

  /**
   * Templates the user clearly didn't like (e.g. "too many polkadots" →
   * ["geometric-grid"]). Stronger signal than recommended; the planner
   * will avoid these unless required by template-specific intent.
   */
  avoidTemplates: string[];

  /** ≤200 chars — one-paragraph rationale showing the user what Gemini saw.
   *  Surfaced in the studio so they can sanity-check the extraction. */
  rationale: string;
}

interface ProfileToolInput {
  vibe?: string;
  palette?: unknown;
  typographyEnergy?: string;
  pacingDensity?: string;
  motionVibe?: string;
  recommendedAtmospheres?: unknown;
  avoidAtmospheres?: unknown;
  treatmentBias?: string | null;
  preferredTemplates?: unknown;
  avoidTemplates?: unknown;
  rationale?: string;
}

// ── Tool ───────────────────────────────────────────────────────────────────

/**
 * The planner needs the list of *real* atmosphere ids to validate against —
 * Gemini will hallucinate names otherwise. Caller passes the registered
 * ids; the prompt builder embeds them in the system message.
 */
export interface ExtractReferenceOptions {
  /** GEMINI_API_KEY. Caller resolves via loadGeminiKey(). */
  apiKey: string;
  /** Optional reference video file (mp4/mov/webm). */
  videoPath?: string;
  /** Optional reference image files (jpg/png/webp). At least one of
   *  videoPath or imagePaths must be set. */
  imagePaths?: string[];
  /** ≤200 chars freeform intent from the user, e.g. "less starry, more
   *  editorial, like a NYT explainer". Threaded into the prompt. */
  userIntent?: string;
  /** Catalog of atmosphere ids the model is allowed to recommend. */
  knownAtmospheres: string[];
  /** Catalog of template ids the model is allowed to recommend. */
  knownTemplates: string[];
  /** Catalog of treatment ids (image-scene treatments). */
  knownTreatments: string[];
  /** Override for the model. Defaults to gemini-2.5-flash. */
  model?: string;
  /** Test seam — overrides Date.now() so the extractedAt is deterministic. */
  nowMs?: number;
}

const SYSTEM_PROMPT_TEMPLATE = (
  knownAtmospheres: string[],
  knownTemplates: string[],
  knownTreatments: string[],
): string =>
  [
    "# Reference vibe extraction",
    "",
    "You are a senior video director auditing reference material to define the aesthetic for the user's NEXT short-form video. The references were chosen by the user as the look they want.",
    "",
    "Your job: extract a compact aesthetic profile by calling the report_reference_profile tool. The profile becomes a soft prior for the planner, visual director, and assembler.",
    "",
    "## Rules",
    "1. **Be concrete**. 'editorial' alone is useless. 'gritty editorial documentary, soft grain, deliberate slow zooms, type fades in word-by-word' is what we want.",
    "2. **Palette**: extract 4-6 hex colors that capture the dominant + accent + contrast. Use real colors you see, not generic web palettes.",
    "3. **Atmospheres**: from the catalog below, recommend up to 3 ids. Avoid up to 3 if the references clearly contrast with them (e.g. clean editorial → avoid cosmic-dust / particle-field / geometric-grid).",
    "4. **Templates**: from the template catalog, list 1-2 the references favor and 0-3 to avoid.",
    "5. **Pacing**: slow ≥3s/scene, medium ~2s, fast ~1.2s. Match what you see, not what you'd default to.",
    "6. **Motion vibe**: one sentence on motion language. 'No rotation, gentle vertical parallax, hold longer on negative space' is a real signal.",
    "7. **User intent ALWAYS wins**. If the user says 'less polkadot' and the references are mixed, weight 'avoidAtmospheres' toward what the user said.",
    "",
    "## Atmosphere catalog (recommend ONLY from this list)",
    knownAtmospheres.map((id) => `- ${id}`).join("\n"),
    "",
    "## Template catalog (recommend ONLY from this list)",
    knownTemplates.map((id) => `- ${id}`).join("\n"),
    "",
    "## Treatment catalog (treatmentBias, or null)",
    knownTreatments.map((id) => `- ${id}`).join("\n"),
  ].join("\n");

const TOOL: ToolFunctionDeclaration = {
  name: "report_reference_profile",
  description:
    "Report the aesthetic profile extracted from the reference material. Becomes a soft prior for the next render.",
  parameters: {
    type: "object",
    properties: {
      vibe: {
        type: "string",
        description: "≤120 chars one-sentence vibe.",
      },
      palette: {
        type: "array",
        items: { type: "string" },
        minItems: 3,
        maxItems: 8,
        description: "Hex colors (#rrggbb) sampled from references.",
      },
      typographyEnergy: {
        type: "string",
        enum: ["soft", "medium", "loud"],
      },
      pacingDensity: {
        type: "string",
        enum: ["slow", "medium", "fast"],
      },
      motionVibe: {
        type: "string",
        description: "One-sentence motion descriptor.",
      },
      recommendedAtmospheres: {
        type: "array",
        items: { type: "string" },
        maxItems: 3,
      },
      avoidAtmospheres: {
        type: "array",
        items: { type: "string" },
        maxItems: 5,
      },
      treatmentBias: {
        type: "string",
        description: "One treatment id or null when no bias.",
      },
      preferredTemplates: {
        type: "array",
        items: { type: "string" },
        maxItems: 3,
      },
      avoidTemplates: {
        type: "array",
        items: { type: "string" },
        maxItems: 5,
      },
      rationale: {
        type: "string",
        description: "≤200 chars: what you saw + why this profile.",
      },
    },
    required: [
      "vibe",
      "palette",
      "typographyEnergy",
      "pacingDensity",
      "motionVibe",
      "recommendedAtmospheres",
      "avoidAtmospheres",
      "preferredTemplates",
      "avoidTemplates",
      "rationale",
    ],
  },
};

// ── Pure helpers ───────────────────────────────────────────────────────────

const ALLOWED_VIDEO_EXTS = new Set([".mp4", ".mov", ".webm", ".m4v"]);
const ALLOWED_IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // 200MB — Gemini Files API limit headroom
const MAX_IMAGE_INLINE_BYTES = 5 * 1024 * 1024; // 5MB per image (inline data)

/**
 * Defensive normalization of the model's tool input. Pure — exported for
 * tests so we can verify clamping without invoking Gemini.
 */
export function normalizeProfile(
  raw: ProfileToolInput,
  catalogs: {
    knownAtmospheres: string[];
    knownTemplates: string[];
    knownTreatments: string[];
  },
  source: ReferenceProfile["source"],
  nowMs = Date.now(),
): ReferenceProfile {
  const atmoSet = new Set(catalogs.knownAtmospheres);
  const tplSet = new Set(catalogs.knownTemplates);
  const trtSet = new Set(catalogs.knownTreatments);

  const filterIds = (input: unknown, allowed: Set<string>): string[] => {
    if (!Array.isArray(input)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const v of input) {
      if (typeof v !== "string") continue;
      const id = v.trim();
      if (!allowed.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  };

  const palette = Array.isArray(raw.palette)
    ? raw.palette
        .filter((v): v is string => typeof v === "string")
        .map((s) => s.trim())
        .filter((s) => HEX_RE.test(s))
        .slice(0, 8)
    : [];

  const energy = (() => {
    const v = typeof raw.typographyEnergy === "string" ? raw.typographyEnergy.toLowerCase() : "";
    return v === "soft" || v === "medium" || v === "loud" ? v : "medium";
  })() as "soft" | "medium" | "loud";

  const pacing = (() => {
    const v = typeof raw.pacingDensity === "string" ? raw.pacingDensity.toLowerCase() : "";
    return v === "slow" || v === "medium" || v === "fast" ? v : "medium";
  })() as "slow" | "medium" | "fast";

  const treatment = (() => {
    if (raw.treatmentBias == null) return null;
    if (typeof raw.treatmentBias !== "string") return null;
    const t = raw.treatmentBias.trim();
    return t.length > 0 && trtSet.has(t) ? t : null;
  })();

  return {
    version: 1,
    extractedAt: new Date(nowMs).toISOString(),
    source,
    vibe: typeof raw.vibe === "string" ? raw.vibe.trim().slice(0, 120) : "",
    palette,
    typographyEnergy: energy,
    pacingDensity: pacing,
    motionVibe: typeof raw.motionVibe === "string" ? raw.motionVibe.trim().slice(0, 200) : "",
    recommendedAtmospheres: filterIds(raw.recommendedAtmospheres, atmoSet),
    avoidAtmospheres: filterIds(raw.avoidAtmospheres, atmoSet),
    treatmentBias: treatment,
    preferredTemplates: filterIds(raw.preferredTemplates, tplSet),
    avoidTemplates: filterIds(raw.avoidTemplates, tplSet),
    rationale: typeof raw.rationale === "string" ? raw.rationale.trim().slice(0, 240) : "",
  };
}

function videoMimeFor(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === ".mp4" || ext === ".m4v") return "video/mp4";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".webm") return "video/webm";
  throw new GeminiError(`extractReferenceProfile: unsupported video extension "${ext}"`);
}

function imageMimeFor(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  throw new GeminiError(`extractReferenceProfile: unsupported image extension "${ext}"`);
}

/**
 * Validate the caller-supplied references. Pure — checks file existence,
 * size, and extension. Throws on any input the API definitely rejects so
 * the studio doesn't waste a Gemini call.
 */
export function validateReferenceInputs(opts: { videoPath?: string; imagePaths?: string[] }): void {
  if (!opts.videoPath && (!opts.imagePaths || opts.imagePaths.length === 0)) {
    throw new GeminiError(
      "extractReferenceProfile: at least one of videoPath or imagePaths is required",
    );
  }
  if (opts.videoPath) {
    if (!existsSync(opts.videoPath)) {
      throw new GeminiError(`reference video does not exist: ${opts.videoPath}`);
    }
    const ext = extname(opts.videoPath).toLowerCase();
    if (!ALLOWED_VIDEO_EXTS.has(ext)) {
      throw new GeminiError(
        `unsupported video extension "${ext}". Allowed: ${[...ALLOWED_VIDEO_EXTS].join(", ")}`,
      );
    }
    const stat = statSync(opts.videoPath);
    if (stat.size > MAX_VIDEO_BYTES) {
      throw new GeminiError(
        `video too large: ${(stat.size / 1024 / 1024).toFixed(0)}MB exceeds ${MAX_VIDEO_BYTES / 1024 / 1024}MB cap`,
      );
    }
  }
  if (opts.imagePaths) {
    for (const p of opts.imagePaths) {
      if (!existsSync(p)) {
        throw new GeminiError(`reference image does not exist: ${p}`);
      }
      const ext = extname(p).toLowerCase();
      if (!ALLOWED_IMAGE_EXTS.has(ext)) {
        throw new GeminiError(
          `unsupported image extension "${ext}" for ${p}. Allowed: ${[...ALLOWED_IMAGE_EXTS].join(", ")}`,
        );
      }
      const stat = statSync(p);
      if (stat.size > MAX_IMAGE_INLINE_BYTES) {
        throw new GeminiError(
          `image too large for inline data: ${p} (${(stat.size / 1024 / 1024).toFixed(1)}MB > 5MB)`,
        );
      }
    }
  }
}

// ── Main entry ─────────────────────────────────────────────────────────────

export interface ExtractReferenceResult {
  profile: ReferenceProfile;
  usage: { promptTokens: number; outputTokens: number };
}

/**
 * Run the full extraction. Uploads the video to Gemini Files API (if
 * provided), inlines all reference images, calls Gemini Flash with the
 * tool-call prompt, normalizes the response.
 *
 * Cost: ~$0.01-0.05 depending on video length. Runs in ~10-30s.
 */
export async function extractReferenceProfile(
  opts: ExtractReferenceOptions,
): Promise<ExtractReferenceResult> {
  validateReferenceInputs({
    ...(opts.videoPath ? { videoPath: opts.videoPath } : {}),
    ...(opts.imagePaths ? { imagePaths: opts.imagePaths } : {}),
  });

  const parts: GeminiPart[] = [];
  const source: ReferenceProfile["source"] = {};

  if (opts.videoPath) {
    const mime = videoMimeFor(opts.videoPath);
    const uploaded = await uploadAndWait(opts.apiKey, opts.videoPath, mime, {
      maxWaitMs: 300_000,
    });
    parts.push({ fileData: { fileUri: uploaded.uri, mimeType: uploaded.mimeType } });
    source.videoPath = opts.videoPath;
    source.videoSeconds = Math.round(uploaded.sizeBytes / 100_000) / 10; // rough proxy
  }

  if (opts.imagePaths && opts.imagePaths.length > 0) {
    for (const p of opts.imagePaths) {
      const bytes = readFileSync(p);
      parts.push({
        inlineData: {
          mimeType: imageMimeFor(p),
          data: Buffer.from(bytes).toString("base64"),
        },
      });
    }
    source.imagePaths = opts.imagePaths.slice();
  }

  const userMsg = opts.userIntent
    ? `User intent: ${opts.userIntent.trim().slice(0, 240)}\n\nNow analyze the references and call report_reference_profile.`
    : "Analyze the references and call report_reference_profile.";
  if (opts.userIntent) source.userIntent = opts.userIntent.trim().slice(0, 240);

  parts.push({ text: userMsg });

  const { result, usage } = await generateStructured<ProfileToolInput>(opts.apiKey, {
    model: opts.model ?? DEFAULT_GEMINI_MODEL,
    parts,
    systemInstruction: SYSTEM_PROMPT_TEMPLATE(
      opts.knownAtmospheres,
      opts.knownTemplates,
      opts.knownTreatments,
    ),
    tool: TOOL,
    temperature: 0.3,
    // Generous headroom — the array fields can blow up Flash's default
    // ceiling, same trap as the render-review tool.
    maxOutputTokens: 4096,
  });

  const profile = normalizeProfile(
    result,
    {
      knownAtmospheres: opts.knownAtmospheres,
      knownTemplates: opts.knownTemplates,
      knownTreatments: opts.knownTreatments,
    },
    source,
    opts.nowMs,
  );

  return {
    profile,
    usage: {
      promptTokens: usage.promptTokenCount ?? 0,
      outputTokens: usage.candidatesTokenCount ?? 0,
    },
  };
}

// ── Persistence ────────────────────────────────────────────────────────────

export const REFERENCE_PROFILE_REL_PATH = ".hyperframes/reference-profile.json";

/**
 * Read the persisted profile from `<projectDir>/.hyperframes/reference-profile.json`.
 * Returns null when missing or malformed.
 */
export function readPersistedProfile(projectDir: string): ReferenceProfile | null {
  const path = join(projectDir, REFERENCE_PROFILE_REL_PATH);
  if (!existsSync(path)) return null;
  try {
    const json = JSON.parse(readFileSync(path, "utf-8")) as Partial<ReferenceProfile>;
    if (json.version !== 1 || typeof json.vibe !== "string") return null;
    return json as ReferenceProfile;
  } catch {
    return null;
  }
}
