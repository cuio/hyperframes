import type { DesignTokens } from "../templates/types.js";

export interface AtmosphereContext {
  /** Scene id, used to scope CSS selectors and @keyframes names. */
  sceneId: string;
  tokens: DesignTokens;
  /** Hook scenes get more dramatic intensity in some presets. */
  isHook?: boolean;
}

export interface AtmospherePreset {
  id: string;
  description: string;
  /**
   * Render the atmosphere layer for one scene. The returned HTML is injected
   * as the FIRST child of the scene's root <div>. Each preset positions
   * itself absolutely with z-index: 0 so it paints above the scene's solid
   * background color but below static content children (text, charts).
   *
   * Presets are pure CSS — no GSAP — so they don't fight scene timelines or
   * eat the runtime budget. @keyframes names are scoped per-scene to avoid
   * cross-scene collisions when multiple scenes share a preset.
   */
  render(ctx: AtmosphereContext): string;
}
