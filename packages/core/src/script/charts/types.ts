import type { DesignTokens } from "../templates/types.js";

export interface ChartContext {
  /** Stable id used to namespace SVG ids inside the chart fragment. */
  chartId: string;
  /** Width of the chart canvas in px. */
  width: number;
  /** Height of the chart canvas in px. */
  height: number;
  /** Project design tokens. */
  tokens: DesignTokens;
}

export interface ChartDef {
  id: string;
  /** One-sentence description shown to the AI planner. */
  description: string;
  /** Bullet list of "use when …" cues for the planner. */
  whenToUse: string[];
  /** JSON-Schema-style props object. */
  propsSchema: Record<string, unknown>;
  /** Render an inline SVG fragment with classes namespaced by chartId. */
  render(props: Record<string, unknown>, ctx: ChartContext): string;
}
