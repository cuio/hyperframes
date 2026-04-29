import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Music manifest — lives at `<project>/assets/music/music.manifest.json`.
 * Mirrors the SFX manifest pattern with one structural difference: a music
 * track spans MULTIPLE scenes (an underscore covers a whole act, a stinger
 * covers a single transition). Anchoring is therefore a `scenesCovered: []`
 * array instead of a single anchor.
 *
 * The assembler computes the absolute start/end on the master timeline by
 * looking up the first and last scene's cumulative offsets. Each track's
 * audio file lives at `assets/music/<id>.mp3` next to the manifest.
 */

export const MUSIC_DIR = "assets/music";
export const MUSIC_MANIFEST = "music.manifest.json";
export const MUSIC_MANIFEST_VERSION = 1;

export type MusicRole = "underscore" | "stinger" | "intro" | "outro";

export interface MusicEntry {
  id: string;
  /** Text prompt sent to ElevenLabs. Surfaced in the studio for context. */
  prompt: string;
  /** Path under the project root: `assets/music/<id>.mp3`. */
  path: string;
  /** Measured length of the file (seconds). The assembler uses this directly
   *  as `data-duration` so the timeline shows the real footprint. */
  durationSeconds: number;
  /** Ordered scene ids the track plays under. Empty list = whole video. */
  scenesCovered: string[];
  /** Loose tag for UI grouping. Doesn't affect playback. */
  role: MusicRole;
  /** Optional human label (e.g. "investigative bed"). Defaults to a prompt
   *  truncation when not supplied. */
  label?: string;
  /** Volume in dB. Default 0 (full). The producer's audio mixer reads
   *  data-volume-db to apply this at render time. */
  volumeDb?: number;
  /** Sidechain duck depth in dB applied during voiceover windows. -12 is the
   *  default for cinematic reels — voiceover stays clear without making the
   *  music feel cut. */
  duckDb?: number;
  /** ISO timestamp the entry was created. */
  createdAt: string;
}

export interface MusicManifest {
  version: number;
  entries: MusicEntry[];
}

export function emptyManifest(): MusicManifest {
  return { version: MUSIC_MANIFEST_VERSION, entries: [] };
}

export function readMusicManifest(projectDir: string): MusicManifest {
  const path = join(projectDir, MUSIC_DIR, MUSIC_MANIFEST);
  if (!existsSync(path)) return emptyManifest();
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as Partial<MusicManifest>;
    if (!raw || typeof raw !== "object") return emptyManifest();
    const entries = Array.isArray(raw.entries) ? raw.entries.filter(isValidEntry) : [];
    return { version: MUSIC_MANIFEST_VERSION, entries };
  } catch {
    return emptyManifest();
  }
}

export function writeMusicManifest(projectDir: string, manifest: MusicManifest): void {
  const path = join(projectDir, MUSIC_DIR, MUSIC_MANIFEST);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
}

export function appendMusicEntry(projectDir: string, entry: MusicEntry): MusicManifest {
  const manifest = readMusicManifest(projectDir);
  manifest.entries.push(entry);
  writeMusicManifest(projectDir, manifest);
  return manifest;
}

export function removeMusicEntry(projectDir: string, entryId: string): MusicManifest {
  const manifest = readMusicManifest(projectDir);
  manifest.entries = manifest.entries.filter((e) => e.id !== entryId);
  writeMusicManifest(projectDir, manifest);
  return manifest;
}

function isValidEntry(value: unknown): value is MusicEntry {
  if (!value || typeof value !== "object") return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    typeof e.prompt === "string" &&
    typeof e.path === "string" &&
    typeof e.durationSeconds === "number" &&
    Array.isArray(e.scenesCovered) &&
    e.scenesCovered.every((s: unknown) => typeof s === "string") &&
    typeof e.role === "string" &&
    typeof e.createdAt === "string"
  );
}

/**
 * Compute a music track's absolute start time + the duration the assembler
 * should declare on its `<audio data-duration>`. The track's *audio file*
 * may be longer than the scenes it covers — in that case the player clips
 * playback to the covered window.
 *
 * Returns:
 *   - start: absolute time on the master timeline where the track begins
 *   - declaredDuration: how long the assembler says the track should play.
 *     min(audio length, sum of covered scenes' durations).
 *
 * Pure helper — exported for tests so the math is exercised without disk.
 */
export interface SceneSpan {
  id: string;
  start: number;
  duration: number;
}

export function resolveMusicSpan(
  entry: Pick<MusicEntry, "scenesCovered" | "durationSeconds">,
  sceneSpans: SceneSpan[],
  totalDuration: number,
): { start: number; declaredDuration: number } {
  // Empty scenesCovered = play under the whole video.
  if (!entry.scenesCovered || entry.scenesCovered.length === 0) {
    return {
      start: 0,
      declaredDuration: Math.min(entry.durationSeconds, totalDuration),
    };
  }
  const indexById = new Map(sceneSpans.map((s) => [s.id, s]));
  const covered = entry.scenesCovered
    .map((id) => indexById.get(id))
    .filter((s): s is SceneSpan => s != null);
  if (covered.length === 0) {
    // None of the named scenes exist in the script (probably reordered or
    // deleted). Fall back to the whole video so the track still plays —
    // better than the user wondering why the music vanished.
    return {
      start: 0,
      declaredDuration: Math.min(entry.durationSeconds, totalDuration),
    };
  }
  const start = Math.min(...covered.map((s) => s.start));
  const end = Math.max(...covered.map((s) => s.start + s.duration));
  const coveredDuration = Math.max(0, end - start);
  return {
    start,
    declaredDuration: Math.min(entry.durationSeconds, coveredDuration),
  };
}
