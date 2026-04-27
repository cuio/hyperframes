import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PlannedScene } from "../types.js";

/**
 * SFX manifest — the contract between the storyline routes (which generate
 * sound-effects via ElevenLabs) and the assembler (which emits
 * `<audio data-track-index="3">` elements onto the SFX lane).
 *
 * Stored at `<project>/assets/sfx/sfx.manifest.json`. Audio files live next to
 * it as `<sceneId>-<entryId>.mp3`. Manifests are append-only from the
 * studio's perspective — the user can delete entries, but each generation
 * mints a stable id so the assembler's output is reproducible across
 * re-runs.
 *
 * Why a manifest (not script.json fields):
 *   - Script.json is purely about narration + scene visual decisions. Audio
 *     assets stay decoupled.
 *   - The manifest can be regenerated independently if the user wipes
 *     `assets/sfx/` and wants to re-run.
 *   - Future tooling (CLI prune, "regenerate all"} can operate on the
 *     manifest without parsing script.json.
 */

export const SFX_DIR = "assets/sfx";
export const SFX_MANIFEST = "sfx.manifest.json";
export const SFX_MANIFEST_VERSION = 1;

/**
 * Where this SFX should land on the timeline relative to the scene window.
 * Three anchors cover ~95% of cinematic usage; resist adding free-form
 * offsets until a concrete user need shows up.
 */
export type SfxAnchor = "scene-start" | "accent-word" | "scene-end";

export interface SfxEntry {
  /** Stable id per generation. Used as the filename suffix. */
  id: string;
  /** Owning scene. Each entry is anchored relative to its scene's window. */
  sceneId: string;
  /** The text prompt sent to ElevenLabs. Surfaced in the studio for context. */
  prompt: string;
  /** Path under the project root. Always `assets/sfx/<sceneId>-<id>.mp3`. */
  path: string;
  /** Measured duration of the file (seconds) — the assembler uses this to
   *  set `data-duration` so the timeline shows the real footprint. */
  durationSeconds: number;
  /** Where in the scene window to anchor playback. */
  anchor: SfxAnchor;
  /**
   * For `accent-word` anchor: the 0-based word index inside the narration to
   * align to. Ignored for the other anchors. The assembler treats this as a
   * Phase-A heuristic — see `resolveSfxStart` for the math.
   */
  accentWordIndex?: number;
  /** Optional human label for the SFX (e.g. "broadcast static") — shown on
   *  the SFX lane clip. Defaults to a truncation of the prompt. */
  label?: string;
  /** Volume in dB (0 = full). Surface to the producer's audio mixer. */
  volumeDb?: number;
  /** ISO timestamp the entry was created. Used for "regenerate" decisions. */
  createdAt: string;
}

export interface SfxManifest {
  version: number;
  entries: SfxEntry[];
}

export function emptyManifest(): SfxManifest {
  return { version: SFX_MANIFEST_VERSION, entries: [] };
}

export function readSfxManifest(projectDir: string): SfxManifest {
  const path = join(projectDir, SFX_DIR, SFX_MANIFEST);
  if (!existsSync(path)) return emptyManifest();
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as Partial<SfxManifest>;
    if (!raw || typeof raw !== "object") return emptyManifest();
    const entries = Array.isArray(raw.entries) ? raw.entries.filter(isValidEntry) : [];
    return { version: SFX_MANIFEST_VERSION, entries };
  } catch {
    return emptyManifest();
  }
}

export function writeSfxManifest(projectDir: string, manifest: SfxManifest): void {
  const path = join(projectDir, SFX_DIR, SFX_MANIFEST);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
}

export function appendSfxEntry(projectDir: string, entry: SfxEntry): SfxManifest {
  const manifest = readSfxManifest(projectDir);
  manifest.entries.push(entry);
  writeSfxManifest(projectDir, manifest);
  return manifest;
}

export function removeSfxEntry(projectDir: string, entryId: string): SfxManifest {
  const manifest = readSfxManifest(projectDir);
  manifest.entries = manifest.entries.filter((e) => e.id !== entryId);
  writeSfxManifest(projectDir, manifest);
  return manifest;
}

function isValidEntry(value: unknown): value is SfxEntry {
  if (!value || typeof value !== "object") return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    typeof e.sceneId === "string" &&
    typeof e.prompt === "string" &&
    typeof e.path === "string" &&
    typeof e.durationSeconds === "number" &&
    typeof e.anchor === "string" &&
    (e.anchor === "scene-start" || e.anchor === "accent-word" || e.anchor === "scene-end") &&
    typeof e.createdAt === "string"
  );
}

/**
 * Compute the absolute timeline start time for a single SFX entry given the
 * scene's window on the master timeline.
 *
 * Pure helper — exported for tests so the anchor math is exercised without
 * touching disk or the assembler.
 *
 * Inputs:
 *   - sceneStart: where the scene begins on the master timeline (s)
 *   - sceneDuration: scene's total window length (s) — INCLUDING lead-in and
 *     tail-pad, not just the audio duration
 *   - audioStartOffset: how many seconds into the scene the voiceover starts
 *     (= scene.audio.leadInSeconds, defaults to 0)
 *   - voiceDurationSeconds: voiceover length (s); used to interpolate the
 *     accent-word position
 *   - voiceWordCount: number of words in the narration; used as the divisor
 *     for accent-word interpolation
 *   - entry: the SFX entry whose anchor + duration determine placement
 *
 * Returns the absolute scene-start time. The returned value is clamped so it
 * never lands before the scene starts; the assembler's separate clip-overlap
 * guard handles the upper bound.
 */
export function resolveSfxStart(input: {
  sceneStart: number;
  sceneDuration: number;
  audioStartOffset: number;
  voiceDurationSeconds: number;
  voiceWordCount: number;
  entry: Pick<SfxEntry, "anchor" | "accentWordIndex" | "durationSeconds">;
}): number {
  const { sceneStart, sceneDuration, audioStartOffset, entry } = input;
  if (entry.anchor === "scene-start") {
    return Math.max(sceneStart, sceneStart + audioStartOffset);
  }
  if (entry.anchor === "scene-end") {
    // End-anchored SFX should land so it FINISHES at scene end — i.e. its
    // start is `sceneEnd - sfxDuration`. Clamp to never overlap the next
    // scene by accident.
    const sceneEnd = sceneStart + sceneDuration;
    const start = sceneEnd - Math.max(0, entry.durationSeconds);
    return Math.max(sceneStart, start);
  }
  // accent-word: linear-interpolate based on word index. Phase-A heuristic;
  // Phase-B will replace with ElevenLabs alignment timestamps.
  if (input.voiceWordCount <= 0 || input.voiceDurationSeconds <= 0) {
    // No narration to anchor to — fall back to scene-start.
    return Math.max(sceneStart, sceneStart + audioStartOffset);
  }
  const idx = Math.max(0, Math.min(input.voiceWordCount - 1, entry.accentWordIndex ?? 0));
  const wordOffset = (idx / input.voiceWordCount) * input.voiceDurationSeconds;
  return sceneStart + audioStartOffset + wordOffset;
}

/**
 * Convenience: given a manifest entry and the assembler's PlannedScene
 * cursor, compute the start. Wraps `resolveSfxStart` with the scene
 * lookup so callers can pass `(entry, scene, cursor)` directly.
 */
export function resolveSfxStartForScene(
  entry: SfxEntry,
  scene: Pick<PlannedScene, "text" | "audio">,
  sceneStart: number,
  sceneTotalDurationSeconds: number,
): number {
  const audio = scene.audio;
  return resolveSfxStart({
    sceneStart,
    sceneDuration: sceneTotalDurationSeconds,
    audioStartOffset: audio?.leadInSeconds ?? 0,
    voiceDurationSeconds: audio?.durationSeconds ?? 0,
    voiceWordCount: countWords(scene.text),
    entry,
  });
}

function countWords(text: string | undefined | null): number {
  if (!text) return 0;
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}
