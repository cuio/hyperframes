/**
 * A Template is what the planner picks per scene. It declares:
 *  - When the AI should choose it (`description`, `whenToUse`).
 *  - What props it accepts (`propsSchema` — JSON Schema fragment).
 *  - Constraints the planner must respect (`durationRange`, `hookOnly`).
 *  - How to render it deterministically (`render(props, ctx)`).
 *
 * Phase 3 ships a small functional set; Phase 4 polishes visuals and adds
 * design-token support. The template id is the contract — visuals can change,
 * the id stays stable so cached PlannedScripts keep working.
 */

export interface TemplateRenderContext {
  /** Scene id, e.g. "s01". Used for stable DOM ids. */
  sceneId: string;
  /** Path to the synthesized audio file, relative to the project root. */
  audioSrc?: string;
  /** Real measured duration of the audio (seconds). Falls back to durationHint. */
  durationSeconds: number;
  /** Hook scenes get more aggressive motion presets. */
  isHook: boolean;
  /** Project-wide design tokens (Phase 4 fills these out properly). */
  tokens: DesignTokens;
  /**
   * Resolved image entry for image-aware templates. Populated by the
   * assembler when scene.props.imageId references an entry in the
   * project's images manifest. Other templates ignore this.
   */
  image?: ImageRef;
}

/**
 * Subset of the full ImageEntry that templates need at render time. Kept
 * here (vs. importing from ../../images) so the templates module stays
 * decoupled from the manifest write path.
 */
export interface ImageRef {
  id: string;
  /** Path relative to the project root, e.g. "assets/images/cowboy.webp". */
  src: string;
  width: number;
  height: number;
  aspect: number;
  dominantColor: string;
  palette: string[];
  description: string;
  focalPoint: { x: number; y: number };
  /** "hero" | "subject" | "atmosphere" | "graphic" | null. */
  role: string | null;
}

export interface DesignTokens {
  colors: {
    /** Page background — usually deepest. */
    bg: string;
    /** Primary text. */
    fg: string;
    /** Card/surface background, slightly lighter than bg. */
    surface: string;
    /** Primary accent — headlines, gradients, key emphasis. */
    accent: string;
    /** Secondary accent — labels, dividers, highlights. */
    accent2: string;
    /** Tertiary accent — stats, callouts, energy. */
    accent3: string;
    /** Subtitle/secondary text. */
    muted: string;
    /** Faint dividers, footnotes. */
    subtle: string;
  };
  fonts: {
    /** Headlines and large display text. */
    display: string;
    /** Body copy and labels. */
    body: string;
    /** Numbers, code, monospaced data. */
    mono: string;
  };
  motion: {
    /** Default GSAP ease for entrances. */
    ease: string;
    /** Default entrance duration in ms. */
    enterMs: number;
    /** Stagger between sequential reveals. */
    staggerMs: number;
  };
}

export interface Template {
  id: string;
  /** One-sentence description shown to the planner. */
  description: string;
  /** Bullet list of "use when …" cues for the planner's prompt. */
  whenToUse: string[];
  /** JSON-schema-style props object (used in the tool input_schema). */
  propsSchema: Record<string, unknown>;
  /** Soft duration window the planner should aim for. */
  durationRange: { min: number; max: number };
  /** True if this template is intended for hook scenes only. */
  hookOnly?: boolean;
  /** Render to an HTML string for the scene's standalone composition file. */
  render(props: Record<string, unknown>, ctx: TemplateRenderContext): string;
}
