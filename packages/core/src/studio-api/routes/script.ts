import type { Hono } from "hono";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { StudioApiAdapter } from "../types.js";
import { isSafePath } from "../helpers/safePath.js";
import { loadAnthropicKey } from "../../anthropic/index.js";
import { loadElevenLabsKey, readDefaultVoiceId } from "../../elevenlabs/index.js";
import {
  planScript,
  planSceneVariants,
  synthesizeScript,
  assembleMaster,
  loadDesignBrief,
  loadDesignArt,
  loadResearch,
  resolveProjectTokens,
  ScriptPlannerError,
  DESIGN_ART_TEMPLATE,
  RESEARCH_TEMPLATE,
  type Script,
  type ScriptFidelity,
} from "../../script/index.js";

interface PlanBody {
  text?: string;
  model?: string;
  targetDurationSeconds?: number;
  maxSceneDuration?: number;
  fidelity?: ScriptFidelity;
  meta?: { title?: string; audience?: string; tone?: string; voiceId?: string };
}

interface GenerateBody {
  /** Provide either rawText (re-plan first) or script (use as-is). */
  rawText?: string;
  script?: Script;
  /** Override the script's voiceId for synthesis. */
  voiceId?: string;
  modelId?: string;
  outFile?: string;
  /** Same options as PlanBody if rawText is given. */
  planOptions?: Omit<PlanBody, "text">;
}

const SCRIPT_FILE = "script.json";
const PLANNED_FILE = "script.generated.json";

export function registerScriptRoutes(api: Hono, adapter: StudioApiAdapter): void {
  // Run the AI planner against raw text. Returns a Script DSL and writes it
  // to <project>/script.json so the user can iterate from the file.
  api.post("/projects/:id/script/plan", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);

    const apiKey = loadAnthropicKey(project.dir);
    if (!apiKey) {
      return c.json(
        {
          error:
            "ANTHROPIC_API_KEY not set. Add it to <project>/.env, ~/.hyperframes/.env, or the process env.",
        },
        401,
      );
    }

    let body: PlanBody;
    try {
      body = (await c.req.json()) as PlanBody;
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const text = body.text?.trim();
    if (!text) return c.json({ error: "text is required" }, 400);

    try {
      const script = await planScript(text, {
        apiKey,
        model: body.model,
        targetDurationSeconds: body.targetDurationSeconds,
        maxSceneDuration: body.maxSceneDuration,
        fidelity: body.fidelity,
        meta: body.meta,
        designBrief: loadDesignBrief(project.dir) ?? undefined,
        artDirection: loadDesignArt(project.dir) ?? undefined,
        research: loadResearch(project.dir) ?? undefined,
      });
      writeJson(join(project.dir, SCRIPT_FILE), script);
      return c.json({ ok: true, script });
    } catch (err) {
      if (err instanceof ScriptPlannerError) {
        return c.json({ error: err.message }, 502);
      }
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  // Scaffold templates: create RESEARCH.md / DESIGN-ART.md if missing.
  api.post("/projects/:id/script/scaffold", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);

    let body: { research?: boolean; designArt?: boolean };
    try {
      body = (await c.req.json()) as { research?: boolean; designArt?: boolean };
    } catch {
      body = {};
    }

    const created: string[] = [];
    const skipped: string[] = [];

    if (body.research !== false) {
      const path = join(project.dir, "RESEARCH.md");
      if (existsSync(path)) skipped.push("RESEARCH.md");
      else {
        writeFileSync(path, RESEARCH_TEMPLATE);
        created.push("RESEARCH.md");
      }
    }
    if (body.designArt !== false) {
      const path = join(project.dir, "DESIGN-ART.md");
      if (existsSync(path)) skipped.push("DESIGN-ART.md");
      else {
        writeFileSync(path, DESIGN_ART_TEMPLATE);
        created.push("DESIGN-ART.md");
      }
    }
    return c.json({ ok: true, created, skipped });
  });

  // Report which optional planner files exist.
  api.get("/projects/:id/script/files-status", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    return c.json({
      hasDesign: existsSync(join(project.dir, "DESIGN.md")),
      hasDesignArt:
        existsSync(join(project.dir, "DESIGN-ART.md")) ||
        existsSync(join(project.dir, "design-art.md")),
      hasResearch:
        existsSync(join(project.dir, "RESEARCH.md")) ||
        existsSync(join(project.dir, "research.md")),
    });
  });

  // Caption export: SRT + VTT generated from the planned timing.
  api.get("/projects/:id/script/captions.:format{srt|vtt}", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const format = c.req.param("format") as "srt" | "vtt";
    const plannedPath = join(project.dir, PLANNED_FILE);
    if (!existsSync(plannedPath)) {
      return c.json({ error: "no script.generated.json — run generate first" }, 400);
    }
    let planned: {
      scenes: Array<{
        id: string;
        text: string;
        audio?: { durationSeconds: number; leadInSeconds?: number; tailPadSeconds?: number };
        totalDurationSeconds?: number;
        durationHint?: number;
      }>;
    };
    try {
      planned = JSON.parse(readFileSync(plannedPath, "utf-8"));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
    const captions = format === "vtt" ? toVtt(planned.scenes) : toSrt(planned.scenes);
    return new Response(captions, {
      status: 200,
      headers: {
        "Content-Type": format === "vtt" ? "text/vtt" : "application/x-subrip",
        "Content-Disposition": `attachment; filename="captions.${format}"`,
      },
    });
  });

  // Read the saved script.json (if any).
  api.get("/projects/:id/script", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const path = join(project.dir, SCRIPT_FILE);
    if (!existsSync(path)) return c.json({ script: null });
    try {
      const script = JSON.parse(readFileSync(path, "utf-8")) as Script;
      return c.json({ script });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  // Generate N visual variants for a single scene. The narration text stays
  // fixed; the planner returns alternate templates / chart types. The user
  // picks one in the UI and we patch it into script.json via PUT /scenes/:sid.
  api.post("/projects/:id/script/scenes/:sceneId/variants", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const apiKey = loadAnthropicKey(project.dir);
    if (!apiKey) {
      return c.json({ error: "ANTHROPIC_API_KEY not set. Add it to <project>/.env." }, 401);
    }

    const sceneId = c.req.param("sceneId");
    const path = join(project.dir, SCRIPT_FILE);
    if (!existsSync(path)) {
      return c.json({ error: "no script.json on disk — plan first" }, 400);
    }
    let script: Script;
    try {
      script = JSON.parse(readFileSync(path, "utf-8")) as Script;
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
    const scene = script.scenes.find((s) => s.id === sceneId);
    if (!scene) return c.json({ error: `scene ${sceneId} not found` }, 404);

    let body: { count?: number; model?: string } = {};
    try {
      body = (await c.req.json()) as { count?: number; model?: string };
    } catch {
      /* allow empty body */
    }

    try {
      const variants = await planSceneVariants(
        scene,
        { meta: script.meta, allScenes: script.scenes },
        {
          apiKey,
          model: body.model,
          count: body.count,
          designBrief: loadDesignBrief(project.dir) ?? undefined,
          artDirection: loadDesignArt(project.dir) ?? undefined,
          research: loadResearch(project.dir) ?? undefined,
        },
      );
      return c.json({ ok: true, variants });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, err instanceof ScriptPlannerError ? 502 : 500);
    }
  });

  // Replace a single scene in script.json (after user picks a variant).
  api.put("/projects/:id/script/scenes/:sceneId", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const sceneId = c.req.param("sceneId");
    const path = join(project.dir, SCRIPT_FILE);
    if (!existsSync(path)) return c.json({ error: "no script.json on disk" }, 400);

    let body: { scene?: Record<string, unknown> };
    try {
      body = (await c.req.json()) as { scene?: Record<string, unknown> };
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    if (!body.scene || typeof body.scene !== "object") {
      return c.json({ error: "scene is required" }, 400);
    }

    let script: Script;
    try {
      script = JSON.parse(readFileSync(path, "utf-8")) as Script;
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
    const idx = script.scenes.findIndex((s) => s.id === sceneId);
    if (idx === -1) return c.json({ error: `scene ${sceneId} not found` }, 404);

    // Preserve the scene's id and existing audio cache info; replace the
    // visual treatment + reasoning from the variant.
    const incoming = body.scene as Record<string, unknown>;
    script.scenes[idx] = {
      ...script.scenes[idx]!,
      template:
        typeof incoming.template === "string" ? incoming.template : script.scenes[idx]!.template,
      props: (incoming.props as Record<string, unknown>) ?? script.scenes[idx]!.props,
      reasoning:
        typeof incoming.reasoning === "string" ? incoming.reasoning : script.scenes[idx]!.reasoning,
      hook: typeof incoming.hook === "boolean" ? incoming.hook : script.scenes[idx]!.hook,
    };
    writeJson(path, script);
    return c.json({ ok: true, scene: script.scenes[idx] });
  });

  // Manually update script.json (after user edits the plan in UI).
  api.put("/projects/:id/script", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    let body: { script?: Script };
    try {
      body = (await c.req.json()) as { script?: Script };
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    if (!body.script || !Array.isArray(body.script.scenes)) {
      return c.json({ error: "script.scenes is required" }, 400);
    }
    writeJson(join(project.dir, SCRIPT_FILE), body.script);
    return c.json({ ok: true });
  });

  // End-to-end: synthesize audio + assemble master index.html.
  api.post("/projects/:id/script/generate", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    if (!adapter.probeAudioDurationSeconds) {
      return c.json({ error: "ffprobe is not available in this server" }, 503);
    }
    const elKey = loadElevenLabsKey(project.dir);
    if (!elKey) {
      return c.json({ error: "ELEVENLABS_API_KEY not set. Set it before generating audio." }, 401);
    }

    let body: GenerateBody;
    try {
      body = (await c.req.json()) as GenerateBody;
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }

    let script: Script | null = body.script ?? null;
    if (!script && body.rawText) {
      const anthropicKey = loadAnthropicKey(project.dir);
      if (!anthropicKey) {
        return c.json(
          { error: "ANTHROPIC_API_KEY not set. Required when planning from rawText." },
          401,
        );
      }
      try {
        script = await planScript(body.rawText, {
          apiKey: anthropicKey,
          model: body.planOptions?.model,
          targetDurationSeconds: body.planOptions?.targetDurationSeconds,
          maxSceneDuration: body.planOptions?.maxSceneDuration,
          meta: body.planOptions?.meta,
          designBrief: loadDesignBrief(project.dir) ?? undefined,
          artDirection: loadDesignArt(project.dir) ?? undefined,
          research: loadResearch(project.dir) ?? undefined,
        });
        writeJson(join(project.dir, SCRIPT_FILE), script);
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
      }
    }
    if (!script) {
      // Fall back to disk if neither was passed.
      const path = join(project.dir, SCRIPT_FILE);
      if (!existsSync(path)) {
        return c.json({ error: "no script provided and no script.json on disk" }, 400);
      }
      script = JSON.parse(readFileSync(path, "utf-8")) as Script;
    }

    // Resolve effective voice: explicit override > script.meta > project default.
    const projectDefaultVoice = readDefaultVoiceId(project.dir);
    if (body.voiceId) {
      script.meta = { ...script.meta, voiceId: body.voiceId };
    } else if (!script.meta.voiceId && projectDefaultVoice) {
      script.meta = { ...script.meta, voiceId: projectDefaultVoice };
    }
    if (!script.meta.voiceId) {
      return c.json(
        {
          error:
            "No voice selected. Pick a default voice in the Voices tab, or pass voiceId in the request.",
        },
        400,
      );
    }

    try {
      const planned = await synthesizeScript(script, {
        apiKey: elKey,
        projectDir: project.dir,
        modelId: body.modelId,
        probeDurationSeconds: adapter.probeAudioDurationSeconds,
        fallbackVoiceId: script.meta.voiceId,
      });
      writeJson(join(project.dir, PLANNED_FILE), planned);

      const outFile = body.outFile ?? "index.html";
      const absOut = join(project.dir, outFile);
      if (!isSafePath(project.dir, absOut)) {
        return c.json({ error: "forbidden outFile path" }, 403);
      }

      const tokens = resolveProjectTokens(project.dir, loadDesignBrief(project.dir));
      const result = assembleMaster(planned, { projectDir: project.dir, outFile, tokens });
      return c.json({ ok: true, planned, result });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

interface CaptionSceneShape {
  id: string;
  text: string;
  audio?: { durationSeconds: number; leadInSeconds?: number; tailPadSeconds?: number };
  totalDurationSeconds?: number;
  durationHint?: number;
}

function captionWindows(
  scenes: CaptionSceneShape[],
): Array<{ start: number; end: number; text: string }> {
  let cursor = 0;
  const out: Array<{ start: number; end: number; text: string }> = [];
  for (const scene of scenes) {
    const total =
      scene.totalDurationSeconds ??
      (scene.audio
        ? (scene.audio.leadInSeconds ?? 0) +
          scene.audio.durationSeconds +
          (scene.audio.tailPadSeconds ?? 0)
        : (scene.durationHint ?? 3));
    const audioStart = cursor + (scene.audio?.leadInSeconds ?? 0);
    const audioEnd = audioStart + (scene.audio?.durationSeconds ?? total);
    if (scene.text?.trim()) {
      out.push({ start: audioStart, end: audioEnd, text: scene.text.trim() });
    }
    cursor += total;
  }
  return out;
}

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds - Math.floor(seconds)) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function formatVttTime(seconds: number): string {
  return formatSrtTime(seconds).replace(",", ".");
}

function toSrt(scenes: CaptionSceneShape[]): string {
  const windows = captionWindows(scenes);
  return windows
    .map((w, i) => `${i + 1}\n${formatSrtTime(w.start)} --> ${formatSrtTime(w.end)}\n${w.text}\n`)
    .join("\n");
}

function toVtt(scenes: CaptionSceneShape[]): string {
  const windows = captionWindows(scenes);
  return (
    "WEBVTT\n\n" +
    windows
      .map((w) => `${formatVttTime(w.start)} --> ${formatVttTime(w.end)}\n${w.text}\n`)
      .join("\n")
  );
}
