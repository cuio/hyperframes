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
  const manifest = readManifest(opts.projectDir);
  const planned: PlannedScene[] = [];
  let total = 0;

  for (const scene of script.scenes) {
    const voiceId = scene.voiceId ?? script.meta.voiceId ?? opts.fallbackVoiceId;

    // Visual-only scenes pass through with their hint duration.
    if (!scene.text.trim()) {
      const dur = scene.durationHint ?? 3;
      planned.push({ ...scene });
      total += dur;
      opts.onScene?.({ scene, cached: false, skipped: true });
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
    let durationSeconds = 0;

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
      durationSeconds = cacheEntry.durationSeconds;
    } else {
      const { bytes } = await synthesize(opts.apiKey, scene.text, voiceId, {
        modelId,
        outputFormat,
        ...opts.voiceSettings,
      });
      mkdirSync(dirname(absPath), { recursive: true });
      writeFileSync(absPath, bytes);
      durationSeconds = await opts.probeDurationSeconds(absPath);
      manifest.entries[scene.id] = {
        contentHash: hash,
        voiceId,
        modelId,
        format: outputFormat,
        audioPath: relativePath,
        durationSeconds,
      };
    }

    const plannedScene: PlannedScene = {
      ...scene,
      audio: { path: relativePath, durationSeconds, contentHash: hash },
    };
    planned.push(plannedScene);
    total += durationSeconds;
    opts.onScene?.({ scene: plannedScene, cached, skipped: false });
  }

  writeManifest(opts.projectDir, manifest);
  return { meta: script.meta, scenes: planned, totalDurationSeconds: total };
}
