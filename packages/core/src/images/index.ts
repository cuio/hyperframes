export {
  emptyManifest,
  readManifest,
  writeManifest,
  manifestPath,
  pickId,
  findById,
  upsertEntry,
  removeEntry,
  MANIFEST_PATH,
} from "./manifest.js";
export type {
  ImageEntry,
  ImageFocal,
  ImageManifest,
  ImageRole,
  ImageAnalysisStatus,
} from "./manifest.js";

export { processImage, DEFAULT_MAX_LONG_EDGE } from "./process.js";
export type { ProcessedImage, ProcessOptions } from "./process.js";

export { ingestImage, ingestImages, ensureManifest } from "./ingest.js";
export type { IngestOptions, IngestResult } from "./ingest.js";

export { analyzeImage, normalizeAnalysis, defaultTreatmentForRole } from "./analyzer.js";
export type { AnalyzedImage, AnalyzeImageResult } from "./analyzer.js";
