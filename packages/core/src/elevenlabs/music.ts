/**
 * ElevenLabs Music client (Eleven v3 Music). Unlike SFX which is synchronous
 * (request → mp3 in one round-trip), music is an async job:
 *
 *     POST /v1/music                  → { music_id, status: "processing" }
 *     GET  /v1/music/:id              → { status: "completed", audio_url }
 *     GET  audio_url                  → mp3 bytes
 *
 * Callers want either the bytes (most common) or the job id (for progress
 * UIs). `generateMusicAndWait` does the full poll-then-download flow with
 * geometric backoff. The studio route exposes the job id immediately so the
 * UI can show "generating…" without freezing the request.
 */

import { ElevenLabsError } from "./client.js";

const API_BASE = "https://api.elevenlabs.io/v1";

/** Music length bounds. The API supports up to ~5min in practice; we cap
 *  shorter to avoid runaway generations on user typos. */
export const MUSIC_BOUNDS = {
  durationMin: 10,
  durationMax: 300,
  promptMaxChars: 1500,
} as const;

export type MusicJobStatus = "processing" | "completed" | "failed";

export interface MusicJob {
  id: string;
  status: MusicJobStatus;
  /** Set once status === "completed". Direct-download URL for the mp3. */
  audioUrl?: string;
  /** Reported by the API on failed jobs. */
  errorMessage?: string;
}

export interface GenerateMusicOptions {
  durationMs?: number;
  outputFormat?: "mp3_44100_128" | "mp3_44100_192";
}

export function clampMusicDuration(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds)) return 60;
  return Math.max(MUSIC_BOUNDS.durationMin, Math.min(MUSIC_BOUNDS.durationMax, durationSeconds));
}

/**
 * Submit a music-generation request. Returns the job id immediately so the
 * caller can show progress. Caller must poll `getMusicJob` (or use
 * `generateMusicAndWait`) to retrieve the audio.
 */
export async function generateMusic(
  apiKey: string,
  prompt: string,
  opts: GenerateMusicOptions = {},
): Promise<MusicJob> {
  if (!prompt || !prompt.trim()) {
    throw new ElevenLabsError("generateMusic: prompt is required");
  }
  const trimmed = prompt.trim();
  if (trimmed.length > MUSIC_BOUNDS.promptMaxChars) {
    throw new ElevenLabsError(
      `generateMusic: prompt too long (max ${MUSIC_BOUNDS.promptMaxChars} chars)`,
    );
  }
  const body: Record<string, unknown> = { prompt: trimmed };
  if (typeof opts.durationMs === "number") {
    body.music_length_ms = Math.round(
      Math.max(
        MUSIC_BOUNDS.durationMin * 1000,
        Math.min(MUSIC_BOUNDS.durationMax * 1000, opts.durationMs),
      ),
    );
  }
  if (opts.outputFormat) body.output_format = opts.outputFormat;

  const res = await fetch(`${API_BASE}/music`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const text = await res.text();
      detail = text.length > 500 ? text.slice(0, 500) + "…" : text;
    } catch {
      /* ignore */
    }
    throw new ElevenLabsError(
      `generateMusic: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`,
      res.status,
    );
  }
  const json = (await res.json()) as {
    music_id?: string;
    status?: MusicJobStatus;
    audio_url?: string;
  };
  if (!json.music_id) {
    throw new ElevenLabsError("generateMusic: response missing music_id");
  }
  return {
    id: json.music_id,
    status: json.status ?? "processing",
    ...(json.audio_url ? { audioUrl: json.audio_url } : {}),
  };
}

export async function getMusicJob(apiKey: string, jobId: string): Promise<MusicJob> {
  const res = await fetch(`${API_BASE}/music/${encodeURIComponent(jobId)}`, {
    headers: { "xi-api-key": apiKey, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new ElevenLabsError(`getMusicJob: ${res.status} ${res.statusText}`, res.status);
  }
  const json = (await res.json()) as {
    music_id?: string;
    status?: MusicJobStatus;
    audio_url?: string;
    error_message?: string;
  };
  return {
    id: json.music_id ?? jobId,
    status: json.status ?? "processing",
    ...(json.audio_url ? { audioUrl: json.audio_url } : {}),
    ...(json.error_message ? { errorMessage: json.error_message } : {}),
  };
}

/**
 * Submit + poll until completed. Geometric backoff: 2s, 4s, 8s, max 30s.
 * Total wait capped at `maxWaitMs` (default 5min). Throws ElevenLabsError on
 * failure or timeout.
 */
export async function generateMusicAndWait(
  apiKey: string,
  prompt: string,
  opts: GenerateMusicOptions & { maxWaitMs?: number; onProgress?: (job: MusicJob) => void } = {},
): Promise<{ jobId: string; audioUrl: string }> {
  const job = await generateMusic(apiKey, prompt, opts);
  if (job.status === "completed" && job.audioUrl) {
    return { jobId: job.id, audioUrl: job.audioUrl };
  }
  if (job.status === "failed") {
    throw new ElevenLabsError(`generateMusic: job failed — ${job.errorMessage ?? "no detail"}`);
  }
  const maxWait = opts.maxWaitMs ?? 300_000;
  const start = Date.now();
  let delay = 2000;
  while (Date.now() - start < maxWait) {
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, 30_000);
    const next = await getMusicJob(apiKey, job.id);
    opts.onProgress?.(next);
    if (next.status === "completed" && next.audioUrl) {
      return { jobId: next.id, audioUrl: next.audioUrl };
    }
    if (next.status === "failed") {
      throw new ElevenLabsError(`generateMusic: job failed — ${next.errorMessage ?? "no detail"}`);
    }
  }
  throw new ElevenLabsError(
    `generateMusic: timed out after ${maxWait}ms waiting for job ${job.id}`,
  );
}

/**
 * Download a completed job's mp3 bytes. The audio_url is signed and short-
 * lived — call this immediately after `generateMusicAndWait` returns.
 */
export async function downloadMusic(audioUrl: string): Promise<Uint8Array> {
  const res = await fetch(audioUrl);
  if (!res.ok) {
    throw new ElevenLabsError(`downloadMusic: ${res.status} ${res.statusText}`, res.status);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  return bytes;
}
