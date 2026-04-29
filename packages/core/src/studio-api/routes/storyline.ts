import type { Hono } from "hono";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StudioApiAdapter } from "../types.js";
import { AnthropicError, callStructuredTool, loadAnthropicKey } from "../../anthropic/index.js";
import type { ToolDefinition } from "../../anthropic/index.js";
import { CostLogger, loggerSink } from "../../telemetry/cost.js";
import type { Script, SceneRef } from "../../script/types.js";
import { listAvailableThemes, loadDesignBrief, resolveActiveTheme } from "../../script/index.js";
import {
  ElevenLabsError,
  generateSoundEffect,
  loadElevenLabsKey,
  SFX_BOUNDS,
  clampSfxDuration,
} from "../../elevenlabs/index.js";
import {
  appendSfxEntry,
  readSfxManifest,
  removeSfxEntry,
  SFX_DIR,
  type SfxAnchor,
  type SfxEntry,
} from "../../script/sfx/manifest.js";
import {
  generateMusicAndWait,
  downloadMusic,
  clampMusicDuration,
  MUSIC_BOUNDS,
} from "../../elevenlabs/music.js";
import {
  appendMusicEntry,
  readMusicManifest,
  removeMusicEntry,
  MUSIC_DIR,
  type MusicEntry,
  type MusicRole,
} from "../../script/music/manifest.js";
import {
  GeminiError,
  generateStructured as generateGeminiStructured,
  loadGeminiKey,
  uploadAndWait as uploadGeminiFile,
  DEFAULT_GEMINI_MODEL,
  type GeminiPart,
} from "../../gemini/index.js";

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

  // POST /api/projects/:id/storyline/sfx-suggest
  // Per-scene SFX prompt suggestions. Haiku reads one scene + a small window
  // of neighbours (focal ±2 by default) and returns 1-3 sound-effect ideas
  // with text prompts, durations, and anchors. Generation happens in a
  // separate call (`/sfx-generate`) so the user can scan multiple ideas
  // before paying ElevenLabs credits.
  api.post("/projects/:id/storyline/sfx-suggest", async (c) => {
    const ctx = await loadActionContext(c.req.param("id"), c, adapter);
    if ("errorRes" in ctx) return ctx.errorRes;
    const { project, scene } = ctx;
    const apiKey = loadAnthropicKey(project.dir);
    if (!apiKey) return c.json({ error: "ANTHROPIC_API_KEY not set" }, 401);

    const script = loadScript(project.dir);
    if (!script) return c.json({ error: "no planned script found" }, 404);
    const focalIdx = script.scenes.findIndex((s) => s.id === scene.id);
    const window = pickSceneWindow(script, focalIdx, 2);

    return callHaikuAction(c, project.dir, apiKey, "sfxSuggest", {
      tool: SFX_SUGGEST_TOOL,
      system: buildSfxSuggestSystem(),
      user: buildSfxSuggestUser(window, scene),
      buildResponse: (raw: SfxSuggestToolInput): SfxSuggestionResponse =>
        buildSfxSuggestResponse(raw, scene),
      meta: { sceneId: scene.id, template: scene.template, windowSize: window.length },
    });
  });

  // POST /api/projects/:id/storyline/sfx-generate
  // Take one suggestion (prompt + durationSeconds + anchor) and turn it
  // into an actual mp3 on disk. Appends to the SFX manifest. The studio
  // re-assembles after this returns so the new clip lands on the SFX lane.
  api.post("/projects/:id/storyline/sfx-generate", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    let body: SfxGenerateBody;
    try {
      body = (await c.req.json()) as SfxGenerateBody;
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    if (!body.sceneId) return c.json({ error: "sceneId is required" }, 400);
    if (!body.prompt || typeof body.prompt !== "string" || body.prompt.trim().length === 0) {
      return c.json({ error: "prompt is required" }, 400);
    }
    if (body.prompt.length > SFX_BOUNDS.promptMaxChars) {
      return c.json({ error: `prompt too long (max ${SFX_BOUNDS.promptMaxChars} chars)` }, 400);
    }
    const anchor: SfxAnchor =
      body.anchor === "scene-end" || body.anchor === "accent-word" ? body.anchor : "scene-start";

    const apiKey = loadElevenLabsKey(project.dir);
    if (!apiKey) {
      return c.json({ error: "ELEVENLABS_API_KEY not set. Add it to <project>/.env." }, 401);
    }

    const script = loadScript(project.dir);
    if (!script) return c.json({ error: "no planned script found" }, 404);
    const scene = script.scenes.find((s) => s.id === body.sceneId);
    if (!scene) return c.json({ error: `scene ${body.sceneId} not in script` }, 404);

    const durationSeconds = clampSfxDuration(body.durationSeconds ?? 2);
    const onCostEvent = loggerSink(new CostLogger(project.dir));
    const start = Date.now();

    try {
      const { bytes } = await generateSoundEffect(apiKey, body.prompt.trim(), {
        durationSeconds,
        ...(typeof body.promptInfluence === "number"
          ? { promptInfluence: body.promptInfluence }
          : {}),
      });
      // Mint a stable id and write the mp3 next to the manifest.
      const entryId = mintSfxId();
      const relativePath = `${SFX_DIR}/${scene.id}-${entryId}.mp3`;
      const absPath = join(project.dir, relativePath);
      mkdirSync(join(project.dir, SFX_DIR), { recursive: true });
      writeFileSync(absPath, bytes);
      const entry: SfxEntry = {
        id: entryId,
        sceneId: scene.id,
        prompt: body.prompt.trim(),
        path: relativePath,
        durationSeconds,
        anchor,
        ...(typeof body.accentWordIndex === "number"
          ? { accentWordIndex: body.accentWordIndex }
          : {}),
        ...(typeof body.label === "string" && body.label.trim().length > 0
          ? { label: body.label.trim() }
          : {}),
        ...(typeof body.volumeDb === "number" ? { volumeDb: body.volumeDb } : {}),
        createdAt: new Date().toISOString(),
      };
      appendSfxEntry(project.dir, entry);

      // Cost telemetry: ElevenLabs SFX is billed per generation, not per
      // character. Use a synthetic 1-character entry so the existing
      // `kind: "elevenlabs"` shape applies; the meta carries the actual
      // op label for filtering.
      onCostEvent(
        "script.storyline.sfx.generate",
        { kind: "elevenlabs", voiceId: "sfx", characters: 1 },
        Date.now() - start,
        {
          sceneId: scene.id,
          entryId,
          durationSeconds,
          anchor,
          promptLen: body.prompt.length,
        },
      );

      return c.json({ ok: true, entry });
    } catch (err) {
      if (err instanceof ElevenLabsError) {
        return c.json({ error: `ElevenLabs SFX failed: ${err.message}` }, 502);
      }
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  // GET /api/projects/:id/storyline/sfx
  // Returns the current SFX manifest. Used by the studio to render the SFX
  // lane and the per-card audition affordances.
  api.get("/projects/:id/storyline/sfx", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    return c.json({ manifest: readSfxManifest(project.dir) });
  });

  // DELETE /api/projects/:id/storyline/sfx/:entryId
  // Remove a single SFX entry from the manifest. Does NOT delete the audio
  // file on disk — leaves the user free to recover by manually editing the
  // manifest. Aligns with the principle "manifests are append-only from the
  // studio; deletes are soft."
  api.delete("/projects/:id/storyline/sfx/:entryId", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const entryId = c.req.param("entryId");
    if (!entryId) return c.json({ error: "entryId required" }, 400);
    const manifest = removeSfxEntry(project.dir, entryId);
    return c.json({ ok: true, manifest });
  });

  // ── Milestone B: ElevenLabs Music ────────────────────────────────────────

  // POST /api/projects/:id/storyline/music-suggest
  // Haiku reads the whole storyline + active theme + a free-form vibe prompt
  // and returns 1-3 track plans (prompt, scenesCovered, durationS, role).
  // Synchronous Haiku call — fast, cheap, sub-second.
  api.post("/projects/:id/storyline/music-suggest", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    let body: { vibe?: string };
    try {
      body = (await c.req.json()) as { vibe?: string };
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const vibe = (body.vibe ?? "").trim();
    if (!vibe) return c.json({ error: "vibe is required" }, 400);
    if (vibe.length > 500) return c.json({ error: "vibe too long (max 500 chars)" }, 400);

    const script = loadScript(project.dir);
    if (!script) return c.json({ error: "no planned script found" }, 404);
    const apiKey = loadAnthropicKey(project.dir);
    if (!apiKey) return c.json({ error: "ANTHROPIC_API_KEY not set" }, 401);

    const activeTheme = resolveActiveTheme(project.dir);
    const onCostEvent = loggerSink(new CostLogger(project.dir));
    const start = Date.now();
    try {
      const { result, usage } = await callStructuredTool<MusicSuggestToolInput>(apiKey, {
        model: HAIKU_MODEL,
        system: buildMusicSuggestSystem(activeTheme.name, activeTheme.description),
        user: buildMusicSuggestUser(script, vibe),
        tool: MUSIC_SUGGEST_TOOL,
        maxTokens: 1500,
        temperature: 0.4,
      });
      onCostEvent(
        "script.storyline.music.suggest",
        {
          kind: "anthropic",
          model: HAIKU_MODEL,
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
        },
        Date.now() - start,
        { sceneCount: script.scenes.length, vibeLen: vibe.length },
      );
      return c.json(buildMusicSuggestResponse(result, script));
    } catch (err) {
      if (err instanceof AnthropicError) {
        return c.json({ error: `Haiku call failed: ${err.message}` }, 502);
      }
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  // POST /api/projects/:id/storyline/music-generate
  // Take one suggestion (prompt + durationSeconds + scenesCovered) and turn
  // it into an mp3 on disk. Polled job — can take 30-60s. Server holds the
  // request open; the studio shows a "generating…" spinner.
  api.post("/projects/:id/storyline/music-generate", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    let body: MusicGenerateBody;
    try {
      body = (await c.req.json()) as MusicGenerateBody;
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    if (!body.prompt || body.prompt.trim().length === 0) {
      return c.json({ error: "prompt is required" }, 400);
    }
    if (body.prompt.length > MUSIC_BOUNDS.promptMaxChars) {
      return c.json({ error: `prompt too long (max ${MUSIC_BOUNDS.promptMaxChars} chars)` }, 400);
    }
    const apiKey = loadElevenLabsKey(project.dir);
    if (!apiKey) {
      return c.json({ error: "ELEVENLABS_API_KEY not set. Add it to <project>/.env." }, 401);
    }
    const role: MusicRole =
      body.role === "stinger" || body.role === "intro" || body.role === "outro"
        ? body.role
        : "underscore";
    const durationSeconds = clampMusicDuration(body.durationSeconds ?? 60);
    const scenesCovered = Array.isArray(body.scenesCovered)
      ? body.scenesCovered.filter((s): s is string => typeof s === "string")
      : [];

    const onCostEvent = loggerSink(new CostLogger(project.dir));
    const start = Date.now();
    try {
      const { audioUrl } = await generateMusicAndWait(apiKey, body.prompt.trim(), {
        durationMs: Math.round(durationSeconds * 1000),
      });
      const bytes = await downloadMusic(audioUrl);
      const entryId = mintMusicId();
      const relativePath = `${MUSIC_DIR}/${entryId}.mp3`;
      const absPath = join(project.dir, relativePath);
      mkdirSync(join(project.dir, MUSIC_DIR), { recursive: true });
      writeFileSync(absPath, bytes);
      const entry: MusicEntry = {
        id: entryId,
        prompt: body.prompt.trim(),
        path: relativePath,
        durationSeconds,
        scenesCovered,
        role,
        ...(typeof body.label === "string" && body.label.trim().length > 0
          ? { label: body.label.trim() }
          : {}),
        ...(typeof body.volumeDb === "number" ? { volumeDb: body.volumeDb } : {}),
        // Default duck of -12dB during voiceover windows. The producer's
        // mixer applies a sidechain duck at render time.
        duckDb: typeof body.duckDb === "number" ? body.duckDb : -12,
        createdAt: new Date().toISOString(),
      };
      appendMusicEntry(project.dir, entry);
      onCostEvent(
        "script.storyline.music.generate",
        // ElevenLabs Music is billed per generation (not per character) — we
        // synthesise a 1-character entry so the existing cost shape applies.
        { kind: "elevenlabs", voiceId: "music", characters: 1 },
        Date.now() - start,
        { entryId, durationSeconds, scenesCovered: scenesCovered.length, role },
      );
      return c.json({ ok: true, entry });
    } catch (err) {
      if (err instanceof ElevenLabsError) {
        return c.json({ error: `ElevenLabs Music failed: ${err.message}` }, 502);
      }
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  // GET /api/projects/:id/storyline/music
  api.get("/projects/:id/storyline/music", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    return c.json({ manifest: readMusicManifest(project.dir) });
  });

  // DELETE /api/projects/:id/storyline/music/:entryId
  api.delete("/projects/:id/storyline/music/:entryId", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const entryId = c.req.param("entryId");
    if (!entryId) return c.json({ error: "entryId required" }, 400);
    const manifest = removeMusicEntry(project.dir, entryId);
    return c.json({ ok: true, manifest });
  });

  // ── Milestone C: Gemini render review ────────────────────────────────────

  // POST /api/projects/:id/storyline/render-review
  // Body: { renderPath?: string }   — defaults to the most recent render in
  //                                   <project>/renders/
  // Uploads the MP4 to Gemini Files API, prompts with the script meta, and
  // returns structured retention feedback. Persists the result to
  // `<project>/.hyperframes/render-reviews/<timestamp>.json` so the studio
  // can show historical reviews without re-running.
  api.post("/projects/:id/storyline/render-review", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    let body: { renderPath?: string };
    try {
      body = (await c.req.json().catch(() => ({}))) as { renderPath?: string };
    } catch {
      body = {};
    }
    const apiKey = loadGeminiKey(project.dir);
    if (!apiKey) {
      return c.json({ error: "GEMINI_API_KEY not set. Add it to <project>/.env." }, 401);
    }

    const script = loadScript(project.dir);
    if (!script) return c.json({ error: "no planned script found" }, 404);

    // Resolve the render path. Caller can specify; otherwise we pick the
    // most recent .mp4 under <project>/renders/.
    let renderRel = body.renderPath ?? findMostRecentRender(project.dir);
    if (!renderRel) {
      return c.json(
        {
          error: "no rendered MP4 found. Run a render first (or pass renderPath in the body).",
        },
        404,
      );
    }
    if (renderRel.startsWith("/")) renderRel = renderRel.slice(1);
    const absRenderPath = join(project.dir, renderRel);
    if (!existsSync(absRenderPath)) {
      return c.json({ error: `render not found at ${renderRel}` }, 404);
    }

    const onCostEvent = loggerSink(new CostLogger(project.dir));
    const start = Date.now();
    try {
      const uploaded = await uploadGeminiFile(apiKey, absRenderPath, "video/mp4");
      const sceneTimings = computeSceneTimings(script);
      const { result, usage } = await generateGeminiStructured<RenderReviewToolInput>(apiKey, {
        model: DEFAULT_GEMINI_MODEL,
        parts: [
          { fileData: { fileUri: uploaded.uri, mimeType: uploaded.mimeType } },
          { text: buildRenderReviewUser(script, sceneTimings) },
        ],
        systemInstruction: buildRenderReviewSystem(),
        tool: anthropicToGeminiTool(RENDER_REVIEW_TOOL),
        temperature: 0.3,
        maxOutputTokens: 4096,
      });
      onCostEvent(
        "script.storyline.render.review",
        {
          kind: "gemini",
          model: DEFAULT_GEMINI_MODEL,
          promptTokens: usage.promptTokenCount ?? 0,
          outputTokens: usage.candidatesTokenCount ?? 0,
        },
        Date.now() - start,
        { renderPath: renderRel, sceneCount: script.scenes.length },
      );
      const review = buildRenderReviewResponse(result, script);
      // Persist for historical retrieval. Soft fail — review still goes back
      // to the caller even if the disk write fails.
      try {
        const reviewsDir = join(project.dir, ".hyperframes", "render-reviews");
        mkdirSync(reviewsDir, { recursive: true });
        const reviewPath = join(reviewsDir, `${Date.now()}.json`);
        writeFileSync(
          reviewPath,
          JSON.stringify({ ...review, renderPath: renderRel }, null, 2) + "\n",
        );
      } catch {
        /* ignore */
      }
      return c.json({ ...review, renderPath: renderRel });
    } catch (err) {
      if (err instanceof GeminiError) {
        return c.json({ error: `Gemini call failed: ${err.message}` }, 502);
      }
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  // GET /api/projects/:id/storyline/render-review
  // Returns the most recent persisted review (if any), so reloading the
  // Storyline tab shows the last review without re-running Gemini.
  api.get("/projects/:id/storyline/render-review", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const review = loadMostRecentRenderReview(project.dir);
    return c.json({ review });
  });

  // ── Milestone E: Per-scene scroll test ───────────────────────────────────

  // POST /api/projects/:id/storyline/scroll-test
  // Body: { sceneId }
  // Picks 3 frames from the scene (start / mid / end) by sampling the
  // rendered MP4, sends them + the narration to Gemini, asks "would they
  // scroll?". Drops a SceneSuggestion patch for the proposed fix.
  api.post("/projects/:id/storyline/scroll-test", async (c) => {
    const ctx = await loadActionContext(c.req.param("id"), c, adapter);
    if ("errorRes" in ctx) return ctx.errorRes;
    const { project, scene } = ctx;
    const apiKey = loadGeminiKey(project.dir);
    if (!apiKey) return c.json({ error: "GEMINI_API_KEY not set" }, 401);

    const script = loadScript(project.dir);
    if (!script) return c.json({ error: "no planned script found" }, 404);
    const renderRel = findMostRecentRender(project.dir);
    if (!renderRel) {
      return c.json({ error: "no rendered MP4 found — render first to enable scroll tests." }, 404);
    }
    const absRenderPath = join(project.dir, renderRel);
    if (!existsSync(absRenderPath)) {
      return c.json({ error: `render not found at ${renderRel}` }, 404);
    }

    const sceneTimings = computeSceneTimings(script);
    const sceneTime = sceneTimings.find((t) => t.sceneId === scene.id);
    if (!sceneTime) {
      return c.json({ error: `couldn't compute timing for ${scene.id}` }, 500);
    }

    // Frame extraction needs ffmpeg — leverage the same probe adapter the
    // studio already wires up for audio duration. If absent we degrade to
    // sending only the narration text, no frames; Gemini will still produce
    // a reasonable "would they scroll?" verdict from the text alone.
    let frameParts: GeminiPart[] = [];
    if (adapter.extractVideoFrameToBytes) {
      const sampleAt = [
        sceneTime.start + Math.min(0.5, sceneTime.duration / 6),
        sceneTime.start + sceneTime.duration / 2,
        sceneTime.start + Math.max(0, sceneTime.duration - 0.5),
      ];
      try {
        for (const t of sampleAt) {
          const bytes = await adapter.extractVideoFrameToBytes(absRenderPath, t);
          if (bytes) {
            frameParts.push({
              inlineData: {
                mimeType: "image/jpeg",
                data: Buffer.from(bytes).toString("base64"),
              },
            });
          }
        }
      } catch {
        // Frame sampling is best-effort — if ffmpeg fails on one frame the
        // scroll test still runs with what we got.
        frameParts = [];
      }
    }

    const onCostEvent = loggerSink(new CostLogger(project.dir));
    const start = Date.now();
    try {
      const { result, usage } = await generateGeminiStructured<ScrollTestToolInput>(apiKey, {
        model: DEFAULT_GEMINI_MODEL,
        parts: [...frameParts, { text: buildScrollTestUser(scene) }],
        systemInstruction: buildScrollTestSystem(),
        tool: anthropicToGeminiTool(SCROLL_TEST_TOOL),
        temperature: 0.3,
        maxOutputTokens: 768,
      });
      onCostEvent(
        "script.storyline.scrollTest",
        {
          kind: "gemini",
          model: DEFAULT_GEMINI_MODEL,
          promptTokens: usage.promptTokenCount ?? 0,
          outputTokens: usage.candidatesTokenCount ?? 0,
        },
        Date.now() - start,
        { sceneId: scene.id, frameCount: frameParts.length },
      );
      return c.json(buildScrollTestResponse(result, scene));
    } catch (err) {
      if (err instanceof GeminiError) {
        return c.json({ error: `Gemini call failed: ${err.message}` }, 502);
      }
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });
}

// ── SFX action types & helpers ───────────────────────────────────────────────

interface SfxGenerateBody {
  sceneId?: string;
  prompt?: string;
  durationSeconds?: number;
  promptInfluence?: number;
  anchor?: SfxAnchor;
  accentWordIndex?: number;
  label?: string;
  volumeDb?: number;
}

interface SfxSuggestToolInput {
  suggestions?: Array<{
    prompt?: string;
    durationSeconds?: number;
    anchor?: string;
    accentWordIndex?: number;
    label?: string;
    rationale?: string;
  }>;
}

interface SfxSuggestionResponse {
  sceneId: string;
  suggestions: Array<{
    id: string;
    prompt: string;
    durationSeconds: number;
    anchor: SfxAnchor;
    accentWordIndex?: number;
    label: string;
    rationale: string;
  }>;
}

const SFX_SUGGEST_TOOL: ToolDefinition = {
  name: "propose_sfx",
  description:
    "Propose 1-3 sound-effect ideas for a scene. Each idea is a short text prompt (the model that will generate the SFX), a target duration, an anchor describing when in the scene to play it, and a one-sentence rationale.",
  input_schema: {
    type: "object",
    properties: {
      suggestions: {
        type: "array",
        minItems: 1,
        maxItems: 3,
        items: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description:
                "Text prompt for ElevenLabs Sound Generation. Be specific and visual — 'low rumble with metallic clang' beats 'big sound'. Avoid musical descriptions; this is SFX, not music.",
            },
            durationSeconds: {
              type: "number",
              minimum: 0.5,
              maximum: 22,
              description:
                "Target duration in seconds. Most cinematic SFX are 0.5-3s. Use longer (5-8s) only for atmospheric pads.",
            },
            anchor: {
              type: "string",
              enum: ["scene-start", "accent-word", "scene-end"],
              description:
                "When in the scene window the SFX plays. scene-start: cold open / pattern-interrupt. accent-word: punctuates a specific word in the narration. scene-end: outro stinger.",
            },
            accentWordIndex: {
              type: "integer",
              minimum: 0,
              description:
                "Required only when anchor is accent-word. 0-based index into the narration's word list. The studio uses this to interpolate a timing — Phase A is heuristic-only.",
            },
            label: {
              type: "string",
              description: "Short human label for the SFX (e.g. 'broadcast static'). Optional.",
            },
            rationale: {
              type: "string",
              description:
                "One sentence on what this SFX does for the scene's retention. Specific to the scene's content.",
            },
          },
          required: ["prompt", "durationSeconds", "anchor", "rationale"],
        },
      },
    },
    required: ["suggestions"],
  },
};

function buildSfxSuggestSystem(): string {
  return [
    "# Sound-effect direction",
    "",
    "You're a sound designer proposing SFX for ONE scene in a Reels-style explainer video.",
    "Read the focal scene + the small neighbour window for context. Propose 1-3 SFX that:",
    "",
    "1. Punch the scene's pattern interrupt (scene-start) OR underline a specific word (accent-word) OR seal the close (scene-end).",
    "2. Are SHORT — 0.5-3s for most cinematic uses. Reserve 5-8s for atmospheric pads.",
    "3. Are SPECIFIC — 'low rumble with metallic clang' beats 'big sound'.",
    "4. Avoid musical content (that's the music lane). Pure SFX only: whooshes, impacts, ambient layers.",
    "5. Don't overcrowd — if the scene's narration is dense, ONE well-placed SFX > three competing ones.",
    "",
    "When you pick `accent-word`, also emit `accentWordIndex` — the 0-based word index in the focal scene's narration the SFX should align to.",
    "",
    "Each suggestion needs a one-sentence rationale that ties back to the scene's content. Vague rationales get rejected.",
  ].join("\n");
}

function buildSfxSuggestUser(window: SceneRef[], focal: SceneRef): string {
  const lines = window.map((s) => {
    const isFocal = s.id === focal.id;
    return [
      `${isFocal ? "→ FOCAL · " : "   "}${s.id} · ${s.template}${s.hook ? " · HOOK" : ""}`,
      `   narration: ${s.text}`,
    ].join("\n");
  });
  return [
    "## Window",
    lines.join("\n\n"),
    "",
    "Now call propose_sfx with 1-3 ideas for the FOCAL scene.",
  ].join("\n");
}

function buildSfxSuggestResponse(raw: SfxSuggestToolInput, scene: SceneRef): SfxSuggestionResponse {
  const suggestions: SfxSuggestionResponse["suggestions"] = [];
  for (const s of raw.suggestions ?? []) {
    if (!s || typeof s.prompt !== "string" || s.prompt.trim().length === 0) continue;
    const anchor: SfxAnchor =
      s.anchor === "scene-end" || s.anchor === "accent-word" ? s.anchor : "scene-start";
    const durationSeconds = clampSfxDuration(
      typeof s.durationSeconds === "number" ? s.durationSeconds : 2,
    );
    const label =
      typeof s.label === "string" && s.label.trim().length > 0
        ? s.label.trim()
        : s.prompt.trim().slice(0, 40);
    suggestions.push({
      id: mintSfxId(),
      prompt: s.prompt.trim(),
      durationSeconds,
      anchor,
      ...(anchor === "accent-word" && typeof s.accentWordIndex === "number"
        ? { accentWordIndex: s.accentWordIndex }
        : {}),
      label,
      rationale: typeof s.rationale === "string" ? s.rationale : "",
    });
    if (suggestions.length >= 3) break;
  }
  return { sceneId: scene.id, suggestions };
}

let sfxIdCounter = 0;
function mintSfxId(): string {
  // Stable, sortable, no collisions across a session. Format: <ms36>-<counter36>.
  const ms = Date.now().toString(36);
  const ctr = (sfxIdCounter++).toString(36).padStart(2, "0");
  return `sfx-${ms}-${ctr}`;
}

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

interface HaikuActionConfig<T, R = SuggestionResponse> {
  tool: ToolDefinition;
  system: string;
  user: string;
  buildResponse: (raw: T) => R;
  meta: Record<string, unknown>;
}

async function callHaikuAction<T, R = SuggestionResponse>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  c: any,
  projectDir: string,
  apiKey: string,
  opLabel: string,
  cfg: HaikuActionConfig<T, R>,
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
  buildRenderReviewResponse,
  buildScrollTestResponse,
  buildMusicSuggestResponse,
  computeSceneTimings,
  findMostRecentRender,
};

// ── Music helpers ────────────────────────────────────────────────────────────

interface MusicSuggestToolInput {
  tracks?: Array<{
    prompt?: string;
    durationSeconds?: number;
    role?: string;
    scenesCovered?: string[];
    label?: string;
    rationale?: string;
  }>;
  overallNote?: string;
}

interface MusicGenerateBody {
  prompt?: string;
  durationSeconds?: number;
  role?: MusicRole;
  scenesCovered?: string[];
  label?: string;
  volumeDb?: number;
  duckDb?: number;
}

const MUSIC_SUGGEST_TOOL: ToolDefinition = {
  name: "propose_music_tracks",
  description:
    "Propose 1-3 background music tracks for a planned video. Each track has a generation prompt, the scenes it underscores, a target duration, and a one-sentence rationale.",
  input_schema: {
    type: "object",
    properties: {
      overallNote: {
        type: "string",
        description: "1-2 sentences on the overall musical strategy across the video.",
      },
      tracks: {
        type: "array",
        minItems: 1,
        maxItems: 3,
        items: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description:
                "ElevenLabs Music prompt — be visceral and specific. 'investigative documentary, tense pulse, low strings' beats 'sad music'.",
            },
            durationSeconds: {
              type: "number",
              minimum: 10,
              maximum: 300,
              description:
                "Target duration in seconds. Underscore tracks usually run 30-90s; stingers 5-15s.",
            },
            role: {
              type: "string",
              enum: ["underscore", "stinger", "intro", "outro"],
              description:
                "underscore = continuous bed under multiple scenes. stinger = punctuates a transition. intro/outro = scene 1 / final scene only.",
            },
            scenesCovered: {
              type: "array",
              items: { type: "string" },
              description:
                "Ordered scene ids the track plays under. Empty = whole video. Underscore tracks should cover 2-6 scenes (a coherent act); stingers cover 1.",
            },
            label: {
              type: "string",
              description: "Short human label (e.g. 'investigative bed').",
            },
            rationale: {
              type: "string",
              description: "One sentence on what this track does for the video's emotional arc.",
            },
          },
          required: ["prompt", "durationSeconds", "role", "scenesCovered", "rationale"],
        },
      },
    },
    required: ["tracks", "overallNote"],
  },
};

function buildMusicSuggestSystem(themeName: string, themeDescription: string): string {
  return [
    "# Music director",
    "",
    "You're scoring a Reels-style explainer video. Read the script + active theme + the user's vibe prompt and propose 1-3 background music tracks.",
    "",
    "Rules:",
    "1. NARRATION IS PRIMARY. Music supports voiceover; never competes with it.",
    "2. Underscore tracks should cover 2-6 contiguous scenes (an act). Stingers punctuate transitions.",
    "3. Be specific in prompts: instruments, tempo, mood, era. ElevenLabs Music respects detail.",
    "4. Match the theme's energy — match if you can name what feels off otherwise.",
    "5. Default duck during voiceover is -12dB. Don't propose anything that needs less ducking unless silence is rare.",
    "",
    `## Active theme: ${themeName}`,
    themeDescription ? `Description: ${themeDescription}` : "",
  ]
    .filter((s) => s.length > 0)
    .join("\n");
}

function buildMusicSuggestUser(script: Script, vibe: string): string {
  const lines = script.scenes
    .map((s, i) => `${i + 1}. ${s.id} · ${s.template}${s.hook ? " · HOOK" : ""}\n   ${s.text}`)
    .join("\n");
  return [
    "## User's vibe",
    vibe,
    "",
    `## Script (${script.scenes.length} scenes)`,
    lines,
    "",
    "Now call propose_music_tracks with 1-3 tracks that score the video.",
  ].join("\n");
}

interface MusicSuggestionResponse {
  overallNote: string;
  tracks: Array<{
    id: string;
    prompt: string;
    durationSeconds: number;
    role: MusicRole;
    scenesCovered: string[];
    label: string;
    rationale: string;
  }>;
}

function buildMusicSuggestResponse(
  raw: MusicSuggestToolInput,
  script: Script,
): MusicSuggestionResponse {
  const knownSceneIds = new Set(script.scenes.map((s) => s.id));
  const tracks: MusicSuggestionResponse["tracks"] = [];
  for (const t of raw.tracks ?? []) {
    if (!t || typeof t.prompt !== "string" || t.prompt.trim().length === 0) continue;
    const role: MusicRole =
      t.role === "stinger" || t.role === "intro" || t.role === "outro" ? t.role : "underscore";
    const scenesCovered = Array.isArray(t.scenesCovered)
      ? t.scenesCovered
          .filter((s): s is string => typeof s === "string")
          .filter((s) => knownSceneIds.has(s))
      : [];
    const durationSeconds = clampMusicDuration(
      typeof t.durationSeconds === "number" ? t.durationSeconds : 60,
    );
    const label =
      typeof t.label === "string" && t.label.trim().length > 0
        ? t.label.trim()
        : t.prompt.trim().slice(0, 40);
    tracks.push({
      id: mintMusicId(),
      prompt: t.prompt.trim(),
      durationSeconds,
      role,
      scenesCovered,
      label,
      rationale: typeof t.rationale === "string" ? t.rationale : "",
    });
    if (tracks.length >= 3) break;
  }
  return { overallNote: raw.overallNote ?? "", tracks };
}

let musicIdCounter = 0;
function mintMusicId(): string {
  const ms = Date.now().toString(36);
  const ctr = (musicIdCounter++).toString(36).padStart(2, "0");
  return `music-${ms}-${ctr}`;
}

// ── Render-review (Gemini) ───────────────────────────────────────────────────

interface RenderReviewToolInput {
  overallRetentionScore?: number;
  scrollRiskWindows?: Array<{
    startS?: number;
    endS?: number;
    severity?: string;
    why?: string;
    fix?: string;
  }>;
  brandConsistency?: {
    score?: number;
    drift?: string[];
  };
  audioMix?: {
    voiceClarity?: string;
    musicLevels?: string;
    sfxBalance?: string;
  };
  perScene?: Array<{
    sceneId?: string;
    visualHook?: number;
    paceMatch?: number;
    onBrand?: number;
    note?: string;
  }>;
}

interface RenderReviewResponse {
  overallRetentionScore: number;
  scrollRiskWindows: Array<{
    startS: number;
    endS: number;
    severity: "low" | "med" | "high";
    why: string;
    fix: string;
  }>;
  brandConsistency: { score: number; drift: string[] };
  audioMix: {
    voiceClarity: "good" | "muddy" | "clipped";
    musicLevels: "ducked" | "flat" | "fighting";
    sfxBalance: "well-placed" | "missing" | "overused";
  };
  perScene: Array<{
    sceneId: string;
    visualHook: number;
    paceMatch: number;
    onBrand: number;
    note: string;
  }>;
}

const RENDER_REVIEW_TOOL: ToolDefinition = {
  name: "report_render_review",
  description:
    "Report a structured retention review of a rendered video. Score retention, identify scroll-risk windows, audit brand consistency, and grade each scene.",
  input_schema: {
    type: "object",
    properties: {
      overallRetentionScore: {
        type: "number",
        description: "0-100. Single rough estimate of how likely a feed viewer watches to the end.",
      },
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
        description:
          "Time windows where retention is at risk. Each carries a one-sentence why and a one-sentence concrete fix.",
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

function buildRenderReviewSystem(): string {
  return [
    "# Retention review",
    "",
    "You're a retention engineer reviewing a Reels-style explainer video. Watch the whole video, then report:",
    "",
    "  - overallRetentionScore (0-100): how likely is a feed viewer to watch to the end?",
    "  - scrollRiskWindows: time spans where viewers will drop off. ALWAYS include why + a concrete one-sentence fix referencing the existing scenes/templates.",
    "  - brandConsistency: 0-100 score + per-scene drift notes (which scenes break the look).",
    "  - audioMix: voice clarity, music levels relative to voice, sfx balance.",
    "  - perScene: visualHook (0-10), paceMatch (0-10 — does pacing match narration density?), onBrand (0-10), one-sentence note.",
    "",
    "Rules:",
    "1. Be specific. 'Scene 4 visual is generic' is unhelpful. 'Scene 4 has 15 words on screen with no movement for 3.5s' is.",
    "2. Reference per-scene fixes by template id where relevant ('swap to kinetic-words', 'use editorial-serif for breath').",
    "3. The whole point is RETENTION. A safe score is useless. Tell the user where they're losing viewers.",
  ].join("\n");
}

function buildRenderReviewUser(
  script: Script,
  timings: Array<{ sceneId: string; start: number; duration: number }>,
): string {
  const lines = script.scenes.map((s) => {
    const t = timings.find((tt) => tt.sceneId === s.id);
    return `${s.id} (${t ? `${t.start.toFixed(1)}-${(t.start + t.duration).toFixed(1)}s` : "?"}) · ${s.template}${s.hook ? " · HOOK" : ""} · ${s.text}`;
  });
  return [
    "## Script + scene timings (use these to anchor timestamps in your review)",
    lines.join("\n"),
    "",
    "Now watch the attached video and call report_render_review.",
  ].join("\n");
}

function buildRenderReviewResponse(
  raw: RenderReviewToolInput,
  script: Script,
): RenderReviewResponse {
  const knownSceneIds = new Set(script.scenes.map((s) => s.id));
  return {
    overallRetentionScore: clampScore(raw.overallRetentionScore, 0, 100, 50),
    scrollRiskWindows: (raw.scrollRiskWindows ?? [])
      .filter((w) => w && typeof w.startS === "number" && typeof w.endS === "number")
      .map((w) => ({
        startS: w.startS!,
        endS: w.endS!,
        severity: w.severity === "high" || w.severity === "med" ? w.severity : "low",
        why: typeof w.why === "string" ? w.why : "",
        fix: typeof w.fix === "string" ? w.fix : "",
      })),
    brandConsistency: {
      score: clampScore(raw.brandConsistency?.score, 0, 100, 70),
      drift: Array.isArray(raw.brandConsistency?.drift)
        ? raw.brandConsistency.drift.filter((s): s is string => typeof s === "string")
        : [],
    },
    audioMix: {
      voiceClarity:
        raw.audioMix?.voiceClarity === "muddy" || raw.audioMix?.voiceClarity === "clipped"
          ? raw.audioMix.voiceClarity
          : "good",
      musicLevels:
        raw.audioMix?.musicLevels === "flat" || raw.audioMix?.musicLevels === "fighting"
          ? raw.audioMix.musicLevels
          : "ducked",
      sfxBalance:
        raw.audioMix?.sfxBalance === "missing" || raw.audioMix?.sfxBalance === "overused"
          ? raw.audioMix.sfxBalance
          : "well-placed",
    },
    perScene: (raw.perScene ?? [])
      .filter((p) => p && typeof p.sceneId === "string" && knownSceneIds.has(p.sceneId))
      .map((p) => ({
        sceneId: p.sceneId!,
        visualHook: clampScore(p.visualHook, 0, 10, 5),
        paceMatch: clampScore(p.paceMatch, 0, 10, 5),
        onBrand: clampScore(p.onBrand, 0, 10, 5),
        note: typeof p.note === "string" ? p.note : "",
      })),
  };
}

function clampScore(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

// ── Scroll-test (Gemini, per scene) ──────────────────────────────────────────

interface ScrollTestToolInput {
  wouldScroll?: boolean;
  whyOrWhyNot?: string;
  oneChangeFix?: string;
  sceneStrengthScore?: number;
  patch?: {
    template?: string;
    props?: Record<string, unknown>;
    reasoning?: string;
  };
}

interface ScrollTestResponse {
  sceneId: string;
  wouldScroll: boolean;
  whyOrWhyNot: string;
  oneChangeFix: string;
  sceneStrengthScore: number;
  /** Optional patch that the studio surfaces as a SceneSuggestion in the
   *  scene's amber stack — applies to script.json on Apply. */
  suggestion: {
    preview: string;
    rationale: string;
    patch: { template?: string; props?: Record<string, unknown>; reasoning?: string };
  } | null;
}

const SCROLL_TEST_TOOL: ToolDefinition = {
  name: "report_scroll_test",
  description:
    "Predict whether a feed viewer would scroll past this scene. Score it, give a one-sentence why, propose a one-change fix, and optionally a concrete scene patch the studio can apply.",
  input_schema: {
    type: "object",
    properties: {
      wouldScroll: {
        type: "boolean",
        description: "Best estimate: would a viewer in a feed scroll past this scene?",
      },
      whyOrWhyNot: {
        type: "string",
        description: "One specific sentence. Reference the visual, audio, or pacing.",
      },
      oneChangeFix: {
        type: "string",
        description:
          "One sentence: the single change that would most improve retention. Be concrete — reference a template, an accent word, a duration cut.",
      },
      sceneStrengthScore: {
        type: "number",
        minimum: 0,
        maximum: 100,
        description: "Hold-power score 0-100. <30 = strong scroll signal. >70 = strong hold.",
      },
      patch: {
        type: "object",
        description:
          "Optional concrete scene patch — same shape as the storyline-level intent patches. Set ONLY when the fix maps cleanly to a template/props change. Skip when it's narrative-level (re-record narration).",
        properties: {
          template: { type: "string" },
          props: { type: "object" },
          reasoning: { type: "string" },
        },
      },
    },
    required: ["wouldScroll", "whyOrWhyNot", "oneChangeFix", "sceneStrengthScore"],
  },
};

function buildScrollTestSystem(): string {
  return [
    "# Scroll test",
    "",
    "You're a retention scientist watching ONE scene from a feed perspective. Three frames + the narration give you the full picture for this scene.",
    "",
    "Predict: would a feed viewer scroll past?",
    "",
    "Heuristics that predict scroll-through:",
    "  - Static visual for >2s with monotone audio → scroll",
    "  - Long on-screen text with no motion → scroll",
    "  - Audio-visual mismatch (boring visual + urgent VO) → scroll",
    "  - No clear payoff in the scene → scroll",
    "",
    "Heuristics that predict hold:",
    "  - Pattern interrupt (cut, motion shift, accent word lands)",
    "  - One concrete number / claim landing on screen",
    "  - Tight pacing matching narration density",
    "",
    "Be specific. Reference the visual you actually see in the frames. If you can map the fix to a template or props change, ALSO emit a `patch` so the studio can apply it with one click.",
  ].join("\n");
}

function buildScrollTestUser(scene: SceneRef): string {
  const headline =
    typeof scene.props.title === "string"
      ? scene.props.title
      : Array.isArray(scene.props.words)
        ? (scene.props.words as unknown[]).join(" ")
        : "";
  return [
    `## Scene ${scene.id} · ${scene.template}${scene.hook ? " · HOOK" : ""}`,
    `Narration: ${scene.text}`,
    `On-screen: ${headline.slice(0, 200)}`,
    "",
    "The frames attached are sampled from start / mid / end of this scene's window. Now call report_scroll_test.",
  ].join("\n");
}

function buildScrollTestResponse(raw: ScrollTestToolInput, scene: SceneRef): ScrollTestResponse {
  const score = clampScore(raw.sceneStrengthScore, 0, 100, 50);
  const wouldScroll = typeof raw.wouldScroll === "boolean" ? raw.wouldScroll : score < 50;
  const fix = typeof raw.oneChangeFix === "string" ? raw.oneChangeFix : "";
  // Promote the model's optional patch into the SceneSuggestion shape if it
  // emitted one. The studio can apply via the existing applyPatch pipeline.
  let suggestion: ScrollTestResponse["suggestion"] = null;
  if (raw.patch && (raw.patch.template || raw.patch.props || raw.patch.reasoning)) {
    suggestion = {
      preview: fix || "Scroll-test fix",
      rationale: typeof raw.whyOrWhyNot === "string" ? raw.whyOrWhyNot : "",
      patch: {
        ...(typeof raw.patch.template === "string" ? { template: raw.patch.template } : {}),
        ...(raw.patch.props && typeof raw.patch.props === "object"
          ? { props: { ...scene.props, ...raw.patch.props } }
          : {}),
        ...(typeof raw.patch.reasoning === "string" ? { reasoning: raw.patch.reasoning } : {}),
      },
    };
  }
  return {
    sceneId: scene.id,
    wouldScroll,
    whyOrWhyNot: typeof raw.whyOrWhyNot === "string" ? raw.whyOrWhyNot : "",
    oneChangeFix: fix,
    sceneStrengthScore: score,
    suggestion,
  };
}

// ── Helpers shared across the three new milestones ───────────────────────────

/**
 * Convert an Anthropic-shaped tool definition (`input_schema`) to Gemini's
 * function-declaration shape (`parameters`). Both providers accept JSON Schema
 * for the body; only the wrapper key differs. This keeps the tool definitions
 * readable as one shape and lets us reuse them across providers.
 */
function anthropicToGeminiTool(tool: ToolDefinition): {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
} {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema as Record<string, unknown>,
  };
}

function computeSceneTimings(
  script: Script,
): Array<{ sceneId: string; start: number; duration: number }> {
  const out: Array<{ sceneId: string; start: number; duration: number }> = [];
  let cursor = 0;
  for (const scene of script.scenes) {
    const audioDur = (scene as { audio?: { durationSeconds?: number } }).audio?.durationSeconds;
    const lead = (scene as { audio?: { leadInSeconds?: number } }).audio?.leadInSeconds ?? 0;
    const tail = (scene as { audio?: { tailPadSeconds?: number } }).audio?.tailPadSeconds ?? 0;
    const total =
      typeof audioDur === "number" && audioDur > 0
        ? audioDur + lead + tail
        : (scene.durationHint ?? 4);
    out.push({ sceneId: scene.id, start: cursor, duration: total });
    cursor += total;
  }
  return out;
}

function findMostRecentRender(projectDir: string): string | null {
  const rendersDir = join(projectDir, "renders");
  if (!existsSync(rendersDir)) return null;
  try {
    const fs = require("node:fs") as typeof import("node:fs");
    const entries = fs.readdirSync(rendersDir);
    const mp4s = entries.filter((f: string) => f.toLowerCase().endsWith(".mp4"));
    if (mp4s.length === 0) return null;
    const withMtime = mp4s.map((f: string) => {
      const stat = fs.statSync(join(rendersDir, f));
      return { f, mtime: stat.mtimeMs };
    });
    withMtime.sort((a, b) => b.mtime - a.mtime);
    const first = withMtime[0];
    return first ? `renders/${first.f}` : null;
  } catch {
    return null;
  }
}

function loadMostRecentRenderReview(projectDir: string): unknown | null {
  const dir = join(projectDir, ".hyperframes", "render-reviews");
  if (!existsSync(dir)) return null;
  try {
    const fs = require("node:fs") as typeof import("node:fs");
    const entries = fs.readdirSync(dir).filter((f: string) => f.endsWith(".json"));
    if (entries.length === 0) return null;
    entries.sort();
    const latest = entries[entries.length - 1];
    if (!latest) return null;
    return JSON.parse(readFileSync(join(dir, latest), "utf-8"));
  } catch {
    return null;
  }
}
