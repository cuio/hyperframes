import type { Hono } from "hono";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import type { StudioApiAdapter } from "../types.js";
import { isSafePath } from "../helpers/safePath.js";
import {
  loadElevenLabsKey,
  getElevenLabsKeyStatus,
  writeElevenLabsKeyToEnvFile,
  listVoices,
  fetchVoicePreview,
  synthesize,
  fileExtensionForFormat,
  ElevenLabsError,
  type SynthesizeOptions,
} from "../../elevenlabs/index.js";

const VALID_FORMATS: readonly string[] = [
  "mp3_44100_128",
  "mp3_44100_192",
  "pcm_16000",
  "pcm_22050",
  "pcm_44100",
];

interface GenerateBody {
  text?: string;
  voiceId?: string;
  filename?: string;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
  style?: number;
  outputFormat?: string;
}

function keyMissingResponse(): Response {
  return new Response(
    JSON.stringify({
      error:
        "ELEVENLABS_API_KEY not set. Add it to <project>/.env, ~/.hyperframes/.env, or the process environment.",
    }),
    { status: 401, headers: { "Content-Type": "application/json" } },
  );
}

function elevenLabsError(err: unknown): Response {
  const message = err instanceof Error ? err.message : String(err);
  const status = err instanceof ElevenLabsError && err.status ? err.status : 502;
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function registerElevenLabsRoutes(api: Hono, adapter: StudioApiAdapter): void {
  // Voice list — uses project-scoped key when a project is supplied via query param.
  api.get("/elevenlabs/voices", async (c) => {
    const projectId = c.req.query("project");
    let projectDir: string | undefined;
    if (projectId) {
      const project = await adapter.resolveProject(projectId);
      if (project) projectDir = project.dir;
    }
    const apiKey = loadElevenLabsKey(projectDir);
    if (!apiKey) return keyMissingResponse();

    try {
      const voices = await listVoices(apiKey);
      return c.json({
        voices: voices.map((v) => ({
          voice_id: v.voice_id,
          name: v.name,
          category: v.category,
          labels: v.labels ?? {},
          description: v.description,
          // Browser-safe preview URL — hits our proxy so the API key never leaves the server.
          preview_url: `/api/elevenlabs/voices/${encodeURIComponent(v.voice_id)}/preview${
            projectId ? `?project=${encodeURIComponent(projectId)}` : ""
          }`,
        })),
      });
    } catch (err) {
      return elevenLabsError(err);
    }
  });

  // Stream the short preview clip for one voice.
  api.get("/elevenlabs/voices/:voiceId/preview", async (c) => {
    const projectId = c.req.query("project");
    let projectDir: string | undefined;
    if (projectId) {
      const project = await adapter.resolveProject(projectId);
      if (project) projectDir = project.dir;
    }
    const apiKey = loadElevenLabsKey(projectDir);
    if (!apiKey) return keyMissingResponse();

    try {
      const result = await fetchVoicePreview(apiKey, c.req.param("voiceId"));
      if (!result) {
        return c.json({ error: "preview not available" }, 404);
      }
      return new Response(result.body, {
        status: 200,
        headers: {
          "Content-Type": result.contentType,
          "Cache-Control": "public, max-age=3600",
        },
      });
    } catch (err) {
      return elevenLabsError(err);
    }
  });

  // Synthesize speech and write it into the project's assets/voice directory.
  api.post("/projects/:id/elevenlabs/generate", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);

    const apiKey = loadElevenLabsKey(project.dir);
    if (!apiKey) return keyMissingResponse();

    let body: GenerateBody;
    try {
      body = (await c.req.json()) as GenerateBody;
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }

    const text = body.text?.trim();
    const voiceId = body.voiceId?.trim();
    if (!text) return c.json({ error: "text is required" }, 400);
    if (!voiceId) return c.json({ error: "voiceId is required" }, 400);

    let outputFormat: NonNullable<SynthesizeOptions["outputFormat"]> = "mp3_44100_128";
    if (body.outputFormat) {
      if (!VALID_FORMATS.includes(body.outputFormat)) {
        return c.json({ error: `invalid outputFormat. valid: ${VALID_FORMATS.join(", ")}` }, 400);
      }
      outputFormat = body.outputFormat as typeof outputFormat;
    }

    const ext = fileExtensionForFormat(outputFormat);
    const safeFilename = sanitizeFilename(body.filename) ?? `voice/scene-${Date.now()}.${ext}`;
    const relativePath = safeFilename.endsWith(`.${ext}`) ? safeFilename : `${safeFilename}.${ext}`;
    const finalRelative = relativePath.startsWith("assets/")
      ? relativePath
      : `assets/${relativePath}`;
    const absPath = resolve(project.dir, finalRelative);
    if (!isSafePath(project.dir, absPath)) {
      return c.json({ error: "forbidden" }, 403);
    }

    try {
      const { bytes } = await synthesize(apiKey, text, voiceId, {
        modelId: body.modelId,
        stability: body.stability,
        similarityBoost: body.similarityBoost,
        style: body.style,
        outputFormat,
      });
      mkdirSync(dirname(absPath), { recursive: true });
      writeFileSync(absPath, bytes);
      return c.json({
        ok: true,
        path: finalRelative,
        bytes: bytes.byteLength,
        format: outputFormat,
      });
    } catch (err) {
      return elevenLabsError(err);
    }
  });

  // Report whether a key is set, and which layer it came from. Never returns the value.
  api.get("/projects/:id/elevenlabs/key", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    return c.json(getElevenLabsKeyStatus(project.dir));
  });

  // Persist a key into <project>/.env. Use null/empty to remove it.
  api.put("/projects/:id/elevenlabs/key", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);

    let body: { value?: string | null };
    try {
      body = (await c.req.json()) as { value?: string | null };
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }

    const raw = typeof body.value === "string" ? body.value.trim() : null;
    const value = raw && raw.length > 0 ? raw : null;
    try {
      writeElevenLabsKeyToEnvFile(join(project.dir, ".env"), value);
      ensureGitignoreCovers(project.dir, ".env");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
    return c.json(getElevenLabsKeyStatus(project.dir));
  });

  // Read project's TTS settings (default voice id, etc.) from hyperframes.json.
  api.get("/projects/:id/elevenlabs/settings", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    return c.json(readTtsSettings(project.dir));
  });

  // Persist a partial TTS settings update into hyperframes.json.
  api.patch("/projects/:id/elevenlabs/settings", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);

    let body: { defaultVoiceId?: string | null };
    try {
      body = (await c.req.json()) as { defaultVoiceId?: string | null };
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }

    const next = writeTtsSettings(project.dir, body);
    return c.json(next);
  });
}

interface TtsSettings {
  defaultVoiceId: string | null;
}

function readTtsSettings(projectDir: string): TtsSettings {
  const path = join(projectDir, "hyperframes.json");
  if (!existsSync(path)) return { defaultVoiceId: null };
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as {
      tts?: { defaultVoiceId?: unknown };
    };
    const id = raw.tts?.defaultVoiceId;
    return { defaultVoiceId: typeof id === "string" && id.length > 0 ? id : null };
  } catch {
    return { defaultVoiceId: null };
  }
}

function writeTtsSettings(
  projectDir: string,
  patch: { defaultVoiceId?: string | null },
): TtsSettings {
  const path = join(projectDir, "hyperframes.json");
  let json: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      json = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    } catch {
      json = {};
    }
  }
  const tts =
    typeof json.tts === "object" && json.tts !== null
      ? ({ ...(json.tts as Record<string, unknown>) } as Record<string, unknown>)
      : {};

  if (Object.prototype.hasOwnProperty.call(patch, "defaultVoiceId")) {
    if (patch.defaultVoiceId == null || patch.defaultVoiceId === "") {
      delete tts.defaultVoiceId;
    } else {
      tts.defaultVoiceId = patch.defaultVoiceId;
    }
  }

  json.tts = tts;
  writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
  return readTtsSettings(projectDir);
}

/**
 * Make sure .env is excluded by the project's .gitignore — otherwise a
 * convenience UI could lead someone to commit a key. Idempotent; touches
 * .gitignore only when missing the entry. Best-effort: we do nothing if
 * the project isn't a git repo or the file isn't writable.
 */
function ensureGitignoreCovers(projectDir: string, entry: string): void {
  const gitignorePath = join(projectDir, ".gitignore");
  let content = "";
  try {
    if (existsSync(gitignorePath)) {
      content = readFileSync(gitignorePath, "utf-8");
    }
  } catch {
    return;
  }
  const lines = content.split(/\r?\n/);
  const already = lines.some((line) => line.trim() === entry || line.trim() === `/${entry}`);
  if (already) return;
  const trailingNl = content.length === 0 || content.endsWith("\n");
  const next = (trailingNl ? content : content + "\n") + `${entry}\n`;
  try {
    writeFileSync(gitignorePath, next);
  } catch {
    /* ignore — best effort */
  }
}

function sanitizeFilename(value: string | undefined): string | null {
  if (!value) return null;
  // Allow forward slashes for subdirectory hints, strip everything else risky.
  const cleaned = value
    .replace(/\\/g, "/")
    .replace(/\.\.+/g, ".")
    .replace(/[^a-zA-Z0-9._\-/]/g, "_")
    .replace(/^\/+/, "")
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}
