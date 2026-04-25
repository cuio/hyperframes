import type { Hono } from "hono";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import type { StudioApiAdapter } from "../types.js";
import { isSafePath } from "../helpers/safePath.js";
import { atomicWriteFileSync, withMutex } from "../../internal/atomicWrite.js";
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

// ElevenLabs accepts up to ~5000 chars per synth; we cap a hair lower so the
// JSON payload itself never blows past a sensible body size and so a malformed
// client can't send 10MB of "text" to drive up costs.
const MAX_TTS_TEXT_LEN = 4500;

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
    } catch (err) {
      console.warn("[elevenlabs] /generate invalid JSON body", err);
      return c.json({ error: "invalid JSON body" }, 400);
    }

    const text = body.text?.trim();
    const voiceId = body.voiceId?.trim();
    if (!text) return c.json({ error: "text is required" }, 400);
    if (!voiceId) return c.json({ error: "voiceId is required" }, 400);
    if (text.length > MAX_TTS_TEXT_LEN) {
      return c.json(
        {
          error: `text too long (${text.length} chars; max ${MAX_TTS_TEXT_LEN}). Split into multiple scenes.`,
        },
        413,
      );
    }

    let outputFormat: NonNullable<SynthesizeOptions["outputFormat"]> = "mp3_44100_128";
    if (body.outputFormat) {
      if (!VALID_FORMATS.includes(body.outputFormat)) {
        return c.json({ error: `invalid outputFormat. valid: ${VALID_FORMATS.join(", ")}` }, 400);
      }
      outputFormat = body.outputFormat as typeof outputFormat;
    }

    const ext = fileExtensionForFormat(outputFormat);
    const sanitized = sanitizeFilename(body.filename, ext);
    if (body.filename != null && body.filename.trim().length > 0 && sanitized == null) {
      return c.json(
        {
          error:
            "invalid filename. Use letters, digits, dash, underscore, dot, or forward slash; no leading dots or '..'.",
        },
        400,
      );
    }
    const safeFilename = sanitized ?? `voice/scene-${Date.now()}.${ext}`;
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
      // Atomic so a partial write can't leave a 0-byte file the next pipeline run picks up.
      atomicWriteFileSync(absPath, bytes);
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
    } catch (err) {
      console.warn("[elevenlabs] PUT /key invalid JSON body", err);
      return c.json({ error: "invalid JSON body" }, 400);
    }

    const raw = typeof body.value === "string" ? body.value.trim() : null;
    const value = raw && raw.length > 0 ? raw : null;
    try {
      // Serialize against any settings PATCH for the same project so writes
      // can't interleave on the same hyperframes.json scratch space.
      await withMutex(`project:${project.dir}:env`, async () => {
        writeElevenLabsKeyToEnvFile(join(project.dir, ".env"), value);
        ensureGitignoreCovers(project.dir, ".env");
      });
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
    } catch (err) {
      console.warn("[elevenlabs] PATCH /settings invalid JSON body", err);
      return c.json({ error: "invalid JSON body" }, 400);
    }

    // Validate types before touching disk so a bad payload can't no-op the lock.
    if (
      body.defaultVoiceId !== undefined &&
      body.defaultVoiceId !== null &&
      typeof body.defaultVoiceId !== "string"
    ) {
      return c.json({ error: "defaultVoiceId must be a string or null" }, 400);
    }

    const next = await withMutex(`project:${project.dir}:settings`, async () =>
      writeTtsSettings(project.dir, body),
    );
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
  } catch (err) {
    console.warn(`[elevenlabs] hyperframes.json at ${path} is not valid JSON; using defaults`, err);
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
    } catch (err) {
      console.warn(
        `[elevenlabs] hyperframes.json at ${path} is not valid JSON; replacing on next write`,
        err,
      );
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
  atomicWriteFileSync(path, JSON.stringify(json, null, 2) + "\n");
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
    atomicWriteFileSync(gitignorePath, next);
  } catch {
    /* ignore — best effort */
  }
}

/**
 * Whitelist-based filename sanitizer for user-supplied output filenames.
 *
 * Accepts a forward-slash-delimited relative path. Each component must match
 * `[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)?`, so:
 *  - no leading dots (no hidden files / no `.git/`)
 *  - no `..` traversal
 *  - exactly one dot per component (prevents `voice.html.mp3`-style ambiguous
 *    extensions)
 *  - no spaces, slashes inside components, or shell metachars
 *
 * If `expectedExt` is provided, components that already have an extension must
 * match it — this prevents a caller from injecting an .html or .exe through a
 * code path that treats the file as audio.
 *
 * Returns null on invalid input; caller should reject (400) rather than fall
 * back to a default, so users get a clear error instead of silently renamed
 * outputs.
 */
export function sanitizeFilename(value: string | undefined, expectedExt?: string): string | null {
  if (!value) return null;
  let v = value.replace(/\\+/g, "/").replace(/\/+/g, "/").replace(/^\/+/, "").trim();
  if (!v) return null;
  // No control characters anywhere (defense in depth — they'd already fail the
  // per-component regex below, but worth refusing early).
  // eslint-disable-next-line no-control-regex
  if (/[ -]/.test(v)) return null;
  const parts = v.split("/");
  const safeParts: string[] = [];
  for (const part of parts) {
    if (!part) return null;
    if (part === "." || part === "..") return null;
    if (part.startsWith(".")) return null;
    if (!/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?$/.test(part)) return null;
    safeParts.push(part);
  }
  if (safeParts.length === 0) return null;
  // If an extension is mandated, the basename's extension (if present) must match.
  if (expectedExt) {
    const last = safeParts[safeParts.length - 1] as string;
    const dot = last.lastIndexOf(".");
    if (dot !== -1) {
      const ext = last.slice(dot + 1);
      if (ext !== expectedExt) return null;
    }
  }
  return safeParts.join("/");
}
