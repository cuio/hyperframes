import { basename, join } from "node:path";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import {
  emptyManifest,
  pickId,
  readManifest,
  upsertEntry,
  writeManifest,
  type ImageEntry,
  type ImageManifest,
} from "./manifest.js";
import { processImage, type ProcessOptions } from "./process.js";

export interface IngestOptions extends ProcessOptions {
  /**
   * Project root. The manifest is read from / written to
   * <projectDir>/assets/images.json and the processed file goes under
   * <projectDir>/assets/images/<id>.webp.
   */
  projectDir: string;
  /**
   * Optional id override. By default we slugify the source basename
   * and append a numeric suffix on collision.
   */
  forceId?: string;
}

export interface IngestResult {
  entry: ImageEntry;
  manifest: ImageManifest;
  /** True when an existing entry with the same id was overwritten. */
  replaced: boolean;
}

const IMAGES_DIR = join("assets", "images");

/**
 * Process a source image and add (or replace) it in the project's
 * manifest. Pure: doesn't talk to any external service. The caller is
 * the studio drop-zone or the `hyperframes images add` CLI.
 *
 * Resulting entry has role / description / focalPoint / tags as their
 * default unset values — the user fills those in via the Studio side
 * panel or `hyperframes images edit`.
 */
export async function ingestImage(
  sourcePath: string,
  options: IngestOptions,
): Promise<IngestResult> {
  if (!existsSync(sourcePath)) {
    throw new Error(`Cannot ingest — source does not exist: ${sourcePath}`);
  }

  const manifest = readManifest(options.projectDir);
  const id = options.forceId ?? pickId(manifest, basename(sourcePath));
  const relativeOut = join(IMAGES_DIR, `${id}.webp`);
  const absoluteOut = join(options.projectDir, relativeOut);

  mkdirSync(join(options.projectDir, IMAGES_DIR), { recursive: true });
  const processed = await processImage(sourcePath, absoluteOut, options);

  const entry: ImageEntry = {
    id,
    src: relativeOut.split("\\").join("/"),
    format: processed.format,
    width: processed.width,
    height: processed.height,
    aspect: processed.height > 0 ? processed.width / processed.height : 0,
    bytes: processed.bytes,
    dominantColor: processed.dominantColor,
    palette: processed.palette,
    role: null,
    description: "",
    tags: [],
    focalPoint: { x: 0.5, y: 0.5 },
    importedAt: new Date().toISOString(),
  };

  const replaced = manifest.images.some((i) => i.id === id);
  const next = upsertEntry(manifest, entry);
  writeManifest(options.projectDir, next);
  return { entry, manifest: next, replaced };
}

/**
 * Convenience for tests / CLI bulk import. Sequential — sharp is fast
 * enough that parallelism is rarely worth the added file-handle pressure.
 */
export async function ingestImages(
  sourcePaths: string[],
  options: IngestOptions,
): Promise<IngestResult[]> {
  const results: IngestResult[] = [];
  for (const path of sourcePaths) {
    results.push(await ingestImage(path, options));
  }
  return results;
}

/**
 * Initialise an empty manifest if none exists. Useful for the first
 * Studio drop-zone interaction so subsequent reads see version: 1.
 */
export function ensureManifest(projectDir: string): ImageManifest {
  const manifest = readManifest(projectDir);
  if (manifest.images.length === 0) writeManifest(projectDir, emptyManifest());
  return manifest;
}

/**
 * Copy a raw source file into the project's images dir without re-encoding.
 * Used by tests that pre-place fixtures and want the manifest to match.
 */
export function adoptRawFile(sourcePath: string, projectDir: string, id: string): string {
  const out = join(projectDir, IMAGES_DIR, `${id}.webp`);
  mkdirSync(join(projectDir, IMAGES_DIR), { recursive: true });
  copyFileSync(sourcePath, out);
  return out;
}
