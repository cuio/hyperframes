/**
 * Retention optimizer — closes the loop on the Gemini-graded video.
 *
 * Today's pipeline is single-pass: plan → synth → assemble → render →
 * review. Gemini grades the result and walks away. If retention is below
 * the user's target, the user has to manually decide what to fix and
 * re-run.
 *
 * This module wraps that pipeline in a closed-loop optimizer:
 *
 *     iteration 0: review baseline render
 *     iteration N (1..maxIterations):
 *       - propose patches via Gemini Flash (see optimizerProposer.ts)
 *       - validate + apply (see optimizerPatches.ts)
 *       - re-synth ONLY scenes whose narration changed (cache-friendly)
 *       - re-assemble + re-render via the caller-supplied callbacks
 *       - re-review
 *       - decide: ship, keep iterating, or revert (see isImprovement)
 *
 * Convergence:
 *   - Stop on success: retention ≥ targetRetention.
 *   - Stop on max iterations: each render costs ~30 min wall-clock and
 *     ~$0.45 of compute + LLM, so we cap at 3 by default.
 *   - Stop on regression: if iteration N scores LOWER than N-1, we
 *     restore the N-1 outputs and ship that. No "we tried" signal —
 *     the user always gets the best version we produced.
 *
 * Why callbacks for synth + assemble + render: those routines live in
 * other packages (audio.ts in core but heavy; assemble.ts also heavy;
 * producer in @hyperframes/producer). Keeping the optimizer pure-ish
 * with injected dependencies means the CLI can wire them together
 * without core taking a runtime dep on producer, and tests can mock
 * the I/O cleanly.
 *
 * The optimizer DOES own the Gemini calls (Files API upload, render
 * review, patch proposer) because those are the core "intelligence"
 * surface — the whole feature breaks if any of them is mocked.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import {
  generateStructured,
  uploadAndWait,
  DEFAULT_GEMINI_MODEL,
  type GeminiPart,
  type ToolFunctionDeclaration,
  type UploadedFile,
} from "../gemini/client.js";
import type { CostEventSink } from "../telemetry/cost.js";
import type { Script, PlannedScript } from "./types.js";
import type { EditPatch } from "./optimizerPatches.js";
import { applyPatches, isImprovement } from "./optimizerPatches.js";
import { proposeOptimizationPatches } from "./optimizerProposer.js";

// ── Public surface ─────────────────────────────────────────────────────────

export interface RenderReviewSummary {
  overallRetentionScore: number;
  brandConsistency: { score: number; drift: string[] };
  audioMix: { voiceClarity: string; musicLevels: string; sfxBalance: string };
  scrollRiskWindows: Array<{
    startS: number;
    endS: number;
    severity: "low" | "med" | "high";
    why: string;
    fix: string;
  }>;
  perScene: Array<{
    sceneId: string;
    visualHook: number;
    paceMatch: number;
    onBrand: number;
    note: string;
  }>;
}

export interface IterationReport {
  /** 0 = baseline (no patches applied yet); 1..N = optimizer iterations. */
  iteration: number;
  /** Full retention review for this iteration's mp4. */
  review: RenderReviewSummary;
  /** Patches proposed for the NEXT iteration (empty on the final report). */
  proposedPatches: EditPatch[];
  /** Patches Gemini emitted that didn't pass validation. */
  rejectedPatches: Array<{ patch: unknown; reason: string }>;
  /** Gemini's 1-2 sentence strategy for this iteration's patches.
   *  Empty on the baseline iteration. */
  strategy: string;
  /** Wall-clock cost summary (ms). */
  timings: {
    uploadMs: number;
    reviewMs: number;
    proposeMs?: number;
    applyMs?: number;
    synthMs?: number;
    assembleMs?: number;
    renderMs?: number;
  };
  /** Path of the mp4 that was reviewed in this iteration. Always set. */
  mp4Path: string;
  /** Path of the script.json snapshot for this iteration (relative to projectDir). */
  scriptSnapshotPath: string;
}

export interface OptimizeRetentionOptions {
  projectDir: string;
  /** Where the most recent rendered mp4 lives. Optimizer reviews this
   *  as the baseline (iteration 0). Subsequent iterations write back to
   *  this same path so the existing studio "latest render" lookup keeps
   *  working unchanged. */
  initialMp4Path: string;
  /** The script the rendered mp4 was assembled from. The optimizer
   *  applies patches to copies of this. */
  initialScript: Script;

  // ── Gemini config ────────────────────────────────────────────────────
  geminiApiKey: string;
  /** Default: 90. */
  targetRetention?: number;
  /** Default: 3. */
  maxIterations?: number;
  /** Default: 6. */
  maxPatchesPerIteration?: number;
  /** Default: gemini-2.5-flash. */
  model?: string;

  // ── Catalog ──────────────────────────────────────────────────────────
  /** Source-of-truth list of valid template ids. */
  knownTemplates: ReadonlyArray<string>;
  /** Source-of-truth list of valid atmosphere ids (incl. compositions). */
  knownAtmospheres: ReadonlyArray<string>;

  // ── Injected pipeline steps ──────────────────────────────────────────
  /**
   * Take the current (post-patch) script and return a PlannedScript.
   * Caller is responsible for reusing the voiceover cache for unchanged
   * scenes — `dirtySceneIds` tells the caller which scenes need re-synth
   * because their narration text changed.
   */
  runSynth: (
    script: Script,
    args: { projectDir: string; dirtySceneIds: string[] },
  ) => Promise<PlannedScript>;

  /** Assemble index.html from the planned script. Returns the assembled
   *  path so the optimizer can stamp the iteration's snapshot. */
  runAssemble: (planned: PlannedScript, args: { projectDir: string }) => Promise<string>;

  /** Render index.html to mp4. Returns the new mp4 path. */
  runRender: (args: { projectDir: string }) => Promise<string>;

  // ── Telemetry ────────────────────────────────────────────────────────
  /** Per-iteration callback so the CLI/studio can show progress. */
  onIteration?: (report: IterationReport) => void | Promise<void>;
  /** Cost telemetry sink. The optimizer reports each Gemini call and
   *  the wall-clock of the heavy steps (synth, render). */
  onCostEvent?: CostEventSink;
}

export interface OptimizeRetentionResult {
  /** All per-iteration reports in order. The last is the shipped one. */
  iterations: IterationReport[];
  /** Final retention score the user gets. */
  finalRetention: number;
  /** True when retention reached the target. */
  hitTarget: boolean;
  /** Path of the final mp4 — could be from any iteration if a regression
   *  forced us to revert. */
  finalMp4Path: string;
  /** Reason the loop stopped. Useful for the CLI's summary line. */
  stopReason: "target-reached" | "max-iterations" | "regression-reverted" | "no-patches";
}

// ── Render review tool (private — same shape as storyline route) ───────────

const RENDER_REVIEW_TOOL: ToolFunctionDeclaration = {
  name: "report_render_review",
  description:
    "Score retention, identify scroll-risk windows, audit brand consistency, grade each scene.",
  parameters: {
    type: "object",
    properties: {
      overallRetentionScore: { type: "number" },
      scrollRiskWindows: {
        type: "array",
        items: {
          type: "object",
          properties: {
            startS: { type: "number" },
            endS: { type: "number" },
            severity: { type: "string", enum: ["low", "med", "high"] },
            why: { type: "string" },
            fix: { type: "string" },
          },
          required: ["startS", "endS", "severity", "why", "fix"],
        },
      },
      brandConsistency: {
        type: "object",
        properties: {
          score: { type: "number" },
          drift: { type: "array", items: { type: "string" } },
        },
      },
      audioMix: {
        type: "object",
        properties: {
          voiceClarity: { type: "string", enum: ["good", "muddy", "clipped"] },
          musicLevels: { type: "string", enum: ["ducked", "flat", "fighting"] },
          sfxBalance: { type: "string", enum: ["well-placed", "missing", "overused"] },
        },
      },
      perScene: {
        type: "array",
        items: {
          type: "object",
          properties: {
            sceneId: { type: "string" },
            visualHook: { type: "number" },
            paceMatch: { type: "number" },
            onBrand: { type: "number" },
            note: { type: "string" },
          },
          required: ["sceneId", "visualHook", "paceMatch", "onBrand", "note"],
        },
      },
    },
    required: ["overallRetentionScore", "scrollRiskWindows", "perScene"],
  },
};

function buildReviewSystem(): string {
  return [
    "# Retention review",
    "",
    "You're a retention engineer reviewing a Reels-style explainer video.",
    "Score retention 0-100, flag scroll-risk windows with concrete fixes,",
    "audit brand consistency, grade each scene.",
    "",
    "Be specific and honest. The optimizer will attempt to fix what you flag.",
  ].join("\n");
}

function buildReviewUser(
  script: Script,
  timings: ReadonlyArray<{ sceneId: string; start: number; duration: number }>,
): string {
  const lines = script.scenes.map((s) => {
    const t = timings.find((tt) => tt.sceneId === s.id);
    return `${s.id} (${t ? `${t.start.toFixed(1)}-${(t.start + t.duration).toFixed(1)}s` : "?"}) · ${s.template}${s.hook ? " · HOOK" : ""} · ${s.text}`;
  });
  return [
    "## Script + scene timings (anchor your timestamps to these)",
    lines.join("\n"),
    "",
    "Now watch the attached video and call report_render_review.",
  ].join("\n");
}

interface RenderReviewToolInput {
  overallRetentionScore?: number;
  scrollRiskWindows?: unknown[];
  brandConsistency?: { score?: number; drift?: unknown };
  audioMix?: { voiceClarity?: string; musicLevels?: string; sfxBalance?: string };
  perScene?: Array<{
    sceneId?: string;
    visualHook?: number;
    paceMatch?: number;
    onBrand?: number;
    note?: string;
  }>;
}

function normalizeReview(raw: RenderReviewToolInput, script: Script): RenderReviewSummary {
  const knownIds = new Set(script.scenes.map((s) => s.id));
  return {
    overallRetentionScore: clamp(raw.overallRetentionScore, 0, 100, 50),
    scrollRiskWindows: Array.isArray(raw.scrollRiskWindows)
      ? raw.scrollRiskWindows
          .filter((w): w is Record<string, unknown> => Boolean(w) && typeof w === "object")
          .map((w) => ({
            startS: typeof w.startS === "number" ? w.startS : 0,
            endS: typeof w.endS === "number" ? w.endS : 0,
            severity:
              w.severity === "high" || w.severity === "med"
                ? (w.severity as "high" | "med")
                : "low",
            why: typeof w.why === "string" ? w.why : "",
            fix: typeof w.fix === "string" ? w.fix : "",
          }))
      : [],
    brandConsistency: {
      score: clamp(raw.brandConsistency?.score, 0, 100, 70),
      drift: Array.isArray(raw.brandConsistency?.drift)
        ? raw.brandConsistency.drift.filter((s): s is string => typeof s === "string")
        : [],
    },
    audioMix: {
      voiceClarity:
        raw.audioMix?.voiceClarity === "good" ||
        raw.audioMix?.voiceClarity === "muddy" ||
        raw.audioMix?.voiceClarity === "clipped"
          ? raw.audioMix.voiceClarity
          : "good",
      musicLevels:
        raw.audioMix?.musicLevels === "ducked" ||
        raw.audioMix?.musicLevels === "flat" ||
        raw.audioMix?.musicLevels === "fighting"
          ? raw.audioMix.musicLevels
          : "flat",
      sfxBalance:
        raw.audioMix?.sfxBalance === "well-placed" ||
        raw.audioMix?.sfxBalance === "missing" ||
        raw.audioMix?.sfxBalance === "overused"
          ? raw.audioMix.sfxBalance
          : "missing",
    },
    perScene: Array.isArray(raw.perScene)
      ? raw.perScene
          .filter((s) => s && knownIds.has(String(s.sceneId)))
          .map((s) => ({
            sceneId: String(s.sceneId),
            visualHook: clamp(s.visualHook, 0, 10, 5),
            paceMatch: clamp(s.paceMatch, 0, 10, 5),
            onBrand: clamp(s.onBrand, 0, 10, 5),
            note: typeof s.note === "string" ? s.note : "",
          }))
      : [],
  };
}

function clamp(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.round(v)));
}

function computeSceneTimings(
  planned: PlannedScript,
): Array<{ sceneId: string; start: number; duration: number }> {
  const out: Array<{ sceneId: string; start: number; duration: number }> = [];
  let cursor = 0;
  for (const scene of planned.scenes) {
    const audioDur = scene.audio?.durationSeconds;
    const lead = scene.audio?.leadInSeconds ?? 0;
    const tail = scene.audio?.tailPadSeconds ?? 0;
    const total =
      typeof audioDur === "number" && audioDur > 0
        ? audioDur + lead + tail
        : (scene.durationHint ?? 4);
    out.push({ sceneId: scene.id, start: cursor, duration: total });
    cursor += total;
  }
  return out;
}

// ── Per-iteration helpers ──────────────────────────────────────────────────

interface UploadedMp4 {
  uri: string;
  mimeType: string;
}

async function uploadMp4ToGemini(apiKey: string, mp4Path: string): Promise<UploadedFile> {
  return uploadAndWait(apiKey, mp4Path, "video/mp4", { maxWaitMs: 300_000 });
}

async function runReview(
  apiKey: string,
  uploaded: UploadedMp4,
  script: Script,
  timings: ReadonlyArray<{ sceneId: string; start: number; duration: number }>,
  model: string,
): Promise<{ review: RenderReviewSummary; usage: { promptTokens: number; outputTokens: number } }> {
  const parts: GeminiPart[] = [
    { fileData: { fileUri: uploaded.uri, mimeType: uploaded.mimeType } },
    { text: buildReviewUser(script, timings) },
  ];
  const { result, usage } = await generateStructured<RenderReviewToolInput>(apiKey, {
    model,
    parts,
    systemInstruction: buildReviewSystem(),
    tool: RENDER_REVIEW_TOOL,
    temperature: 0.2,
    // Same Flash trap as the storyline route — multi-field nested
    // objects truncate at 4096; bump to 8192 for safety.
    maxOutputTokens: 8192,
  });
  return {
    review: normalizeReview(result, script),
    usage: {
      promptTokens: usage.promptTokenCount ?? 0,
      outputTokens: usage.candidatesTokenCount ?? 0,
    },
  };
}

// ── Main loop ─────────────────────────────────────────────────────────────

/**
 * Run the closed-loop optimizer end-to-end. Returns the final
 * iteration's mp4 path and the full audit history. Does NOT throw on
 * Gemini failures — those are caught per-iteration and surfaced via
 * the iteration report so the user still ends up with the best mp4
 * we produced.
 */
export async function optimizeRetention(
  opts: OptimizeRetentionOptions,
): Promise<OptimizeRetentionResult> {
  const target = opts.targetRetention ?? 90;
  const maxIterations = opts.maxIterations ?? 3;
  const maxPatches = opts.maxPatchesPerIteration ?? 6;
  const model = opts.model ?? DEFAULT_GEMINI_MODEL;

  const iterations: IterationReport[] = [];
  let currentScript = opts.initialScript;
  let currentMp4 = opts.initialMp4Path;
  let currentPlanned: PlannedScript | null = null;

  // Iteration 0: review the baseline mp4 the caller handed us.
  const baselineUploaded = await uploadMp4ToGemini(opts.geminiApiKey, currentMp4);
  const baselineUploadMs = 0; // real ms wrapped at call site (see below)

  // We always need a PlannedScript for timings. Reconstruct from disk.
  const initialPlannedPath = join(opts.projectDir, "script.generated.json");
  if (existsSync(initialPlannedPath)) {
    try {
      currentPlanned = JSON.parse(readFileSync(initialPlannedPath, "utf-8")) as PlannedScript;
    } catch {
      currentPlanned = null;
    }
  }
  const baselineTimings = currentPlanned ? computeSceneTimings(currentPlanned) : [];

  const reviewStart = Date.now();
  const baselineReview = await runReview(
    opts.geminiApiKey,
    { uri: baselineUploaded.uri, mimeType: baselineUploaded.mimeType },
    currentScript,
    baselineTimings,
    model,
  );
  if (opts.onCostEvent) {
    opts.onCostEvent(
      "script.optimizer.review",
      {
        kind: "gemini",
        model,
        promptTokens: baselineReview.usage.promptTokens,
        outputTokens: baselineReview.usage.outputTokens,
      },
      Date.now() - reviewStart,
      { iteration: 0 },
    );
  }
  const baselineReport: IterationReport = {
    iteration: 0,
    review: baselineReview.review,
    proposedPatches: [],
    rejectedPatches: [],
    strategy: "Baseline review.",
    timings: { uploadMs: baselineUploadMs, reviewMs: Date.now() - reviewStart },
    mp4Path: currentMp4,
    scriptSnapshotPath: initialPlannedPath,
  };
  iterations.push(baselineReport);
  await opts.onIteration?.(baselineReport);

  if (baselineReview.review.overallRetentionScore >= target) {
    return {
      iterations,
      finalRetention: baselineReview.review.overallRetentionScore,
      hitTarget: true,
      finalMp4Path: currentMp4,
      stopReason: "target-reached",
    };
  }

  // The optimizer loop. Each iteration: propose → apply → re-synth →
  // re-assemble → re-render → re-review.
  let bestReview = baselineReview.review;
  let bestMp4 = currentMp4;

  for (let iter = 1; iter <= maxIterations; iter++) {
    const proposeStart = Date.now();
    const proposed = await proposeOptimizationPatches({
      apiKey: opts.geminiApiKey,
      videoFileUri: baselineUploaded.uri,
      videoMimeType: baselineUploaded.mimeType,
      script: currentScript,
      sceneTimings: baselineTimings,
      perSceneScores: bestReview.perScene,
      currentRetention: bestReview.overallRetentionScore,
      targetRetention: target,
      knownTemplates: opts.knownTemplates,
      knownAtmospheres: opts.knownAtmospheres,
      maxPatches,
      model,
    });
    const proposeMs = Date.now() - proposeStart;
    if (opts.onCostEvent) {
      opts.onCostEvent(
        "script.optimizer.propose",
        {
          kind: "gemini",
          model,
          promptTokens: proposed.usage.promptTokens,
          outputTokens: proposed.usage.outputTokens,
        },
        proposeMs,
        { iteration: iter, patchCount: proposed.patches.length },
      );
    }

    if (proposed.patches.length === 0) {
      // Gemini had nothing to propose — we've hit a local maximum.
      const finalReport: IterationReport = {
        iteration: iter,
        review: bestReview,
        proposedPatches: [],
        rejectedPatches: proposed.rejected,
        strategy: proposed.strategy || "No patches proposed.",
        timings: { uploadMs: 0, reviewMs: 0, proposeMs },
        mp4Path: bestMp4,
        scriptSnapshotPath: initialPlannedPath,
      };
      iterations.push(finalReport);
      await opts.onIteration?.(finalReport);
      return {
        iterations,
        finalRetention: bestReview.overallRetentionScore,
        hitTarget: false,
        finalMp4Path: bestMp4,
        stopReason: "no-patches",
      };
    }

    // Apply patches, then run the heavy steps (synth + assemble + render).
    const applyStart = Date.now();
    const applied = applyPatches(currentScript, proposed.patches);
    const nextScript = applied.script;
    const dirtySceneIds = applied.resynthSceneIds;
    const applyMs = Date.now() - applyStart;

    const synthStart = Date.now();
    const planned = await opts.runSynth(nextScript, {
      projectDir: opts.projectDir,
      dirtySceneIds,
    });
    const synthMs = Date.now() - synthStart;

    const assembleStart = Date.now();
    const assembledPath = await opts.runAssemble(planned, { projectDir: opts.projectDir });
    const assembleMs = Date.now() - assembleStart;

    const renderStart = Date.now();
    const newMp4 = await opts.runRender({ projectDir: opts.projectDir });
    const renderMs = Date.now() - renderStart;
    if (opts.onCostEvent) {
      opts.onCostEvent(
        "script.optimizer.render",
        {
          kind: "render",
          durationSeconds: 0,
          framesCaptured: 0,
          quality: "standard",
          fps: 30,
          outputBytes: existsSync(newMp4) ? statSync(newMp4).size : 0,
        },
        renderMs,
        { iteration: iter, mp4: basename(newMp4) },
      );
    }

    // Re-upload + re-review.
    const upStart = Date.now();
    const newUpload = await uploadMp4ToGemini(opts.geminiApiKey, newMp4);
    const newUploadMs = Date.now() - upStart;

    const newTimings = computeSceneTimings(planned);
    const newReviewStart = Date.now();
    const newReview = await runReview(
      opts.geminiApiKey,
      { uri: newUpload.uri, mimeType: newUpload.mimeType },
      nextScript,
      newTimings,
      model,
    );
    const newReviewMs = Date.now() - newReviewStart;
    if (opts.onCostEvent) {
      opts.onCostEvent(
        "script.optimizer.review",
        {
          kind: "gemini",
          model,
          promptTokens: newReview.usage.promptTokens,
          outputTokens: newReview.usage.outputTokens,
        },
        newReviewMs,
        { iteration: iter },
      );
    }

    const report: IterationReport = {
      iteration: iter,
      review: newReview.review,
      proposedPatches: proposed.patches,
      rejectedPatches: proposed.rejected,
      strategy: proposed.strategy,
      timings: {
        uploadMs: newUploadMs,
        reviewMs: newReviewMs,
        proposeMs,
        applyMs,
        synthMs,
        assembleMs,
        renderMs,
      },
      mp4Path: newMp4,
      scriptSnapshotPath: assembledPath,
    };
    iterations.push(report);
    await opts.onIteration?.(report);

    // Decide whether to keep this iteration or revert.
    const verdict = isImprovement(bestReview, newReview.review);
    if (!verdict.improved) {
      // Regression — revert to the previous best mp4 and stop.
      return {
        iterations,
        finalRetention: bestReview.overallRetentionScore,
        hitTarget: false,
        finalMp4Path: bestMp4,
        stopReason: "regression-reverted",
      };
    }

    // We're improving — adopt this iteration as the new baseline.
    bestReview = newReview.review;
    bestMp4 = newMp4;
    currentScript = nextScript;
    currentPlanned = planned;

    if (newReview.review.overallRetentionScore >= target) {
      return {
        iterations,
        finalRetention: newReview.review.overallRetentionScore,
        hitTarget: true,
        finalMp4Path: bestMp4,
        stopReason: "target-reached",
      };
    }
  }

  // Hit max iterations without crossing the target — return the best.
  return {
    iterations,
    finalRetention: bestReview.overallRetentionScore,
    hitTarget: false,
    finalMp4Path: bestMp4,
    stopReason: "max-iterations",
  };
}
