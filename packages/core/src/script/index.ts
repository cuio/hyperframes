export type {
  Script,
  ScriptMeta,
  SceneRef,
  SceneTransition,
  PlannedScene,
  PlannedScript,
} from "./types.js";
export { planScript, planSceneVariants, improveHook, ScriptPlannerError } from "./planner.js";
export type { PlanOptions, VariantOptions, ScriptFidelity, HookCriticOptions } from "./planner.js";
export {
  BUILTIN_ATMOSPHERES,
  ATMOSPHERE_IDS,
  getAtmosphere,
  defaultAtmosphereForTemplate,
  renderAtmosphere,
  compose,
  BUILTIN_COMPOSITIONS,
  resolveAtmosphereOrComposition,
  listAllAtmosphereIds,
} from "./atmosphere/index.js";
export type {
  AtmospherePreset,
  AtmosphereContext,
  AtmosphereComposition,
} from "./atmosphere/index.js";
export {
  extractReferenceProfile,
  normalizeProfile,
  validateReferenceInputs,
  readPersistedProfile,
  REFERENCE_PROFILE_REL_PATH,
} from "./referenceProfile.js";
export type {
  ReferenceProfile,
  ExtractReferenceOptions,
  ExtractReferenceResult,
} from "./referenceProfile.js";
export { validatePatches, applyPatches, isImprovement, nextSceneId } from "./optimizerPatches.js";
export type {
  EditPatch,
  EditPatchAction,
  EditTextPatch,
  SwapTemplatePatch,
  AddPropPatch,
  SplitScenePatch,
  FixBordersPatch,
  ValidatePatchesOptions,
  ValidatedPatchSet,
  ApplyPatchesResult,
} from "./optimizerPatches.js";
export { proposeOptimizationPatches } from "./optimizerProposer.js";
export type {
  ProposeOptimizationPatchesOptions,
  ProposedOptimizations,
} from "./optimizerProposer.js";
export { optimizeRetention } from "./optimizer.js";
export type {
  OptimizeRetentionOptions,
  OptimizeRetentionResult,
  IterationReport,
  RenderReviewSummary,
} from "./optimizer.js";
export {
  TRANSITION_DURATIONS,
  TRANSITION_IDS,
  defaultTransitionForTemplate,
} from "./transitions/index.js";
export { BUILTIN_ICONS, ICON_IDS, renderIcon, hasIcon } from "./icons/index.js";
export type { IconRenderOptions } from "./icons/index.js";
export {
  loadDesignArt,
  loadResearch,
  loadScriptMd,
  DESIGN_ART_TEMPLATE,
  RESEARCH_TEMPLATE,
} from "./projectFiles.js";
export { synthesizeScript } from "./audio.js";
export type { SynthesizeScriptOptions } from "./audio.js";
export { planVisualDirection, VisualDirectorError } from "./visualDirector.js";
export type {
  VisualDirectorOptions,
  VisualDirectionEntry,
  VisualDirectionPlan,
} from "./visualDirector.js";
export { assembleMaster, ASSEMBLED_AT_META, CORE_VERSION_META } from "./assemble.js";
export type { AssembleOptions, AssembleResult } from "./assemble.js";
export { computeAssemblyStatus, readStamp, extractMetaContent } from "./assembleStaleness.js";
export type { AssemblyStatus, AssemblyStatusOptions, StaleReason } from "./assembleStaleness.js";
export { getCoreVersion } from "./coreVersion.js";
export { BUILTIN_TEMPLATES, getTemplate, DEFAULT_TOKENS } from "./templates/index.js";
export type { Template, TemplateRenderContext, DesignTokens } from "./templates/index.js";
export { RETENTION_PLAYBOOK } from "./playbook.js";
export { loadDesignBrief } from "./designBrief.js";
export {
  parseDesignBriefToTokens,
  resolveProjectTokens,
  resolveActiveTheme,
  resolveTemplateRegistry,
  listAvailableThemes,
} from "./designTokens.js";
export {
  loadThemeRegistry,
  getLoadedThemeByName,
  getDefaultLoadedTheme,
  discoverThemeRoots,
  loadThemesFromRoot,
  type LoadedTheme,
  type ThemeManifest,
  type ThemeSearchRoots,
} from "./themes/index.js";
export {
  THEMES,
  DEFAULT_THEME,
  getThemeByName,
  HACKERNOON_FT,
  DATA_DRIFT_DARK,
  DREAMSPACE,
  CYBERLOFI,
} from "./themes.js";
export { BUILTIN_CHARTS, getChart } from "./charts/index.js";
export type { ChartDef, ChartContext } from "./charts/index.js";
