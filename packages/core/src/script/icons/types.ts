export interface IconRenderOptions {
  /** Pixel size for the rendered SVG (sets width and height). Default 24. */
  size?: number;
  /** SVG stroke colour. Defaults to currentColor so it inherits CSS color. */
  color?: string;
  /** Stroke width in SVG userspace units. Default 2. */
  strokeWidth?: number;
}
