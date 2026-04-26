import type { Hono } from "hono";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { StudioApiAdapter } from "../types.js";
import { AnthropicError, callStructuredTool, loadAnthropicKey } from "../../anthropic/index.js";
import type { ToolDefinition } from "../../anthropic/index.js";
import { CostLogger, loggerSink } from "../../telemetry/cost.js";
import type { Script, SceneRef } from "../../script/types.js";
import { listAvailableThemes, loadDesignBrief, resolveActiveTheme } from "../../script/index.js";

type Scene = SceneRef;

/**
 * Storyline routes — Haiku-powered, per-scene creative actions.
 *
 * Every action returns the same shape so the studio Storyline tab has one
 * code path for all suggestions:
 *
 *     { preview: string, rationale: string, patch: ScenePatch }
 *
 * `patch` is a partial scene blob the client merges into the current scene
 * before PUTting via the existing `/script/scenes/:sceneId` endpoint. Keeping
 * apply on the client side means the user can preview a stack of suggestions
 * at once and accept them à la carte without us inventing a new merge route.
 *
 * Why Haiku across the board: these calls are scene-scoped, sub-second, and
 * land cheaper than $0.001 each. The planner (Sonnet) and visual director
 * (Sonnet) stay reserved for the heavy structural work; Haiku does the
 * directorial polish.
 */

const SCRIPT_GENERATED = "script.generated.json";
const SCRIPT_RAW = "script.json";
const HAIKU_MODEL = "claude-haiku-4-5-20251001";

/**
 * Per-template on-screen word budget — kept in sync with the playbook's
 * "Visual copy budget" matrix and the studio Storyline helper. Server side
 * because the server never trusts client-supplied limits.
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

const TEMPLATE_HEADLINE_FIELD: Record<string, string> = {
  "hook-bigtext": "title",
  "hook-vhs-rip": "title",
  "aroll-text": "title",
  "concept-callout": "title",
  "image-scene": "headline",
  "chart-scene": "title",
  comparison: "title",
  quote: "quote",
  "outro-cta": "title",
  "editorial-serif": "phrase",
  "hook-statreveal": "label",
};

interface ScenePatch {
  template?: string;
  props?: Record<string, unknown>;
  reasoning?: string;
}

interface SuggestionResponse {
  preview: string;
  rationale: string;
  patch: ScenePatch;
}

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

interface SceneActionRequest {
  sceneId?: string;
  /** Optional override of the per-template budget (compress only). */
  maxWords?: number;
}

export function registerStorylineRoutes(api: Hono, adapter: StudioApiAdapter): void {
  // POST /api/projects/:id/storyline/compress
  api.post("/projects/:id/storyline/compress", async (c) => {
    const ctx = await loadActionContext(c.req.param("id"), c, adapter);
    if ("errorRes" in ctx) return ctx.errorRes;
    const { project, scene, body } = ctx;
    const apiKey = loadAnthropicKey(project.dir);
    if (!apiKey) return c.json({ error: "ANTHROPIC_API_KEY not set" }, 401);

    const budget = body.maxWords ?? VISUAL_WORD_BUDGET[scene.template] ?? 8;
    const wantsArray = scene.template === "kinetic-words";
    return callHaikuAction(c, project.dir, apiKey, "compress", {
      tool: buildCompressTool(wantsArray),
      system: buildCompressSystem(scene.template, budget, wantsArray),
      user: buildCompressUser(scene.text, scene.template, budget),
      buildResponse: (raw: CompressToolInput) => buildCompressResponse(raw, scene, wantsArray),
      meta: { sceneId: scene.id, template: scene.template, budget },
    });
  });

  // POST /api/projects/:id/storyline/suggest-emphasis
  api.post("/projects/:id/storyline/suggest-emphasis", async (c) => {
    const ctx = await loadActionContext(c.req.param("id"), c, adapter);
    if ("errorRes" in ctx) return ctx.errorRes;
    const { project, scene } = ctx;
    const apiKey = loadAnthropicKey(project.dir);
    if (!apiKey) return c.json({ error: "ANTHROPIC_API_KEY not set" }, 401);

    return callHaikuAction(c, project.dir, apiKey, "suggestEmphasis", {
      tool: buildEmphasisTool(scene.template === "kinetic-words"),
      system: buildEmphasisSystem(scene.template),
      user: buildEmphasisUser(scene),
      buildResponse: (raw: EmphasisToolInput) => buildEmphasisResponse(raw, scene),
      meta: { sceneId: scene.id, template: scene.template },
    });
  });

  // POST /api/projects/:id/storyline/refine-reasoning
  api.post("/projects/:id/storyline/refine-reasoning", async (c) => {
    const ctx = await loadActionContext(c.req.param("id"), c, adapter);
    if ("errorRes" in ctx) return ctx.errorRes;
    const { project, scene } = ctx;
    const apiKey = loadAnthropicKey(project.dir);
    if (!apiKey) return c.json({ error: "ANTHROPIC_API_KEY not set" }, 401);

    return callHaikuAction(c, project.dir, apiKey, "refineReasoning", {
      tool: REASONING_TOOL,
      system: buildReasoningSystem(),
      user: buildReasoningUser(scene),
      buildResponse: (raw: ReasoningToolInput): SuggestionResponse => ({
        preview: raw.reasoning ?? "",
        rationale: raw.rationale ?? "Sharpened to surface the directorial intent.",
        patch: { reasoning: raw.reasoning ?? scene.reasoning ?? "" },
      }),
      meta: { sceneId: scene.id, template: scene.template },
    });
  });

  // POST /api/projects/:id/storyline/re-pick-template
  api.post("/projects/:id/storyline/re-pick-template", async (c) => {
    const ctx = await loadActionContext(c.req.param("id"), c, adapter);
    if ("errorRes" in ctx) return ctx.errorRes;
    const { project, scene } = ctx;
    const apiKey = loadAnthropicKey(project.dir);
    if (!apiKey) return c.json({ error: "ANTHROPIC_API_KEY not set" }, 401);

    return callHaikuAction(c, project.dir, apiKey, "rePickTemplate", {
      tool: REPICK_TOOL,
      system: buildRepickSystem(),
      user: buildRepickUser(scene),
      buildResponse: (raw: RepickToolInput) => buildRepickResponse(raw, scene),
      meta: { sceneId: scene.id, template: scene.template },
    });
  });

  // POST /api/projects/:id/storyline/intent
  // Storyline-level free-form intent: the user types something like "punch
  // up retention in the first 10s" and Haiku returns a list of per-scene
  // patches. Each patch can be applied à la carte from the UI.
  api.post("/projects/:id/storyline/intent", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    let body: { intent?: string };
    try {
      body = (await c.req.json()) as { intent?: string };
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const intent = (body.intent ?? "").trim();
    if (!intent) return c.json({ error: "intent is required" }, 400);
    if (intent.length > 1000) return c.json({ error: "intent too long (max 1000 chars)" }, 400);

    const script = loadScript(project.dir);
    if (!script) return c.json({ error: "no planned script found" }, 404);
    const apiKey = loadAnthropicKey(project.dir);
    if (!apiKey) return c.json({ error: "ANTHROPIC_API_KEY not set" }, 401);

    const onCostEvent = loggerSink(new CostLogger(project.dir));
    const start = Date.now();
    try {
      const { result, usage } = await callStructuredTool<IntentToolInput>(apiKey, {
        model: HAIKU_MODEL,
        system: buildIntentSystem(),
        user: buildIntentUser(script, intent),
        tool: INTENT_TOOL,
        maxTokens: 1500,
        temperature: 0.5,
      });
      onCostEvent(
        "script.storyline.intent",
        {
          kind: "anthropic",
          model: HAIKU_MODEL,
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
        },
        Date.now() - start,
        { sceneCount: script.scenes.length, intentLen: intent.length },
      );
      return c.json(buildIntentResponse(result, script));
    } catch (err) {
      if (err instanceof AnthropicError) {
        return c.json({ error: `Haiku call failed: ${err.message}` }, 502);
      }
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  // POST /api/projects/:id/storyline/scene-intent
  // Per-card free-form intent: the user types a prompt scoped to one scene
  // ("make this hit harder", "swap the accent to a verb"). Haiku gets only
  // the focal scene + a small window of neighbours (default ±2) for context,
  // not the whole script — so the prompt is cheaper and the model stays on
  // task. Returns patches limited to scenes inside the window.
  api.post("/projects/:id/storyline/scene-intent", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    let body: { sceneId?: string; intent?: string; windowSize?: number };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    if (!body.sceneId) return c.json({ error: "sceneId is required" }, 400);
    const intent = (body.intent ?? "").trim();
    if (!intent) return c.json({ error: "intent is required" }, 400);
    if (intent.length > 800) return c.json({ error: "intent too long (max 800 chars)" }, 400);

    const script = loadScript(project.dir);
    if (!script) return c.json({ error: "no planned script found" }, 404);
    const focalIdx = script.scenes.findIndex((s) => s.id === body.sceneId);
    if (focalIdx < 0) return c.json({ error: `scene ${body.sceneId} not in script` }, 404);
    const apiKey = loadAnthropicKey(project.dir);
    if (!apiKey) return c.json({ error: "ANTHROPIC_API_KEY not set" }, 401);

    const window = pickSceneWindow(script, focalIdx, body.windowSize ?? 2);

    const onCostEvent = loggerSink(new CostLogger(project.dir));
    const start = Date.now();
    try {
      const { result, usage } = await callStructuredTool<IntentToolInput>(apiKey, {
        model: HAIKU_MODEL,
        system: buildSceneIntentSystem(),
        user: buildSceneIntentUser(window, focalIdx, intent),
        tool: INTENT_TOOL,
        maxTokens: 800,
        temperature: 0.4,
      });
      onCostEvent(
        "script.storyline.sceneIntent",
        {
          kind: "anthropic",
          model: HAIKU_MODEL,
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
        },
        Date.now() - start,
        { sceneId: body.sceneId, windowSize: window.length, intentLen: intent.length },
      );
      // Reuse the same response builder as storyline-level intent — it filters
      // to scenes that exist in the script, so any out-of-window patches the
      // model accidentally proposes are dropped automatically.
      return c.json(buildIntentResponse(result, script));
    } catch (err) {
      if (err instanceof AnthropicError) {
        return c.json({ error: `Haiku call failed: ${err.message}` }, 502);
      }
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  // POST /api/projects/:id/storyline/project-intent
  // Project-level Director: same free-form intent as /intent but with the
  // active theme + design brief + image manifest summary in scope. Returns
  // scene patches *plus* optional theme suggestion + design-brief addendum.
  // Theme/brief recommendations are non-binding — the user applies them via
  // the existing Theme picker / design-brief edit flow.
  api.post("/projects/:id/storyline/project-intent", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    let body: { intent?: string };
    try {
      body = (await c.req.json()) as { intent?: string };
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const intent = (body.intent ?? "").trim();
    if (!intent) return c.json({ error: "intent is required" }, 400);
    if (intent.length > 1500) return c.json({ error: "intent too long (max 1500 chars)" }, 400);

    const script = loadScript(project.dir);
    if (!script) return c.json({ error: "no planned script found" }, 404);
    const apiKey = loadAnthropicKey(project.dir);
    if (!apiKey) return c.json({ error: "ANTHROPIC_API_KEY not set" }, 401);

    const activeTheme = resolveActiveTheme(project.dir);
    const allThemes = listAvailableThemes(project.dir);
    const designBrief = loadDesignBrief(project.dir, 4000);
    const imageSummary = loadImageManifestSummary(project.dir);
    const projectContext: ProjectIntentContext = {
      activeTheme: {
        id: activeTheme.id,
        name: activeTheme.name,
        description: activeTheme.description,
      },
      themeChoices: allThemes.map((t) => ({ id: t.id, name: t.name, description: t.description })),
      designBrief: designBrief ?? "",
      imageSummary,
    };

    const onCostEvent = loggerSink(new CostLogger(project.dir));
    const start = Date.now();
    try {
      const { result, usage } = await callStructuredTool<ProjectIntentToolInput>(apiKey, {
        model: HAIKU_MODEL,
        system: buildProjectIntentSystem(projectContext),
        user: buildProjectIntentUser(script, intent, projectContext),
        tool: PROJECT_INTENT_TOOL,
        maxTokens: 2000,
        temperature: 0.5,
      });
      onCostEvent(
        "script.storyline.projectIntent",
        {
          kind: "anthropic",
          model: HAIKU_MODEL,
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
        },
        Date.now() - start,
        { sceneCount: script.scenes.length, intentLen: intent.length },
      );
      return c.json(buildProjectIntentResponse(result, script, projectContext));
    } catch (err) {
      if (err instanceof AnthropicError) {
        return c.json({ error: `Haiku call failed: ${err.message}` }, 502);
      }
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  // PATCH /api/projects/:id/storyline/scenes
  // Bulk operations: reorder, insert, delete. One round-trip writes the
  // final scene array atomically. Unlike PUT /scenes/:id this does NOT
  // validate template/props (those have already been validated when each
  // scene was first written). It DOES preserve audio metadata so re-orders
  // don't require re-synth.
  api.patch("/projects/:id/storyline/scenes", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    let body: { ops?: BulkOp[] };
    try {
      body = (await c.req.json()) as { ops?: BulkOp[] };
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const ops = Array.isArray(body.ops) ? body.ops : [];
    if (ops.length === 0) return c.json({ error: "ops array required" }, 400);

    const path = join(project.dir, SCRIPT_RAW);
    if (!existsSync(path)) return c.json({ error: "no script.json on disk" }, 404);
    const { withMutex, atomicWriteFileSync } = await import("../../internal/atomicWrite.js");
    try {
      const updated = await withMutex(`project:${project.dir}:script.json`, async () => {
        const script = JSON.parse(readFileSync(path, "utf-8")) as Script;
        applyBulkOps(script, ops);
        atomicWriteFileSync(path, JSON.stringify(script, null, 2) + "\n");
        return script;
      });
      return c.json({ ok: true, sceneCount: updated.scenes.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 500);
    }
  });
}

// ── Action context loader ────────────────────────────────────────────────────

interface ActionContext {
  project: { dir: string };
  scene: Scene;
  body: SceneActionRequest;
}

async function loadActionContext(
  projectId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  c: any,
  adapter: StudioApiAdapter,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<ActionContext | { errorRes: any }> {
  const project = await adapter.resolveProject(projectId);
  if (!project) return { errorRes: c.json({ error: "not found" }, 404) };
  let body: SceneActionRequest;
  try {
    body = (await c.req.json()) as SceneActionRequest;
  } catch {
    return { errorRes: c.json({ error: "invalid JSON body" }, 400) };
  }
  if (!body.sceneId) return { errorRes: c.json({ error: "sceneId is required" }, 400) };
  const script = loadScript(project.dir);
  if (!script) return { errorRes: c.json({ error: "no planned script found" }, 404) };
  const scene = script.scenes.find((s) => s.id === body.sceneId);
  if (!scene) return { errorRes: c.json({ error: `scene ${body.sceneId} not in script` }, 404) };
  return { project: { dir: project.dir }, scene, body };
}

// ── Generic Haiku-action runner ──────────────────────────────────────────────

interface HaikuActionConfig<T> {
  tool: ToolDefinition;
  system: string;
  user: string;
  buildResponse: (raw: T) => SuggestionResponse;
  meta: Record<string, unknown>;
}

async function callHaikuAction<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  c: any,
  projectDir: string,
  apiKey: string,
  opLabel: string,
  cfg: HaikuActionConfig<T>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const onCostEvent = loggerSink(new CostLogger(projectDir));
  const start = Date.now();
  try {
    const { result, usage } = await callStructuredTool<T>(apiKey, {
      model: HAIKU_MODEL,
      system: cfg.system,
      user: cfg.user,
      tool: cfg.tool,
      maxTokens: 512,
      temperature: 0.4,
    });
    onCostEvent(
      `script.storyline.${opLabel}`,
      {
        kind: "anthropic",
        model: HAIKU_MODEL,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
      },
      Date.now() - start,
      cfg.meta,
    );
    return c.json(cfg.buildResponse(result));
  } catch (err) {
    if (err instanceof AnthropicError) {
      return c.json({ error: `Haiku call failed: ${err.message}` }, 502);
    }
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── Compress action ──────────────────────────────────────────────────────────

interface CompressToolInput {
  suggestion?: string;
  words?: string[];
  rationale?: string;
}

function buildCompressTool(wantsArray: boolean): ToolDefinition {
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
              "3-6 lowercase words, in order. The LAST word is the emphasis word and should be the most loaded one.",
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
    `Template: **${template}**. On-screen text budget: ${budget} words.`,
    "",
    "Cinematic reels are TERSE — fewer words = stronger punch. Examples:",
    '- "deliver insane results" (3 words)',
    '- "chase trends" (2 words)',
    '- "you can be incredibly skilled" (5 words; closing word is the punch)',
    "",
    "Rules:",
    `1. Stay at or below ${budget} words.`,
    "2. Lowercase reads stronger than Title Case unless the template wants caps.",
    "3. Preserve the EMOTIONAL CORE. Don't paraphrase into something blander.",
    "4. Cut filler (it is, this means, in summary). Verb / noun / number only.",
    "5. If the narration carries a number (% / $ / count), prefer keeping it visible.",
    wantsArray
      ? "6. For kinetic-words: emit a 3-6 entry word array. LAST entry is the punch."
      : "6. Return a single string — no array, no list, no numbered output.",
  ].join("\n");
}

function buildCompressUser(narration: string, template: string, budget: number): string {
  return [
    "## Scene context",
    `Template: ${template}`,
    `Budget: ${budget} words`,
    "",
    "## Narration",
    narration,
    "",
    "Now call the structured tool with your compressed headline.",
  ].join("\n");
}

function buildCompressResponse(
  raw: CompressToolInput,
  scene: Scene,
  wantsArray: boolean,
): SuggestionResponse {
  if (wantsArray) {
    let words = Array.isArray(raw.words)
      ? raw.words.map((w) => String(w)).filter((w) => w.length > 0)
      : [];
    if (words.length === 0 && typeof raw.suggestion === "string") {
      words = raw.suggestion
        .trim()
        .split(/\s+/)
        .filter((w) => w.length > 0);
    }
    return {
      preview: words.join(" "),
      rationale: raw.rationale ?? "",
      patch: {
        props: {
          ...scene.props,
          words,
          // Re-anchor emphasis to the final word in the new array.
          emphasisIndex: Math.max(0, words.length - 1),
        },
      },
    };
  }
  const suggestion = typeof raw.suggestion === "string" ? raw.suggestion : "";
  const headlineKey = TEMPLATE_HEADLINE_FIELD[scene.template] ?? "title";
  return {
    preview: suggestion,
    rationale: raw.rationale ?? "",
    patch: {
      props: { ...scene.props, [headlineKey]: suggestion },
    },
  };
}

// ── Suggest-emphasis action ──────────────────────────────────────────────────

interface EmphasisToolInput {
  word?: string;
  emphasisIndex?: number;
  rationale?: string;
}

function buildEmphasisTool(wantsIndex: boolean): ToolDefinition {
  if (wantsIndex) {
    return {
      name: "propose_emphasis_index",
      description: "Pick the index of the punch word in a kinetic-words scene's word array.",
      input_schema: {
        type: "object",
        properties: {
          emphasisIndex: {
            type: "integer",
            minimum: 0,
            description:
              "0-based index into the existing words array. Choose the word with the most weight.",
          },
          rationale: {
            type: "string",
            description: "One sentence on why this word carries the punch.",
          },
        },
        required: ["emphasisIndex", "rationale"],
      },
    };
  }
  return {
    name: "propose_accent_word",
    description: "Pick the strongest accent word from the existing on-screen headline.",
    input_schema: {
      type: "object",
      properties: {
        word: {
          type: "string",
          description: "A single word from the headline that should be highlighted.",
        },
        rationale: {
          type: "string",
          description: "One sentence on why this word lands hardest.",
        },
      },
      required: ["word", "rationale"],
    },
  };
}

function buildEmphasisSystem(template: string): string {
  return [
    "# Pick the punch word",
    "",
    "You're a director selecting the single word in a scene's on-screen headline that should land louder than the rest.",
    "",
    `Template: ${template}.`,
    "",
    "Heuristics:",
    "- Verbs and concrete nouns hit harder than articles or prepositions.",
    "- Numbers and proper nouns are usually the payoff.",
    "- The closing word is often (but not always) the punch.",
    "- Pick the ONE word that, if removed, would gut the sentence.",
  ].join("\n");
}

function buildEmphasisUser(scene: Scene): string {
  return [
    "## Scene",
    `Narration: ${scene.text}`,
    `Template: ${scene.template}`,
    `Current headline props: ${JSON.stringify(scene.props)}`,
    "",
    "Now call the structured tool with the punch word.",
  ].join("\n");
}

function buildEmphasisResponse(raw: EmphasisToolInput, scene: Scene): SuggestionResponse {
  if (scene.template === "kinetic-words") {
    const idx = Number(raw.emphasisIndex);
    const words = Array.isArray(scene.props.words) ? scene.props.words : [];
    const safeIdx =
      Number.isFinite(idx) && idx >= 0 && idx < words.length ? Math.floor(idx) : words.length - 1;
    const wordPreview =
      typeof words[safeIdx] === "string" ? (words[safeIdx] as string) : `index ${safeIdx}`;
    return {
      preview: `Emphasise "${wordPreview}" (index ${safeIdx})`,
      rationale: raw.rationale ?? "",
      patch: {
        props: { ...scene.props, emphasisIndex: safeIdx },
      },
    };
  }
  const word = typeof raw.word === "string" ? raw.word.trim() : "";
  return {
    preview: `Accent "${word}"`,
    rationale: raw.rationale ?? "",
    patch: {
      props: { ...scene.props, accentWord: word },
    },
  };
}

// ── Refine-reasoning action ──────────────────────────────────────────────────

interface ReasoningToolInput {
  reasoning?: string;
  rationale?: string;
}

const REASONING_TOOL: ToolDefinition = {
  name: "propose_refined_reasoning",
  description: "Rewrite the why-this-template explanation so the directorial intent is explicit.",
  input_schema: {
    type: "object",
    properties: {
      reasoning: {
        type: "string",
        description:
          "2-4 sentences. Name the stake, the data, the claim, and the why. Reference specific props (eyebrow, accentWord, subtext) where they carry weight.",
      },
      rationale: {
        type: "string",
        description: "One sentence on what this rewrite makes explicit that the original didn't.",
      },
    },
    required: ["reasoning", "rationale"],
  },
};

function buildReasoningSystem(): string {
  return [
    "# Sharpen the directorial reasoning",
    "",
    "You're rewriting the explanation a planner left for why this scene uses this template + props.",
    "",
    "A great reasoning names FOUR things:",
    "1. STAKE — what's at risk / why it matters.",
    "2. DATA — the concrete number / contrast that carries the weight.",
    "3. CLAIM — what the scene asserts.",
    "4. WHY — why this template+props delivers the claim better than alternatives.",
    "",
    "Be visual: name the animation, the colour, the prop. Don't write generic copy.",
  ].join("\n");
}

function buildReasoningUser(scene: Scene): string {
  return [
    "## Scene",
    `id: ${scene.id}`,
    `template: ${scene.template}`,
    `narration: ${scene.text}`,
    `props: ${JSON.stringify(scene.props)}`,
    `current reasoning: ${scene.reasoning ?? "(none)"}`,
    "",
    "Now call the structured tool with sharper reasoning.",
  ].join("\n");
}

// ── Re-pick-template action ──────────────────────────────────────────────────

interface RepickToolInput {
  template?: string;
  props?: Record<string, unknown>;
  reasoning?: string;
  rationale?: string;
}

const REPICK_TEMPLATES = Object.keys(VISUAL_WORD_BUDGET);

const REPICK_TOOL: ToolDefinition = {
  name: "propose_alternative_template",
  description:
    "Suggest a different template + props for this scene's narration, with a one-sentence rationale.",
  input_schema: {
    type: "object",
    properties: {
      template: {
        type: "string",
        enum: REPICK_TEMPLATES,
        description:
          "A template id different from the current one. Pick the strongest match for the narration.",
      },
      props: {
        type: "object",
        description:
          "Full props blob for the new template. Include every prop the template's schema requires.",
      },
      reasoning: {
        type: "string",
        description: "2-3 sentences naming the stake/data/claim/why.",
      },
      rationale: {
        type: "string",
        description: "One sentence on why the new template beats the current pick.",
      },
    },
    required: ["template", "props", "rationale"],
  },
};

function buildRepickSystem(): string {
  return [
    "# Re-pick the template",
    "",
    "You're a director suggesting an alternative visual treatment for one scene. Don't change the narration — only the template + props.",
    "",
    `Available templates: ${REPICK_TEMPLATES.join(", ")}`,
    "",
    "Rules:",
    "1. Pick a DIFFERENT template than the current one.",
    "2. Honour the per-template word budget for the on-screen text.",
    "3. Fill out every required prop the new template needs.",
    "4. The narration is FIXED — it's already been voiced. Don't propose changes that require re-recording.",
  ].join("\n");
}

function buildRepickUser(scene: Scene): string {
  return [
    "## Current scene",
    `id: ${scene.id}`,
    `template: ${scene.template}`,
    `narration: ${scene.text}`,
    `props: ${JSON.stringify(scene.props)}`,
    "",
    "Now call the structured tool with an alternative template + props.",
  ].join("\n");
}

function buildRepickResponse(raw: RepickToolInput, scene: Scene): SuggestionResponse {
  const template = typeof raw.template === "string" ? raw.template : scene.template;
  const props = raw.props && typeof raw.props === "object" ? raw.props : scene.props;
  return {
    preview: `${template} · ${summariseProps(props)}`,
    rationale: raw.rationale ?? "",
    patch: {
      template,
      props,
      ...(typeof raw.reasoning === "string" ? { reasoning: raw.reasoning } : {}),
    },
  };
}

function summariseProps(props: Record<string, unknown>): string {
  const headline =
    typeof props.title === "string"
      ? props.title
      : typeof props.phrase === "string"
        ? props.phrase
        : Array.isArray(props.words)
          ? (props.words as unknown[]).join(" ")
          : "";
  return headline.slice(0, 60);
}

// ── Storyline-level intent action ────────────────────────────────────────────

interface IntentToolInput {
  scenes?: Array<{
    sceneId?: string;
    template?: string;
    props?: Record<string, unknown>;
    reasoning?: string;
    note?: string;
  }>;
  overallNote?: string;
}

const INTENT_TOOL: ToolDefinition = {
  name: "propose_storyline_revisions",
  description:
    "Given a free-form directorial intent, return per-scene patches that move the script toward that intent.",
  input_schema: {
    type: "object",
    properties: {
      overallNote: {
        type: "string",
        description: "1-2 sentences on the overall strategy you took.",
      },
      scenes: {
        type: "array",
        description:
          "One entry per affected scene. Skip scenes that should not change (don't include a no-op).",
        items: {
          type: "object",
          properties: {
            sceneId: { type: "string" },
            template: {
              type: "string",
              enum: REPICK_TEMPLATES,
              description: "Optional — only set if the template should change.",
            },
            props: {
              type: "object",
              description: "Optional partial props patch. Only set fields that should change.",
            },
            reasoning: {
              type: "string",
              description: "Optional — new reasoning string.",
            },
            note: {
              type: "string",
              description: "One sentence on what this patch does for the intent.",
            },
          },
          required: ["sceneId", "note"],
        },
      },
    },
    required: ["scenes", "overallNote"],
  },
};

function buildIntentSystem(): string {
  return [
    "# Storyline-level revision",
    "",
    "You're a director reviewing a planned video against a free-form intent the user gave.",
    "Read the intent, scan the scene list, and return per-scene patches that move the script toward it.",
    "",
    "Rules:",
    "1. NARRATION IS FIXED. Audio's been recorded — never propose text changes.",
    "2. You can change template, props, accent words, reasoning. Nothing else.",
    "3. Touch only scenes that meaningfully serve the intent. Don't churn for the sake of it.",
    "4. Honour per-template word budgets for on-screen copy.",
    "5. Each per-scene patch is partial — only include fields you want to change.",
    "6. Give each patch a one-sentence note explaining what it does for the intent.",
  ].join("\n");
}

function buildIntentUser(script: Script, intent: string): string {
  const sceneSummary = script.scenes
    .map((s, i) => {
      const headline =
        typeof s.props.title === "string"
          ? s.props.title
          : Array.isArray(s.props.words)
            ? (s.props.words as unknown[]).join(" ")
            : "";
      return `${i + 1}. ${s.id} · ${s.template}${s.hook ? " · HOOK" : ""}\n   narration: ${s.text}\n   visual: ${headline.slice(0, 80)}`;
    })
    .join("\n");
  return [
    "## Director's intent",
    intent,
    "",
    "## Current script",
    sceneSummary,
    "",
    "Now call the structured tool with per-scene patches that serve the intent.",
  ].join("\n");
}

/**
 * Pick a window of scenes around `focalIdx` for the per-scene intent prompt.
 * Returns up to `2 * windowSize + 1` scenes, clamped to script bounds.
 * Pure helper — exported for tests via __testing.
 */
export function pickSceneWindow(
  script: { scenes: SceneRef[] },
  focalIdx: number,
  windowSize: number,
): SceneRef[] {
  const w = Math.max(0, Math.min(8, Math.floor(windowSize)));
  const start = Math.max(0, focalIdx - w);
  const end = Math.min(script.scenes.length, focalIdx + w + 1);
  return script.scenes.slice(start, end);
}

function buildSceneIntentSystem(): string {
  return [
    "# Per-scene revision",
    "",
    "You're a director with a tightly-scoped intent for ONE scene in a planned video.",
    "You see that scene plus a small window of neighbours for context. Touch only the focal scene unless an adjacent scene MUST change to keep the storyline coherent.",
    "",
    "Rules:",
    "1. NARRATION IS FIXED. Never propose text changes.",
    "2. Default scope is the focal scene. Patch a neighbour only when removing your focal change would break it.",
    "3. Honour per-template word budgets for on-screen copy.",
    "4. Each patch is partial — only the fields you want to change.",
    "5. One-sentence note per patch explaining what it does for the intent.",
  ].join("\n");
}

function buildSceneIntentUser(window: SceneRef[], focalIdx: number, intent: string): string {
  const summary = window
    .map((s) => {
      const isFocal =
        // The window's index of the focal scene = focalIdx clamped against the
        // actual list, so we mark it by id rather than by position to be robust.
        s.id === window[focalIdx]?.id || (window.length === 1 && true);
      const headline =
        typeof s.props.title === "string"
          ? s.props.title
          : Array.isArray(s.props.words)
            ? (s.props.words as unknown[]).join(" ")
            : "";
      return [
        `${isFocal ? "→ FOCAL · " : "   "}${s.id} · ${s.template}${s.hook ? " · HOOK" : ""}`,
        `   narration: ${s.text}`,
        `   visual: ${headline.slice(0, 80)}`,
      ].join("\n");
    })
    .join("\n");
  return [
    "## Director's intent (this scene)",
    intent,
    "",
    "## Window",
    summary,
    "",
    "Patch the focal scene first. Touch neighbours only if doing so is required to keep the storyline coherent.",
  ].join("\n");
}

interface IntentResponse {
  overallNote: string;
  patches: Array<{ sceneId: string; preview: string; note: string; patch: ScenePatch }>;
}

function buildIntentResponse(raw: IntentToolInput, script: Script): IntentResponse {
  const sceneById = new Map(script.scenes.map((s) => [s.id, s]));
  const patches: IntentResponse["patches"] = [];
  for (const entry of raw.scenes ?? []) {
    if (!entry.sceneId) continue;
    const scene = sceneById.get(entry.sceneId);
    if (!scene) continue;
    const patch: ScenePatch = {};
    if (typeof entry.template === "string" && entry.template !== scene.template) {
      patch.template = entry.template;
    }
    if (entry.props && typeof entry.props === "object") {
      patch.props = { ...scene.props, ...entry.props };
    }
    if (typeof entry.reasoning === "string") patch.reasoning = entry.reasoning;
    if (Object.keys(patch).length === 0) continue;
    patches.push({
      sceneId: entry.sceneId,
      preview: summarisePatch(patch, scene.template),
      note: entry.note ?? "",
      patch,
    });
  }
  return { overallNote: raw.overallNote ?? "", patches };
}

function summarisePatch(patch: ScenePatch, currentTemplate: string): string {
  const parts: string[] = [];
  if (patch.template && patch.template !== currentTemplate) {
    parts.push(`template → ${patch.template}`);
  }
  if (patch.props) {
    const headline =
      typeof patch.props.title === "string"
        ? patch.props.title
        : Array.isArray(patch.props.words)
          ? (patch.props.words as unknown[]).join(" ")
          : null;
    if (headline) parts.push(`headline: ${String(headline).slice(0, 60)}`);
    if (typeof patch.props.accentWord === "string") {
      parts.push(`accent: ${patch.props.accentWord}`);
    }
  }
  if (patch.reasoning) parts.push("reasoning ✎");
  return parts.join(" · ") || "(no-op)";
}

// ── Bulk operations (reorder / insert / delete) ──────────────────────────────

type BulkOp =
  | { type: "reorder"; sceneIds: string[] }
  | { type: "delete"; sceneId: string }
  | { type: "insert"; afterSceneId: string | null; scene: Partial<Scene> & { id: string } };

function applyBulkOps(script: Script, ops: BulkOp[]): void {
  for (const op of ops) {
    if (op.type === "reorder") {
      const map = new Map(script.scenes.map((s) => [s.id, s]));
      const reordered: Scene[] = [];
      for (const id of op.sceneIds) {
        const s = map.get(id);
        if (s) reordered.push(s);
      }
      // Append any scenes not mentioned in sceneIds (defensive — should be all of them).
      for (const s of script.scenes) {
        if (!op.sceneIds.includes(s.id)) reordered.push(s);
      }
      script.scenes = reordered;
    } else if (op.type === "delete") {
      script.scenes = script.scenes.filter((s) => s.id !== op.sceneId);
    } else if (op.type === "insert") {
      const afterIdx =
        op.afterSceneId == null ? -1 : script.scenes.findIndex((s) => s.id === op.afterSceneId);
      const newScene: Scene = {
        id: op.scene.id,
        text: op.scene.text ?? "",
        template: op.scene.template ?? "aroll-text",
        props: (op.scene.props as Record<string, unknown> | undefined) ?? { title: "" },
        hook: op.scene.hook ?? false,
        durationHint: op.scene.durationHint ?? 4,
        ...(typeof op.scene.reasoning === "string" ? { reasoning: op.scene.reasoning } : {}),
      };
      if (afterIdx === -1) script.scenes.push(newScene);
      else script.scenes.splice(afterIdx + 1, 0, newScene);
    }
  }
}

// ── Project-level intent ─────────────────────────────────────────────────────

interface ProjectIntentContext {
  activeTheme: { id: string; name: string; description: string };
  themeChoices: Array<{ id: string; name: string; description: string }>;
  designBrief: string;
  imageSummary: string;
}

interface ProjectIntentToolInput {
  overallNote?: string;
  themeSuggestion?: { suggestedThemeId?: string; rationale?: string };
  designBriefAddendum?: { text?: string; rationale?: string };
  scenes?: Array<{
    sceneId?: string;
    template?: string;
    props?: Record<string, unknown>;
    reasoning?: string;
    note?: string;
  }>;
}

interface ProjectIntentResponse {
  overallNote: string;
  themeSuggestion: {
    currentThemeId: string;
    suggestedThemeId: string | null;
    rationale: string;
  } | null;
  designBriefAddendum: { text: string; rationale: string } | null;
  patches: Array<{
    sceneId: string;
    preview: string;
    note: string;
    patch: ScenePatch;
  }>;
}

const PROJECT_INTENT_TOOL: ToolDefinition = {
  name: "propose_project_revisions",
  description:
    "Given a project-level directorial intent and full theme/brief/script context, return scene patches plus optional theme + design-brief recommendations.",
  input_schema: {
    type: "object",
    properties: {
      overallNote: {
        type: "string",
        description: "1-2 sentences on the strategy you took.",
      },
      themeSuggestion: {
        type: "object",
        description:
          "Optional. Only emit if a different theme would serve the intent better than the active one. Otherwise omit.",
        properties: {
          suggestedThemeId: {
            type: "string",
            description: "A theme id from the available list.",
          },
          rationale: {
            type: "string",
            description: "One sentence on why this theme lands the intent.",
          },
        },
        required: ["suggestedThemeId", "rationale"],
      },
      designBriefAddendum: {
        type: "object",
        description:
          "Optional. A short markdown snippet to append to DESIGN.md when the brief should evolve. Skip if the existing brief covers the intent.",
        properties: {
          text: {
            type: "string",
            description: "Markdown snippet, ≤ 600 characters. No top-level heading.",
          },
          rationale: {
            type: "string",
            description: "One sentence on what this snippet adds.",
          },
        },
        required: ["text", "rationale"],
      },
      scenes: {
        type: "array",
        description: "Per-scene patches. Skip scenes that should not change.",
        items: {
          type: "object",
          properties: {
            sceneId: { type: "string" },
            template: {
              type: "string",
              description: "Optional — only set if the template should change.",
            },
            props: {
              type: "object",
              description: "Optional partial props patch.",
            },
            reasoning: { type: "string" },
            note: {
              type: "string",
              description: "One sentence on what this patch does for the intent.",
            },
          },
          required: ["sceneId", "note"],
        },
      },
    },
    required: ["overallNote", "scenes"],
  },
};

function buildProjectIntentSystem(ctx: ProjectIntentContext): string {
  return [
    "# Project-level revision",
    "",
    "You're a creative director reviewing a planned video against a project-level intent the user gave.",
    "Unlike storyline-level intent, you can suggest changes that cross individual scenes:",
    "  - propose a different THEME (only if a swap genuinely serves the intent)",
    "  - propose a DESIGN BRIEF ADDENDUM that nudges all future planning",
    "  - propose per-scene patches (template / props / reasoning) that move the script toward the intent",
    "",
    "Rules:",
    "1. NARRATION IS FIXED. Audio's been recorded — never propose text changes.",
    "2. Theme / brief suggestions are non-binding — only emit them when they'd materially change the result.",
    "3. Per-scene patches are partial: only include fields that should change.",
    "4. Honour per-template word budgets for on-screen copy.",
    "5. Keep the addendum short (≤ 600 chars) and complementary to the existing brief, not a rewrite.",
    "",
    `## Active theme: ${ctx.activeTheme.name} (id: ${ctx.activeTheme.id})`,
    ctx.activeTheme.description ? `Description: ${ctx.activeTheme.description}` : "",
    "",
    `## Other available themes (${ctx.themeChoices.length})`,
    ctx.themeChoices
      .map((t) => `- ${t.id}: ${t.name} — ${t.description || "(no description)"}`)
      .join("\n"),
    "",
    ctx.designBrief.trim()
      ? `## Existing design brief (DESIGN.md, truncated)\n${ctx.designBrief}`
      : "## Existing design brief\n(none — DESIGN.md is empty or missing)",
    "",
    ctx.imageSummary ? `## Image manifest\n${ctx.imageSummary}` : "## Image manifest\n(empty)",
  ]
    .filter((s) => s.length > 0)
    .join("\n");
}

function buildProjectIntentUser(
  script: Script,
  intent: string,
  _ctx: ProjectIntentContext,
): string {
  const sceneSummary = script.scenes
    .map((s, i) => {
      const headline =
        typeof s.props.title === "string"
          ? s.props.title
          : Array.isArray(s.props.words)
            ? (s.props.words as unknown[]).join(" ")
            : "";
      return `${i + 1}. ${s.id} · ${s.template}${s.hook ? " · HOOK" : ""}\n   narration: ${s.text}\n   visual: ${headline.slice(0, 80)}`;
    })
    .join("\n");
  return [
    "## Director's intent (project-level)",
    intent,
    "",
    "## Current script",
    sceneSummary,
    "",
    "Now call the structured tool. Emit theme + brief suggestions ONLY if they'd materially serve the intent — skip otherwise.",
  ].join("\n");
}

function buildProjectIntentResponse(
  raw: ProjectIntentToolInput,
  script: Script,
  ctx: ProjectIntentContext,
): ProjectIntentResponse {
  const sceneById = new Map(script.scenes.map((s) => [s.id, s]));
  const patches: ProjectIntentResponse["patches"] = [];
  for (const entry of raw.scenes ?? []) {
    if (!entry.sceneId) continue;
    const scene = sceneById.get(entry.sceneId);
    if (!scene) continue;
    const patch: ScenePatch = {};
    if (typeof entry.template === "string" && entry.template !== scene.template) {
      patch.template = entry.template;
    }
    if (entry.props && typeof entry.props === "object") {
      patch.props = { ...scene.props, ...entry.props };
    }
    if (typeof entry.reasoning === "string") patch.reasoning = entry.reasoning;
    if (Object.keys(patch).length === 0) continue;
    patches.push({
      sceneId: entry.sceneId,
      preview: summarisePatch(patch, scene.template),
      note: entry.note ?? "",
      patch,
    });
  }

  // Theme suggestion is only valid if the suggested id is actually known and
  // different from the active one. Otherwise drop it — don't show stale picks.
  let themeSuggestion: ProjectIntentResponse["themeSuggestion"] = null;
  const proposed = raw.themeSuggestion?.suggestedThemeId;
  if (
    typeof proposed === "string" &&
    proposed !== ctx.activeTheme.id &&
    ctx.themeChoices.some((t) => t.id === proposed)
  ) {
    themeSuggestion = {
      currentThemeId: ctx.activeTheme.id,
      suggestedThemeId: proposed,
      rationale: raw.themeSuggestion?.rationale ?? "",
    };
  }

  let designBriefAddendum: ProjectIntentResponse["designBriefAddendum"] = null;
  const addText = raw.designBriefAddendum?.text;
  if (typeof addText === "string" && addText.trim().length > 0) {
    designBriefAddendum = {
      text: addText.trim().slice(0, 1200),
      rationale: raw.designBriefAddendum?.rationale ?? "",
    };
  }

  return {
    overallNote: raw.overallNote ?? "",
    themeSuggestion,
    designBriefAddendum,
    patches,
  };
}

/**
 * Cheap one-line summary of the project's image manifest, used as Haiku
 * context for project-intent. Reads `assets/images/images.json` if present
 * and returns "<n> images: hero, subject, atmosphere — <ids>" or "" when
 * nothing is on disk.
 */
function loadImageManifestSummary(projectDir: string): string {
  const path = join(projectDir, "assets/images/images.json");
  if (!existsSync(path)) return "";
  try {
    const json = JSON.parse(readFileSync(path, "utf-8")) as {
      images?: Array<{ id?: string; role?: string; description?: string }>;
    };
    const images = json.images ?? [];
    if (images.length === 0) return "";
    const byRole = new Map<string, number>();
    for (const img of images) {
      if (img.role) byRole.set(img.role, (byRole.get(img.role) ?? 0) + 1);
    }
    const roleSummary = Array.from(byRole.entries())
      .map(([role, count]) => `${count} ${role}`)
      .join(", ");
    const ids = images
      .slice(0, 8)
      .map((i) => i.id ?? "?")
      .join(", ");
    return `${images.length} images${roleSummary ? ` (${roleSummary})` : ""}; ids: ${ids}${images.length > 8 ? ", …" : ""}`;
  } catch {
    return "";
  }
}

// Exported for unit tests so the prompt-context builder can be exercised
// without mocking the whole route stack.
export const __testing = {
  buildProjectIntentSystem,
  buildProjectIntentResponse,
  loadImageManifestSummary,
  pickSceneWindow,
};
