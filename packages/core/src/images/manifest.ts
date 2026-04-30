import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFileSync } from "../internal/atomicWrite.js";

/**
 * Image roles classify how an image is used by the visual director.
 *
 *   hero        — Single dominant subject. Used for full-bleed scenes,
 *                 hooks, climax moments. The cowboy-against-sky type shot.
 *   subject     — Detail or supporting shot. Reused via crops, callouts,
 *                 picture-in-picture. The GPU rack illustration type.
 *   atmosphere  — Pure mood. Gradient, blur, particle field. Lives BEHIND
 *                 content as section underlay; never the focal element.
 *   graphic     — Abstract / iconographic / non-photographic. Logos,
 *                 motion-graphic stills. Used as accent or transition wipe.
 */
export type ImageRole = "hero" | "subject" | "atmosphere" | "graphic";

/**
 * Status of the optional Gemini-driven analysis pipeline.
 *
 *   pending   — Analyzer kicked off (fire-and-forget) and has not yet
 *               written back. Studio shows a small spinner on the card.
 *   complete  — Analyzer wrote vibe / suggestedTreatment / retentionStrength.
 *               Visual director may consume those as soft priors.
 *   failed    — API key missing, network error, or model declined.
 *               `analysisError` carries the human-readable reason.
 *   undefined — Analysis was never attempted (e.g. uploaded before the
 *               feature shipped, or no GEMINI_API_KEY at upload time).
 */
export type ImageAnalysisStatus = "pending" | "complete" | "failed";

export interface ImageFocal {
  /** Normalized x coordinate of the focal point, 0..1 (left to right). */
  x: number;
  /** Normalized y coordinate of the focal point, 0..1 (top to bottom). */
  y: number;
}

export interface ImageEntry {
  /** Stable id — kebab-case slug derived from the original filename. */
  id: string;
  /** Path relative to <project>/assets/, e.g. `images/cowboy-1.webp`. */
  src: string;
  /** Stored format — always webp post-import. */
  format: "webp" | "png" | "jpg";
  width: number;
  height: number;
  /** width / height. */
  aspect: number;
  bytes: number;
  /** Dominant color as #rrggbb, sampled by averaging all pixels. */
  dominantColor: string;
  /** Optional palette of 3-5 dominant colors for treatments that need accents. */
  palette: string[];
  /** User-assigned. null until explicitly set. */
  role: ImageRole | null;
  /** User-typed prose description. The visual director reads this when planning. */
  description: string;
  /** Free-form tags. The director uses tags as soft cues for matching scenes. */
  tags: string[];
  /** Where the focal subject is. Default { x: 0.5, y: 0.5 } if not picked. */
  focalPoint: ImageFocal;
  /** ISO timestamp of import. */
  importedAt: string;

  // ── Optional Gemini analyzer fields ──────────────────────────────────────
  // Filled in by `packages/core/src/images/analyzer.ts` post-upload. Soft
  // priors only — the user's role/description always take precedence and
  // these are best-effort. Absent on entries created before the analyzer
  // feature shipped.

  /** Mood phrase ≤60 chars, e.g. "gritty desert noir". */
  vibe?: string;
  /**
   * Treatment id from packages/core/src/script/templates/image-scene.ts
   * the analyzer thinks this image works best with. Visual director reads
   * this as a soft prior; user / script context can still override.
   */
  suggestedTreatment?: string | null;
  /**
   * 1-10 retention-strength estimate as a hook visual. 9-10 = striking,
   * instantly readable subject; 5-6 = decent supporting shot; 1-3 =
   * busy / low-contrast / weak focal point. Soft signal only.
   */
  retentionStrengthAtAttachment?: number;
  /** Lifecycle of the optional Gemini analysis run. See ImageAnalysisStatus. */
  analysisStatus?: ImageAnalysisStatus;
  /** Human-readable failure reason when analysisStatus === "failed". */
  analysisError?: string;
  /** ISO timestamp of last successful analysis. */
  analyzedAt?: string;
  /** One-line analyst rationale shown in the studio image card on hover. */
  analysisRationale?: string;
}

export interface ImageManifest {
  version: 1;
  images: ImageEntry[];
}

const MANIFEST_REL_PATH = "assets/images.json";

export function manifestPath(projectDir: string): string {
  return join(projectDir, MANIFEST_REL_PATH);
}

export function emptyManifest(): ImageManifest {
  return { version: 1, images: [] };
}

/**
 * Parse a manifest from disk. Returns an empty manifest when the file
 * doesn't exist or is malformed — never throws so callers can use a
 * single read-then-write pattern even on first import.
 */
export function readManifest(projectDir: string): ImageManifest {
  const path = manifestPath(projectDir);
  if (!existsSync(path)) return emptyManifest();
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as Partial<ImageManifest>;
    if (raw.version !== 1 || !Array.isArray(raw.images)) {
      console.warn(`[images] manifest at ${path} has unexpected shape, ignoring`);
      return emptyManifest();
    }
    // Defensive copy — drop entries that lack required fields rather than
    // letting them break downstream consumers.
    const images = raw.images.filter(isValidEntry);
    return { version: 1, images };
  } catch (err) {
    console.warn(`[images] manifest at ${path} is not valid JSON; starting fresh`, err);
    return emptyManifest();
  }
}

export function writeManifest(projectDir: string, manifest: ImageManifest): void {
  atomicWriteFileSync(manifestPath(projectDir), JSON.stringify(manifest, null, 2) + "\n");
}

function isValidEntry(value: unknown): value is ImageEntry {
  if (!value || typeof value !== "object") return false;
  const e = value as Partial<ImageEntry>;
  return (
    typeof e.id === "string" &&
    typeof e.src === "string" &&
    typeof e.width === "number" &&
    typeof e.height === "number" &&
    typeof e.dominantColor === "string"
  );
}

/**
 * Generate a stable, conflict-free id for a new image. Slugifies the
 * source basename and appends `-2`, `-3`, … if a collision exists.
 */
export function pickId(manifest: ImageManifest, sourceFilename: string): string {
  const base = sourceFilename
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const fallback = base.length > 0 ? base : "image";
  const taken = new Set(manifest.images.map((i) => i.id));
  if (!taken.has(fallback)) return fallback;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${fallback}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  // 1000 collisions on the same basename is absurd; fall through to a hash.
  return `${fallback}-${Date.now().toString(36)}`;
}

export function findById(manifest: ImageManifest, id: string): ImageEntry | null {
  return manifest.images.find((i) => i.id === id) ?? null;
}

export function upsertEntry(manifest: ImageManifest, entry: ImageEntry): ImageManifest {
  const idx = manifest.images.findIndex((i) => i.id === entry.id);
  const next = manifest.images.slice();
  if (idx === -1) next.push(entry);
  else next[idx] = entry;
  return { ...manifest, images: next };
}

export function removeEntry(manifest: ImageManifest, id: string): ImageManifest {
  return { ...manifest, images: manifest.images.filter((i) => i.id !== id) };
}

export const MANIFEST_PATH = MANIFEST_REL_PATH;
