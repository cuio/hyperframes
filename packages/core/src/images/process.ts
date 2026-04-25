import sharp from "sharp";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Maximum long-edge size in pixels. The upstream Common Mistakes guide
 * warns about oversized images forcing the compositor to decode huge
 * RGBA bitmaps every frame. 3840 (4K-equivalent) is plenty for any
 * 1920×1080 composition while keeping image bytes manageable.
 */
export const DEFAULT_MAX_LONG_EDGE = 3840;

export interface ProcessedImage {
  width: number;
  height: number;
  bytes: number;
  format: "webp";
  dominantColor: string;
  palette: string[];
}

export interface ProcessOptions {
  /** Override max long-edge size in pixels. Default: 3840. */
  maxLongEdge?: number;
  /** WebP quality 1-100. Default: 85 — visually lossless for our usage. */
  quality?: number;
  /** When true, strip EXIF + ICC. Default: true. Privacy-safe by default. */
  stripMetadata?: boolean;
}

/**
 * Resize an arbitrary input image (JPG / PNG / HEIC / WebP / etc.) into
 * a normalized webp at maxLongEdge, write it to outPath, and return
 * structural metadata + a sampled palette.
 */
export async function processImage(
  inputPath: string,
  outPath: string,
  options: ProcessOptions = {},
): Promise<ProcessedImage> {
  const maxEdge = options.maxLongEdge ?? DEFAULT_MAX_LONG_EDGE;
  const quality = options.quality ?? 85;
  const stripMetadata = options.stripMetadata ?? true;

  if (!existsSync(inputPath)) {
    throw new Error(`Source image does not exist: ${inputPath}`);
  }
  mkdirSync(dirname(outPath), { recursive: true });

  let pipeline = sharp(inputPath, { failOn: "truncated" }).rotate();
  if (stripMetadata) {
    // sharp() defaults to dropping metadata, but be explicit.
    pipeline = pipeline.withMetadata({});
  }

  const meta = await pipeline.clone().metadata();
  const longEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
  if (longEdge > maxEdge) {
    pipeline = pipeline.resize({
      width: maxEdge,
      height: maxEdge,
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  await pipeline.webp({ quality, effort: 4 }).toFile(outPath);

  const outMeta = await sharp(outPath).metadata();
  const dominantColor = await sampleDominantColor(outPath);
  const palette = await samplePalette(outPath, 4);
  const bytes = statSync(outPath).size;

  return {
    width: outMeta.width ?? 0,
    height: outMeta.height ?? 0,
    bytes,
    format: "webp",
    dominantColor,
    palette,
  };
}

/**
 * Sample the dominant color by downscaling the image to a single pixel.
 * The single-pixel resize averages all input pixels — a fast, bias-free
 * estimate of the overall color of the image.
 */
async function sampleDominantColor(path: string): Promise<string> {
  const { data, info } = await sharp(path)
    .resize(1, 1, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  const r = data[0] ?? 0;
  const g = (channels >= 2 ? data[1] : data[0]) ?? 0;
  const b = (channels >= 3 ? data[2] : data[0]) ?? 0;
  return rgbToHex(r, g, b);
}

/**
 * Sample a palette by downscaling to an N×1 strip and reading each
 * cell. A cheap-and-cheerful alternative to full k-means clustering;
 * for the visual director's needs (theme accent matching) it's plenty.
 */
async function samplePalette(path: string, count: number): Promise<string[]> {
  const { data, info } = await sharp(path)
    .resize(count, 1, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const offset = i * channels;
    const r = data[offset] ?? 0;
    const g = (channels >= 2 ? data[offset + 1] : data[offset]) ?? 0;
    const b = (channels >= 3 ? data[offset + 2] : data[offset]) ?? 0;
    out.push(rgbToHex(r, g, b));
  }
  return out;
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(Math.round(r))}${toHex(Math.round(g))}${toHex(Math.round(b))}`;
}
