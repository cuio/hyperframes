import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileExtensionForFormat, synthesize, type SynthesizeOptions } from "../elevenlabs/index.js";
import type { PlannedScene, PlannedScript, Script } from "./types.js";

export interface SynthesizeScriptOptions {
  apiKey: string;
  /** Project root — audio files written under <projectDir>/assets/voice/. */
  projectDir: string;
  /**
   * Async fn that returns audio duration in seconds. Pluggable so core stays
   * free of an ffprobe dependency; CLI/studio inject one that uses engine.
   */
  probeDurationSeconds(filePath: string): Promise<number>;
  /** Defaults to "mp3_44100_128". */
  outputFormat?: SynthesizeOptions["outputFormat"];
  /** Default voice if a scene has none and script.meta has none. */
  fallbackVoiceId?: string;
  /** Optional model override. */
  modelId?: string;
  /** Per-scene voice settings shared across the script. */
  voiceSettings?: Pick<SynthesizeOptions, "stability" | "similarityBoost" | "style">;
  /**
   * Extra seconds added to each scene's duration AFTER the audio so the
   * voiceover never gets clipped by the next scene. Defaults to 0.35s — a
   * tight beat of silence that reads as breathing room, not lag.
   */
  tailPadSeconds?: number;
  /**
   * Extra seconds at the START of a scene before the audio begins. Lets the
   * visual establish before the voiceover lands. Defaults to 0.15s.
   */
  leadInSeconds?: number;
  /** Called whenever a scene's audio is generated or reused. */
  onScene?(event: { scene: PlannedScene; cached: boolean; skipped: boolean }): void;
}

const CACHE_DIRNAME = ".hyperframes-cache/voice";

interface CacheEntry {
  contentHash: string;
  voiceId: string;
  modelId: string;
  format: string;
  audioPath: string;
  durationSeconds: number;
}

interface CacheManifest {
  entries: Record<string, CacheEntry>;
}

function readManifest(projectDir: string): CacheManifest {
  const path = join(projectDir, CACHE_DIRNAME, "manifest.json");
  if (!existsSync(path)) return { entries: {} };
  try {
    const data = JSON.parse(readFileSync(path, "utf-8")) as CacheManifest;
    if (!data.entries || typeof data.entries !== "object") return { entries: {} };
    return data;
  } catch {
    return { entries: {} };
  }
}

function writeManifest(projectDir: string, manifest: CacheManifest): void {
  const path = join(projectDir, CACHE_DIRNAME, "manifest.json");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
}

function hashScene(text: string, voiceId: string, modelId: string, format: string): string {
  return createHash("sha256")
    .update(text)
    .update("\0")
    .update(voiceId)
    .update("\0")
    .update(modelId)
    .update("\0")
    .update(format)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Synthesize all scenes' audio. Cached by content-hash of (text, voice, model,
 * format). Results are written to assets/voice/<sceneId>.<ext> and the cache
 * manifest under .hyperframes-cache/voice/manifest.json.
 *
 * Empty-text scenes are kept but skipped (no audio file). They still count as
 * silent scenes during master timeline assembly.
 */
export async function synthesizeScript(
  script: Script,
  opts: SynthesizeScriptOptions,
): Promise<PlannedScript> {
  const outputFormat = opts.outputFormat ?? "mp3_44100_128";
  const ext = fileExtensionForFormat(outputFormat);
  const modelId = opts.modelId ?? "eleven_turbo_v2_5";
  const tailPad = opts.tailPadSeconds ?? 0.35;
  const leadIn = opts.leadInSeconds ?? 0.15;
  const manifest = readManifest(opts.projectDir);
  const planned: PlannedScene[] = [];
  let total = 0;

  for (const scene of script.scenes) {
    const voiceId = scene.voiceId ?? script.meta.voiceId ?? opts.fallbackVoiceId;

    // Visual-only scenes pass through with their hint duration. Padding still
    // applies so the rhythm is consistent across the video.
    if (!scene.text.trim()) {
      const dur = (scene.durationHint ?? 3) + leadIn + tailPad;
      const visualOnlyScene: PlannedScene = { ...scene, totalDurationSeconds: dur };
      planned.push(visualOnlyScene);
      total += dur;
      opts.onScene?.({ scene: visualOnlyScene, cached: false, skipped: true });
      continue;
    }
    if (!voiceId) {
      throw new Error(
        `Scene ${scene.id} has narration but no voiceId (no scene/script/fallback voice)`,
      );
    }

    const hash = hashScene(scene.text, voiceId, modelId, outputFormat);
    const relativePath = `assets/voice/${scene.id}.${ext}`;
    const absPath = join(opts.projectDir, relativePath);

    let cached = false;
    let audioDurationSeconds = 0;

    const cacheEntry = manifest.entries[scene.id];
    if (
      cacheEntry &&
      cacheEntry.contentHash === hash &&
      cacheEntry.voiceId === voiceId &&
      cacheEntry.modelId === modelId &&
      cacheEntry.format === outputFormat &&
      cacheEntry.audioPath === relativePath &&
      existsSync(absPath)
    ) {
      cached = true;
      audioDurationSeconds = cacheEntry.durationSeconds;
    } else {
      const { bytes } = await synthesize(opts.apiKey, scene.text, voiceId, {
        modelId,
        outputFormat,
        ...opts.voiceSettings,
      });
      mkdirSync(dirname(absPath), { recursive: true });
      writeFileSync(absPath, bytes);
      audioDurationSeconds = await opts.probeDurationSeconds(absPath);
      manifest.entries[scene.id] = {
        contentHash: hash,
        voiceId,
        modelId,
        format: outputFormat,
        audioPath: relativePath,
        durationSeconds: audioDurationSeconds,
      };
    }

    // Scene window = lead-in + audio + tail-pad. Voiceover never gets clipped
    // because the next scene doesn't start until tailPad seconds after audio
    // ends. The visual establishes during leadIn before voice lands.
    const sceneTotal = leadIn + audioDurationSeconds + tailPad;

    const plannedScene: PlannedScene = {
      ...scene,
      audio: {
        path: relativePath,
        durationSeconds: audioDurationSeconds,
        contentHash: hash,
        leadInSeconds: leadIn,
        tailPadSeconds: tailPad,
      },
      totalDurationSeconds: sceneTotal,
    };
    planned.push(plannedScene);
    total += sceneTotal;
    opts.onScene?.({ scene: plannedScene, cached, skipped: false });
  }

  writeManifest(opts.projectDir, manifest);
  return { meta: script.meta, scenes: planned, totalDurationSeconds: total };
}
