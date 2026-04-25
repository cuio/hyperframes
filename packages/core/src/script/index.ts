export type {
  Script,
  ScriptMeta,
  SceneRef,
  SceneTransition,
  PlannedScene,
  PlannedScript,
} from "./types.js";
export { planScript, planSceneVariants, ScriptPlannerError } from "./planner.js";
export type { PlanOptions, VariantOptions } from "./planner.js";
export {
  loadDesignArt,
  loadResearch,
  loadScriptMd,
  DESIGN_ART_TEMPLATE,
  RESEARCH_TEMPLATE,
} from "./projectFiles.js";
export { synthesizeScript } from "./audio.js";
export type { SynthesizeScriptOptions } from "./audio.js";
export { assembleMaster } from "./assemble.js";
export type { AssembleOptions, AssembleResult } from "./assemble.js";
export { BUILTIN_TEMPLATES, getTemplate, DEFAULT_TOKENS } from "./templates/index.js";
export type { Template, TemplateRenderContext, DesignTokens } from "./templates/index.js";
export { RETENTION_PLAYBOOK } from "./playbook.js";
export { loadDesignBrief } from "./designBrief.js";
export { parseDesignBriefToTokens, resolveProjectTokens } from "./designTokens.js";
export { THEMES, DEFAULT_THEME, getThemeByName, HACKERNOON_FT, DATA_DRIFT_DARK } from "./themes.js";
export { BUILTIN_CHARTS, getChart } from "./charts/index.js";
export type { ChartDef, ChartContext } from "./charts/index.js";
