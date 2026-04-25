import type { DesignTokens } from "../templates/types.js";

/**
 * On-disk theme manifest. Drop a folder under docs/design-systems/<id>/
 * (or <project>/themes/<id>/) with a theme.json that matches this shape
 * and the framework picks it up at startup. No code edits required.
 *
 * The minimum is { id, tokens } — everything else is optional and lets
 * the theme carry richer DNA so the planner makes smarter picks.
 */
export interface ThemeManifest {
  /** Stable id used by hyperframes.json `design.theme` and the studio picker. */
  id: string;
  /** Human-readable name shown in the studio. */
  name?: string;
  /** One-line description shown in the studio picker tooltip. */
  description?: string;
  /** The full design-token palette + fonts + motion. Required. */
  tokens: DesignTokens;
  /**
   * Extra Google Font families to inject into the assembler's <head>. Each
   * entry is the family slug Google Fonts expects, e.g.
   * "Space Grotesk:wght@300;400;500;600;700".
   */
  fonts?: { googleFonts?: string[] };
  /**
   * Hints to the planner about which atmospheres / transitions / icons fit
   * this theme best. The planner is allowed to override but bias toward
   * these.
   */
  preferences?: {
    atmospheres?: string[];
    transitions?: string[];
    icons?: string[];
  };
  /**
   * Path relative to the theme folder pointing at a markdown design-system
   * document (e.g. "DESIGN_SYSTEM.md"). When set, the loader reads its
   * contents and the planner appends them to its system prompt as
   * theme-specific DNA. This is what makes themes carry full design
   * intent, not just colors.
   */
  designSystemDoc?: string;
  /**
   * Path relative to the theme folder pointing at a canonical reference
   * render. Studio links to this so the user can scrub through what
   * "production quality" looks like for the theme.
   */
  referenceRender?: string;
}

/**
 * A theme as the runtime sees it after the loader has flattened the
 * manifest + read its referenced files into memory.
 */
export interface LoadedTheme {
  id: string;
  name: string;
  description: string;
  tokens: DesignTokens;
  fonts: { googleFonts: string[] };
  preferences: {
    atmospheres: string[];
    transitions: string[];
    icons: string[];
  };
  /** Inlined contents of designSystemDoc, if present. */
  designSystemDoc: string | null;
  /** Absolute path to the reference render file, if present. */
  referenceRenderPath: string | null;
  /**
   * Where the theme came from: "builtin" for the TypeScript constants,
   * "disk:<absolute-folder>" for a discovered manifest. Used for
   * diagnostics and the "show on disk" affordance in the studio.
   */
  source: string;
}
