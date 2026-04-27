/**
 * ElevenLabs Sound Generation client.
 *
 * Mirrors the existing `synthesize()` shape for voice — single function call
 * that returns audio bytes + chosen format. Errors surface via the same
 * `ElevenLabsError` so callers get a uniform try/catch shape across
 * voice / sfx / music.
 */

import { ElevenLabsError } from "./client.js";

const API_BASE = "https://api.elevenlabs.io/v1";

export interface GenerateSfxOptions {
  /** 0.5..22 seconds. ElevenLabs treats this as a target — actual ±20%. */
  durationSeconds?: number;
  /**
   * 0..1. Higher = stick closer to the prompt; lower = more creative
   * variation. Default 0.3 matches ElevenLabs's own default for the SFX
   * playground.
   */
  promptInfluence?: number;
  /** Output format. mp3_44100_128 is the cheapest acceptable quality for SFX. */
  outputFormat?: "mp3_44100_128" | "mp3_44100_192";
}

export interface GenerateSfxResult {
  bytes: Uint8Array;
  format: NonNullable<GenerateSfxOptions["outputFormat"]>;
}

/**
 * Generate one sound effect from a text prompt. Returns mp3 bytes — caller
 * writes them to disk.
 *
 *     const { bytes } = await generateSoundEffect(apiKey, "snap zoom whoosh", { durationSeconds: 1.5 });
 *     fs.writeFileSync("sfx.mp3", bytes);
 *
 * Cost is billed per generation, not per duration — short SFX cost the same
 * as long ones up to the 22-second cap. Surface the count in the cost log.
 */
export async function generateSoundEffect(
  apiKey: string,
  prompt: string,
  opts: GenerateSfxOptions = {},
): Promise<GenerateSfxResult> {
  if (!prompt || !prompt.trim()) {
    throw new ElevenLabsError("generateSoundEffect: prompt is required");
  }
  const trimmed = prompt.trim();
  if (trimmed.length > 1000) {
    throw new ElevenLabsError("generateSoundEffect: prompt too long (max 1000 chars)");
  }
  const format = opts.outputFormat ?? "mp3_44100_128";
  const body: Record<string, unknown> = { text: trimmed, output_format: format };
  if (typeof opts.durationSeconds === "number") {
    // ElevenLabs caps at 0.5..22 — clamp here so a misconfigured caller
    // doesn't get a 422 round-trip.
    body.duration_seconds = Math.max(0.5, Math.min(22, opts.durationSeconds));
  }
  if (typeof opts.promptInfluence === "number") {
    body.prompt_influence = Math.max(0, Math.min(1, opts.promptInfluence));
  }

  const res = await fetch(`${API_BASE}/sound-generation`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
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
      `generateSoundEffect: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`,
      res.status,
    );
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  return { bytes: buf, format };
}

/**
 * Helpers for clamping values before they hit the wire — exported so the
 * studio API route can reuse the same bounds when validating user input.
 */
export const SFX_BOUNDS = {
  durationMin: 0.5,
  durationMax: 22,
  promptMaxChars: 1000,
} as const;

export function clampSfxDuration(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds)) return 2;
  return Math.max(SFX_BOUNDS.durationMin, Math.min(SFX_BOUNDS.durationMax, durationSeconds));
}
