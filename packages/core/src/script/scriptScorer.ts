/**
 * scriptScorer — Haiku-powered pre-render retention scoring.
 *
 * Calls Claude Haiku 4.5 with a planned Script and returns a structured
 * report:
 *   - Per-scene scores (hook strength, sentiment, energy, predicted retention)
 *   - Arc-level analysis (overall score, hook quality, energy peaks,
 *     momentum risks, closing strength)
 *   - Targeted recommendations with predicted impact + confidence
 *
 * Why Haiku and not Sonnet/Opus: this runs as a tight in-the-loop
 * iteration step — author edits script, runs `hyperframes score`,
 * iterates. Haiku at 25¢/1M input + $1.25/1M output makes this ~$0.01
 * per call. Sonnet would be 4x; Opus would be 20x. The signal-to-cost
 * ratio for "is this script's opening strong enough" is what Haiku
 * was built for.
 *
 * Why Haiku and not Gemini: we already use Gemini Flash for the
 * post-render review (gemini-review.ts) which scores the rendered
 * video frames. The pre-render scorer is text-only and benefits from
 * Anthropic's instruction-following on structured-tool calls. Two
 * different model families, two different views of retention, both
 * cheap.
 *
 * The output is fully deterministic in shape (tool_use enforces the
 * schema). The model populates per-scene scores + writes natural-language
 * recommendations; we don't post-process the recs, just surface them.
 *
 * No streaming, no fallback prose. If the tool call fails, we throw
 * and let the caller decide.
 */

import { callStructuredTool, type ToolDefinition } from "../anthropic/index.js";
import type { Script, SceneRef } from "./types.js";

/** Default model — Haiku is the right tier for this. */
export const SCORER_DEFAULT_MODEL = "claude-haiku-4-5";

// ── Output shapes ──────────────────────────────────────────────────────────

export type Sentiment = "alarming" | "aspirational" | "neutral" | "curious" | "warm" | "cold";

export type NarrativeRole = "hook" | "stake" | "proof" | "payoff" | "transition" | "close";

export type RecommendationType =
  | "rewrite-text"
  | "template-swap"
  | "duration-adjust"
  | "split-scene"
  | "merge-scene"
  | "theme-shift"
  | "add-hook";

export type Confidence = "low" | "medium" | "high";

export interface SceneRecommendation {
  /** Kind of change being proposed. */
  type: RecommendationType;
  /** Scene id this applies to. */
  sceneId: string;
  /** Optional field within the scene's props (e.g. "title", "subtitle"). */
  field?: string;
  /** Human-readable suggestion — ready to surface in CLI / UI. */
  suggestion: string;
  /** Predicted retention delta if applied (0–10 scale). */
  predictedImpact: number;
  /** How confident the model is in this recommendation. */
  confidence: Confidence;
}

export interface SceneScore {
  sceneId: string;
  /** 0–10 hook strength — does this scene grab in the first 0.5s? */
  hookStrength: number;
  /** Categorical sentiment label. */
  sentiment: Sentiment;
  /** 0–10 sentiment intensity — how far from neutral. */
  sentimentIntensity: number;
  /** 0–10 energy — visual + narrative momentum combined. */
  energy: number;
  /** 0–100 predicted retention — % of viewers expected to pass through this scene. */
  predictedRetention: number;
  /** What role this scene plays in the arc. */
  narrativeRole: NarrativeRole;
  /** Plain-text reason for the scores. Surfaced to the author. */
  rationale: string;
}

export interface ArcAnalysis {
  /** 0–100 overall script retention (weighted average + curve penalty). */
  overallRetention: number;
  /** 0–10 quality of the opening hook. */
  hookQuality: number;
  /** Scene indices where energy peaks (zero-based). */
  energyPeaks: number[];
  /** Scenes where retention is at risk + why. */
  momentumRisks: Array<{ sceneId: string; reason: string }>;
  /** 0–10 strength of the close / CTA. */
  closingStrength: number;
}

export interface ScriptScore {
  scenes: SceneScore[];
  arc: ArcAnalysis;
  /** Recommendations sorted by predictedImpact descending. */
  recommendations: SceneRecommendation[];
  /** Token usage for cost telemetry. */
  usage: { inputTokens: number; outputTokens: number };
}

// ── Tool definition ────────────────────────────────────────────────────────

const SCORE_TOOL: ToolDefinition = {
  name: "report_script_retention",
  description:
    "Report a structured retention score for the provided script. Score every scene on hook strength, sentiment, energy, and predicted retention. Identify the strongest scenes, the riskiest scenes, and the highest-leverage edits.",
  input_schema: {
    type: "object",
    properties: {
      scenes: {
        type: "array",
        description: "One score entry per planned scene, in the same order.",
        items: {
          type: "object",
          properties: {
            sceneId: { type: "string" },
            hookStrength: { type: "integer", minimum: 0, maximum: 10 },
            sentiment: {
              type: "string",
              enum: ["alarming", "aspirational", "neutral", "curious", "warm", "cold"],
            },
            sentimentIntensity: { type: "integer", minimum: 0, maximum: 10 },
            energy: { type: "integer", minimum: 0, maximum: 10 },
            predictedRetention: { type: "integer", minimum: 0, maximum: 100 },
            narrativeRole: {
              type: "string",
              enum: ["hook", "stake", "proof", "payoff", "transition", "close"],
            },
            rationale: { type: "string" },
          },
          required: [
            "sceneId",
            "hookStrength",
            "sentiment",
            "sentimentIntensity",
            "energy",
            "predictedRetention",
            "narrativeRole",
            "rationale",
          ],
        },
      },
      arc: {
        type: "object",
        properties: {
          overallRetention: { type: "integer", minimum: 0, maximum: 100 },
          hookQuality: { type: "integer", minimum: 0, maximum: 10 },
          energyPeaks: { type: "array", items: { type: "integer", minimum: 0 } },
          momentumRisks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                sceneId: { type: "string" },
                reason: { type: "string" },
              },
              required: ["sceneId", "reason"],
            },
          },
          closingStrength: { type: "integer", minimum: 0, maximum: 10 },
        },
        required: [
          "overallRetention",
          "hookQuality",
          "energyPeaks",
          "momentumRisks",
          "closingStrength",
        ],
      },
      recommendations: {
        type: "array",
        description:
          "Top 3-8 highest-leverage edits, sorted by predictedImpact descending. Each must target a specific scene and propose a specific change.",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: [
                "rewrite-text",
                "template-swap",
                "duration-adjust",
                "split-scene",
                "merge-scene",
                "theme-shift",
                "add-hook",
              ],
            },
            sceneId: { type: "string" },
            field: { type: "string" },
            suggestion: { type: "string" },
            predictedImpact: { type: "integer", minimum: 0, maximum: 10 },
            confidence: { type: "string", enum: ["low", "medium", "high"] },
          },
          required: ["type", "sceneId", "suggestion", "predictedImpact", "confidence"],
        },
      },
    },
    required: ["scenes", "arc", "recommendations"],
  },
};

// ── Public entry point ─────────────────────────────────────────────────────

export interface ScoreScriptOptions {
  apiKey: string;
  /** Override default model (claude-haiku-4-5). */
  model?: string;
  /** Override sampling temperature. Default 0.4 — we want consistency. */
  temperature?: number;
}

/**
 * Score a planned Script via Claude Haiku. Returns per-scene scores, arc
 * analysis, and a sorted recommendations list. Pure I/O — does not
 * mutate the input. All scoring happens in a single Haiku call.
 */
export async function scoreScript(script: Script, opts: ScoreScriptOptions): Promise<ScriptScore> {
  const system = buildSystemPrompt();
  const user = buildUserPrompt(script);
  const { result, usage } = await callStructuredTool<{
    scenes: SceneScore[];
    arc: ArcAnalysis;
    recommendations: SceneRecommendation[];
  }>(opts.apiKey, {
    model: opts.model ?? SCORER_DEFAULT_MODEL,
    system,
    user,
    tool: SCORE_TOOL,
    maxTokens: 4096,
    temperature: opts.temperature ?? 0.4,
  });
  // Sort recommendations by predicted impact descending — the model is
  // told to do this but the contract is enforced here.
  const sorted = [...result.recommendations].sort((a, b) => b.predictedImpact - a.predictedImpact);
  return {
    scenes: result.scenes,
    arc: result.arc,
    recommendations: sorted,
    usage: {
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
    },
  };
}

// ── Prompt builders ────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return [
    "# Script retention scorer",
    "",
    "You score the retention potential of a video script before it's rendered. Your output drives a tight iteration loop — the author edits the script based on your recommendations, re-runs you, and re-renders only when the score is high.",
    "",
    "You are a HARSH but FAIR critic. The goal is to surface the 3–8 highest-leverage edits, not to rubber-stamp the script.",
    "",
    "## Scoring axes",
    "",
    "**hookStrength (0-10)** — does this scene grab attention in the first 0.5s? 9-10: physically can't look away. 7-8: strong. 5-6: works. 3-4: passable. 0-2: scroll trigger.",
    "",
    '**sentiment** — alarming ("X is broken"), aspirational ("X is possible"), curious ("why X?"), warm ("this is for you"), cold (clinical / data-only), neutral (no emotional tone).',
    "",
    "**sentimentIntensity (0-10)** — how far from neutral. 0 is encyclopedia, 10 is shouted manifesto.",
    "",
    "**energy (0-10)** — visual + narrative momentum combined. Considers: word density, claim specificity, how much the scene moves the story forward.",
    "",
    "**predictedRetention (0-100)** — % of viewers expected to PASS THROUGH this scene given its position in the arc. Scene 1 with weak hook = 60%. Scene 1 with great hook = 88%. Scene 5 in a structured arc = 80% even if the scene is mediocre because the audience is committed.",
    "",
    "**narrativeRole** — hook (grab), stake (paint risk/opportunity), proof (data / evidence), payoff (interpretation), transition (bridge / connector), close (CTA / wrap).",
    "",
    "## Arc-level scores",
    "",
    "**overallRetention** — weighted average of per-scene retention with a curve penalty for momentum drops > 15 points.",
    "",
    "**hookQuality** — quality of scenes 1-2 only. The opening determines whether the viewer scrolls.",
    "",
    "**energyPeaks** — scene indices (zero-based) where energy is locally maximum. There should be 3-5 peaks across a normal arc.",
    "",
    '**momentumRisks** — scenes where retention is predicted to drop. Be specific: "s06 lingers 8s on a static visual after a high-energy hook — energy crash."',
    "",
    "**closingStrength** — quality of the final 1-2 scenes. A weak close kills shares, comments, follows.",
    "",
    "## Recommendations",
    "",
    "Return 3-8 highest-leverage edits. Each must be SPECIFIC and ACTIONABLE:",
    "",
    '- BAD: "strengthen the hook"',
    "- GOOD: \"rewrite s01 title from 'BOTS' to '49% BOTS' to lead with the stat — the number is the hook, not the noun\"",
    "",
    '- BAD: "add more energy"',
    '- GOOD: "swap s06 template kinetic-words → cyber-glitch-word; the static-text-on-bg pattern crashes energy after the s05 chart"',
    "",
    "Each recommendation has:",
    "  - **type** — one of: rewrite-text, template-swap, duration-adjust, split-scene, merge-scene, theme-shift, add-hook",
    "  - **sceneId** — the target",
    "  - **field** — which prop (title / subtitle / words / etc.) for rewrite-text",
    "  - **suggestion** — natural language, 1-2 sentences",
    "  - **predictedImpact** (0-10) — retention delta if applied",
    "  - **confidence** (low/medium/high) — your certainty",
    "",
    "Sort recommendations by predictedImpact DESCENDING.",
    "",
    "## Format",
    "",
    "Call `report_script_retention` with the structured score. No prose outside the tool call.",
  ].join("\n");
}

function buildUserPrompt(script: Script): string {
  const lines: string[] = [];
  lines.push("# Planned script");
  if (script.meta.title) lines.push(`**Title:** ${script.meta.title}`);
  if (script.meta.audience) lines.push(`**Audience:** ${script.meta.audience}`);
  if (script.meta.tone) lines.push(`**Tone:** ${script.meta.tone}`);
  if (script.meta.targetDurationSeconds)
    lines.push(`**Target duration:** ${script.meta.targetDurationSeconds}s`);
  lines.push("");
  lines.push(`**Scenes (${script.scenes.length}):**`);
  lines.push("");
  for (let i = 0; i < script.scenes.length; i++) {
    const s = script.scenes[i];
    if (!s) continue;
    lines.push(`### Scene ${i + 1} — id=${s.id}, template=${s.template}`);
    if (s.hook) lines.push("(marked as hook)");
    lines.push(`**Narration:** ${s.text || "(none)"}`);
    if (s.durationHint) lines.push(`**Duration hint:** ${s.durationHint}s`);
    const propsSummary = summarizeProps(s);
    if (propsSummary) lines.push(`**Props:** ${propsSummary}`);
    if (s.reasoning) lines.push(`**Planner's reasoning:** ${s.reasoning}`);
    lines.push("");
  }
  lines.push("Now call `report_script_retention` with your structured assessment.");
  return lines.join("\n");
}

/** Compact prop summary — the model doesn't need the full prop tree. */
function summarizeProps(scene: SceneRef): string {
  const props = (scene.props ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of ["title", "subtitle", "headline", "body", "value", "label", "eyebrow"]) {
    const v = props[key];
    if (typeof v === "string" && v.length > 0) parts.push(`${key}=${truncate(v, 80)}`);
  }
  if (Array.isArray(props.words)) parts.push(`words=[${(props.words as string[]).join(",")}]`);
  if (Array.isArray(props.items)) parts.push(`items=${(props.items as unknown[]).length}`);
  const chart = props.chart as { type?: unknown } | undefined;
  if (chart?.type) parts.push(`chart=${String(chart.type)}`);
  return parts.join("; ");
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
