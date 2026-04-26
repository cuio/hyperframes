import type { Hono } from "hono";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { StudioApiAdapter } from "../types.js";
import { AnthropicError, callStructuredTool, loadAnthropicKey } from "../../anthropic/index.js";
import { CostLogger, loggerSink } from "../../telemetry/cost.js";
import type { Script } from "../../script/types.js";

/**
 * Storyline routes — Haiku-powered, per-scene creative actions.
 *
 * Each endpoint takes a sceneId, loads the planned script, asks Haiku 4.5 for
 * a directorial suggestion, and returns it WITHOUT writing back to disk. The
 * studio's Storyline tab previews the suggestion and (in a follow-up phase)
 * lets the user accept it via a one-click apply.
 *
 * Why Haiku: these calls are cheap, frequent, scene-scoped — they should be
 * fast and not eat through Sonnet/Opus budgets. Each call is < 1K input
 * tokens and < 200 output tokens, so $0.001 per scene-action.
 */

const SCRIPT_GENERATED = "script.generated.json";
const SCRIPT_RAW = "script.json";
const HAIKU_MODEL = "claude-haiku-4-5-20251001";

/**
 * Per-template on-screen word budget — kept in sync with the playbook's
 * "Visual copy budget" matrix and the studio Storyline helper.
 */
const VISUAL_WORD_BUDGET: Record<string, number> = {
  "hook-bigtext": 8,
  "hook-vhs-rip": 5,
  "kinetic-words": 6,
  "editorial-serif": 4,
  "hook-statreveal": 12,
  "aroll-text": 28,
  "concept-callout": 24,
  comparison: 20,
  quote: 30,
  "outro-cta": 14,
  "image-scene": 12,
  "chart-scene": 16,
};

function loadScript(projectDir: string): Script | null {
  const candidates = [join(projectDir, SCRIPT_GENERATED), join(projectDir, SCRIPT_RAW)];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      return JSON.parse(readFileSync(path, "utf-8")) as Script;
    } catch {
      continue;
    }
  }
  return null;
}

interface CompressBody {
  sceneId?: string;
  /** Optional override of the budget the model should aim for. */
  maxWords?: number;
}

interface CompressToolInput {
  /**
   * For most templates: a single short string. For kinetic-words: a tokenised
   * word array. We accept either and the route normalises both.
   */
  suggestion?: string;
  words?: string[];
  /** One sentence on why this is the strongest compression. Surfaced to UI. */
  rationale?: string;
}

export function registerStorylineRoutes(api: Hono, adapter: StudioApiAdapter): void {
  /**
   * POST /api/projects/:id/storyline/compress
   * Body: { sceneId, maxWords? }
   * Returns: { suggestion?: string, words?: string[], rationale?: string }
   */
  api.post("/projects/:id/storyline/compress", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);

    let body: CompressBody;
    try {
      body = (await c.req.json()) as CompressBody;
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const sceneId = body.sceneId;
    if (!sceneId) return c.json({ error: "sceneId is required" }, 400);

    const script = loadScript(project.dir);
    if (!script) return c.json({ error: "no planned script found in project" }, 404);
    const scene = script.scenes.find((s) => s.id === sceneId);
    if (!scene) return c.json({ error: `scene ${sceneId} not in script` }, 404);

    const apiKey = loadAnthropicKey(project.dir);
    if (!apiKey) return c.json({ error: "ANTHROPIC_API_KEY not set" }, 401);

    const budget = body.maxWords ?? VISUAL_WORD_BUDGET[scene.template] ?? 8;
    const wantsArray = scene.template === "kinetic-words";
    const tool = buildCompressTool(wantsArray);
    const system = buildCompressSystem(scene.template, budget, wantsArray);
    const userMsg = buildCompressUser(scene.text, scene.template, budget);

    const onCostEvent = loggerSink(new CostLogger(project.dir));
    const start = Date.now();
    try {
      const { result, usage } = await callStructuredTool<CompressToolInput>(apiKey, {
        model: HAIKU_MODEL,
        system,
        user: userMsg,
        tool,
        maxTokens: 256,
        temperature: 0.4,
      });
      onCostEvent(
        "script.storyline.compress",
        {
          kind: "anthropic",
          model: HAIKU_MODEL,
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
        },
        Date.now() - start,
        { sceneId, template: scene.template, budget },
      );
      // Normalise the output: kinetic-words wants an array, others want a string.
      if (wantsArray) {
        const words = Array.isArray(result.words)
          ? result.words.map((w) => String(w)).filter((w) => w.length > 0)
          : [];
        if (words.length === 0 && typeof result.suggestion === "string") {
          // Fallback: split a stringy suggestion on whitespace.
          return c.json({
            words: result.suggestion
              .trim()
              .split(/\s+/)
              .filter((w) => w.length > 0),
            rationale: result.rationale ?? "",
          });
        }
        return c.json({ words, rationale: result.rationale ?? "" });
      }
      return c.json({
        suggestion: typeof result.suggestion === "string" ? result.suggestion : "",
        rationale: result.rationale ?? "",
      });
    } catch (err) {
      if (err instanceof AnthropicError) {
        return c.json({ error: `Haiku call failed: ${err.message}` }, 502);
      }
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });
}

// ── Tool definitions + prompts ───────────────────────────────────────────────

function buildCompressTool(wantsArray: boolean): Parameters<typeof callStructuredTool>[1]["tool"] {
  if (wantsArray) {
    return {
      name: "propose_compressed_words",
      description:
        "Propose a tokenised word array for a kinetic-words scene where the closing word is the punch.",
      input_schema: {
        type: "object",
        properties: {
          words: {
            type: "array",
            items: { type: "string" },
            description:
              "3–6 lowercase words, in order. The LAST word is the emphasis word and should be the most loaded one.",
          },
          rationale: {
            type: "string",
            description: "One sentence on why this compression keeps the punch.",
          },
        },
        required: ["words", "rationale"],
      },
    };
  }
  return {
    name: "propose_compressed_headline",
    description:
      "Propose a short on-screen headline that fits the template's word budget while preserving the directorial intent.",
    input_schema: {
      type: "object",
      properties: {
        suggestion: {
          type: "string",
          description: "The compressed headline, within the budget. No trailing punctuation.",
        },
        rationale: {
          type: "string",
          description: "One sentence on why this lands stronger than the original.",
        },
      },
      required: ["suggestion", "rationale"],
    },
  };
}

function buildCompressSystem(template: string, budget: number, wantsArray: boolean): string {
  return [
    "# Compress on-screen copy",
    "",
    "You are a creative director compressing the visual headline of one scene in a Reels-style explainer video.",
    "",
    `The scene is using the **${template}** template. Its on-screen text budget is ${budget} words.`,
    "",
    "Cinematic reels are TERSE — fewer words = stronger punch. Examples of the bar:",
    '- "deliver insane results" (3 words)',
    '- "chase trends" (2 words)',
    '- "you can be incredibly skilled" (5 words, closing word is the punch)',
    "",
    "Rules:",
    `1. Stay at or below ${budget} words.`,
    "2. Lowercase reads stronger than Title Case unless the template explicitly wants caps.",
    "3. Preserve the EMOTIONAL CORE of the narration. Don't paraphrase into something blander.",
    "4. Never add filler ('it is', 'this means', 'in summary'). Cut to the verb / noun / number.",
    "5. If the narration carries a concrete number (% / $ / count), prefer keeping it visible.",
    wantsArray
      ? "6. For kinetic-words: emit a 3–6 entry word array. The LAST entry is the punch — pick the strongest payoff word."
      : "6. Return a single string — no array, no list, no numbered output.",
    "",
    "Return your proposal via the structured tool. Keep the rationale to one sentence.",
  ].join("\n");
}

function buildCompressUser(narration: string, template: string, budget: number): string {
  return [
    "## Scene context",
    "",
    `Template: ${template}`,
    `Budget: ${budget} words`,
    "",
    "## Narration (the audience hears this verbatim)",
    "",
    narration,
    "",
    "Now call the structured tool with your compressed headline.",
  ].join("\n");
}
