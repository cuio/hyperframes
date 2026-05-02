export {
  FREEFORM_TEMPLATE,
  resolveFreeformScenes,
  hashFreeformKey,
  type ResolveFreeformScenesOptions,
  type ResolveFreeformScenesResult,
  type ResolveSceneShape,
} from "./freeform.js";
export {
  generateFreeformScene,
  FREEFORM_GENERATOR_VERSION,
  type GenerateFreeformResult,
  type ValidationFailure,
} from "./generator.js";
export { validateFreeformHtml, VALIDATOR_RULES } from "./validator.js";
export { readFreeformCache, writeFreeformCache, clearFreeformCache } from "./cache.js";
export type {
  FreeformCacheKey,
  FreeformGeneration,
  ValidationResult,
  GenerateFreeformSceneOptions,
} from "./types.js";
