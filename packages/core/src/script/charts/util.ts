/**
 * Shared chart helpers — the editorial dataviz toolkit.
 *
 * The HackerNoon / FT / Bloomberg editorial chart language has a small set
 * of repeating moves: a y-axis with rounded "nice" tick values, subtle
 * horizontal gridlines (no vertical y-axis line), value labels above every
 * data point, and the signature **annotation pill** — a beige rounded
 * rectangle with a curved leader arrow that points at the focal datum and
 * tells the reader what the chart MEANS, not just what it shows.
 *
 * These helpers are pulled out of the individual chart implementations so
 * every editorial-pack chart speaks the same visual dialect. The chart
 * itself owns scale + layout; this module owns the chrome.
 *
 * All functions are pure and return either an SVG fragment string (no
 * outer <svg>; the chart's root `<svg>` already exists) or a plain JS
 * value (tick array, formatted string). No DOM, no I/O.
 *
 * Class naming:  `hf-` prefix matches the rest of the chart catalog so
 * the `chart-scene` template's GSAP timeline can pick up new elements
 * without per-chart wiring. New animatable classes added here:
 *   - `hf-pill`         pill body fades in
 *   - `hf-pill-leader`  curved arrow draws via stroke-dashoffset
 *   - `hf-grid-line`    gridlines fade in (subtle, fast)
 *   - `hf-axis-label`   y-axis tick labels fade in
 */

import type { DesignTokens } from "../templates/types.js";
import { escapeHtml } from "../templates/util.js";

// ── Number helpers ──────────────────────────────────────────────────────────

/**
 * Round v UP to a "nice" round number. Used for the top of a y-axis so the
 * chart axis labels read like a real chart (50, 100, 1500) instead of
 * matching the raw data ceiling (49.6, 73, 1247).
 *
 *   niceCeiling(47)    → 50
 *   niceCeiling(283)   → 500       (snaps within {1, 2, 5, 10})
 *   niceCeiling(1234)  → 2000
 *   niceCeiling(0.84)  → 1
 *   niceCeiling(50)    → 50        (already nice; never bumps a value that's
 *                                   already on a 1/2/5 boundary)
 */
export function niceCeiling(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const m = v / base;
  // Use a fine snap set so 28.3 → 30 rather than 28.3 → 50.
  const stepped = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 3 ? 3 : m <= 5 ? 5 : 10;
  return stepped * base;
}

/**
 * Generate `count` evenly spaced tick values from 0 to niceCeiling(max).
 * Default count is 5 (0, 25%, 50%, 75%, 100% of the ceiling) which is the
 * editorial default — five gridlines is enough texture without becoming
 * graph paper.
 */
export function niceTicks(max: number, count = 5): number[] {
  const ceil = niceCeiling(max);
  const ticks: number[] = [];
  for (let i = 0; i < count; i++) {
    ticks.push((ceil * i) / (count - 1));
  }
  return ticks;
}

/** Number-format options for axis labels and value tags. */
export type ValueFormat =
  | "number" // 1,234
  | "percent" // 49.6%
  | "compact-money" // $1.4T / $325B / $42M
  | "compact-count" // 1.4T / 325B / 50M+
  | "currency"; // $1,234,567 (full precision)

/**
 * Format `v` for display in an editorial chart. The "compact" variants are
 * the ones used in the FT-style references — big magnitudes get suffix
 * letters, small magnitudes keep one decimal so the difference is legible.
 */
export function formatValue(v: number, fmt: ValueFormat = "number"): string {
  if (!Number.isFinite(v)) return String(v);
  if (fmt === "percent") {
    // 49.6% — one decimal when sub-100, integer otherwise.
    const abs = Math.abs(v);
    return abs >= 100 || abs === Math.round(abs) ? `${Math.round(v)}%` : `${v.toFixed(1)}%`;
  }
  if (fmt === "currency") {
    // Full-precision currency with thousands separators.
    return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }
  if (fmt === "compact-money" || fmt === "compact-count") {
    const sign = v < 0 ? "-" : "";
    const abs = Math.abs(v);
    const prefix = fmt === "compact-money" ? "$" : "";
    if (abs >= 1e12) return `${sign}${prefix}${trimZero(abs / 1e12)}T`;
    if (abs >= 1e9) return `${sign}${prefix}${trimZero(abs / 1e9)}B`;
    if (abs >= 1e6) return `${sign}${prefix}${trimZero(abs / 1e6)}M`;
    if (abs >= 1e3) return `${sign}${prefix}${trimZero(abs / 1e3)}K`;
    return `${sign}${prefix}${trimZero(abs)}`;
  }
  return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function trimZero(n: number): string {
  // Show one decimal if the number isn't already a clean integer (1.4T not 1.0T)
  // but trim "1.0" → "1".
  const fixed = n.toFixed(1);
  return fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed;
}

// ── Gridlines + axis ────────────────────────────────────────────────────────

export interface GridlinesOptions {
  /** Tick values to label (one per gridline). Use `niceTicks(max)`. */
  ticks: number[];
  /** Top-of-scale value (must equal max(ticks)). */
  yMax: number;
  /** X-coord where the chart canvas starts. Gridlines run from here to chartRight. */
  chartLeft: number;
  /** X-coord where the chart canvas ends. */
  chartRight: number;
  /** Y-coord at the TOP of the chart (corresponds to yMax). */
  axisTopY: number;
  /** Y-coord at the BOTTOM of the chart (corresponds to 0). */
  axisBottomY: number;
  /** Tokens for color + font lookup. */
  tokens: DesignTokens;
  /** Format to use for tick labels. */
  format?: ValueFormat;
  /** X-coord where tick labels render (right-aligned). Defaults to chartLeft - 16. */
  labelX?: number;
}

/**
 * Render subtle horizontal gridlines + right-aligned y-axis tick labels.
 * Outputs SVG fragment WITHOUT a vertical y-axis line — that's the editorial
 * look. The bottom-most line is rendered at slightly higher contrast so the
 * baseline reads as the "x-axis."
 */
export function renderGridlines(opts: GridlinesOptions): string {
  const {
    ticks,
    yMax,
    chartLeft,
    chartRight,
    axisTopY,
    axisBottomY,
    tokens,
    format = "number",
    labelX = chartLeft - 16,
  } = opts;
  const range = axisBottomY - axisTopY;
  const lines: string[] = [];
  ticks.forEach((tick, i) => {
    const frac = yMax > 0 ? tick / yMax : 0;
    const y = axisBottomY - frac * range;
    const isBaseline = i === 0;
    const stroke = isBaseline ? tokens.colors.fg : tokens.colors.subtle;
    const opacity = isBaseline ? 0.5 : 0.35;
    const strokeWidth = isBaseline ? 1.5 : 1;
    lines.push(
      `<line class="hf-grid-line" x1="${chartLeft.toFixed(1)}" y1="${y.toFixed(1)}" x2="${chartRight.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="0" data-target-opacity="${opacity}" />`,
      `<text class="hf-axis-label" x="${labelX.toFixed(1)}" y="${(y + 6).toFixed(1)}" text-anchor="end" font-size="20" fill="${tokens.colors.muted}" opacity="0">${escapeHtml(formatValue(tick, format))}</text>`,
    );
  });
  return lines.join("\n  ");
}

// ── Annotation pill ─────────────────────────────────────────────────────────

export interface AnnotationOptions {
  /** Multi-line annotation text. Newlines are preserved. */
  text: string;
  /** Anchor point in chart coordinates — the leader arrow points HERE. */
  anchor: { x: number; y: number };
  /** Where the pill sits relative to the anchor. */
  position: "above" | "below" | "left" | "right";
  /** Distance from the anchor to the pill's near edge. Default 80. */
  offset?: number;
  /** Pill width in px. Default 220. */
  width?: number;
  /** Tokens for color lookup. */
  tokens: DesignTokens;
  /** Class id stem (without leading dot) — multiple pills get unique ids. */
  classId?: string;
  /** Force a specific font size. Default 18. */
  fontSize?: number;
  /** Show the curved leader arrow. Default true. */
  showLeader?: boolean;
}

/**
 * Render an editorial annotation pill — a beige rounded rectangle with
 * multi-line text and a curved leader arrow pointing at `anchor`. This is
 * the signature s-tier visual element from the FT references.
 *
 * The pill itself is a `<rect>` + `<text>` group. The leader is a
 * quadratic bezier `<path>` from the pill's near edge to slightly before
 * the anchor (so the arrow head doesn't overlap the data point).
 *
 * Position semantics:
 *   - "above": pill sits above the anchor, arrow curves DOWN to anchor
 *   - "below": pill sits below the anchor, arrow curves UP to anchor
 *   - "left":  pill sits left of the anchor, arrow curves RIGHT to anchor
 *   - "right": pill sits right of the anchor, arrow curves LEFT to anchor
 *
 * Animation: the chart-scene template's timeline reveals .hf-pill via
 * opacity tween, .hf-pill-leader via stroke-dashoffset tween — the arrow
 * draws in last so the eye reaches the data first, then the explanation.
 */
export function renderAnnotation(opts: AnnotationOptions): string {
  const {
    text,
    anchor,
    position,
    offset = 80,
    width = 220,
    tokens,
    classId = "ann",
    fontSize = 18,
    showLeader = true,
  } = opts;
  // Lay text into lines (max ~28 chars per line for the default width).
  const lines = wrapText(text, Math.max(18, Math.round(width / (fontSize * 0.45))));
  const lineHeight = fontSize * 1.34;
  const padY = 14;
  const height = padY * 2 + lines.length * lineHeight - lineHeight * 0.25;
  // Pill near-edge midpoint (the side facing the anchor) in chart coords.
  let pillX: number;
  let pillY: number;
  let arrowFromX: number;
  let arrowFromY: number;
  switch (position) {
    case "above":
      pillX = anchor.x - width / 2;
      pillY = anchor.y - offset - height;
      arrowFromX = anchor.x;
      arrowFromY = pillY + height;
      break;
    case "below":
      pillX = anchor.x - width / 2;
      pillY = anchor.y + offset;
      arrowFromX = anchor.x;
      arrowFromY = pillY;
      break;
    case "left":
      pillX = anchor.x - offset - width;
      pillY = anchor.y - height / 2;
      arrowFromX = pillX + width;
      arrowFromY = anchor.y;
      break;
    case "right":
    default:
      pillX = anchor.x + offset;
      pillY = anchor.y - height / 2;
      arrowFromX = pillX;
      arrowFromY = anchor.y;
      break;
  }
  // Arrow target — pull back ~14px from the anchor so the arrowhead doesn't
  // cover the data point.
  const dx = anchor.x - arrowFromX;
  const dy = anchor.y - arrowFromY;
  const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  const pullback = Math.min(14, dist * 0.25);
  const arrowToX = anchor.x - (dx / dist) * pullback;
  const arrowToY = anchor.y - (dy / dist) * pullback;
  // Quadratic bezier control point: perpendicular offset from the midpoint
  // for a gentle bow. Bow direction depends on position so the arc curves
  // AWAY from the pill (looks more natural).
  const midX = (arrowFromX + arrowToX) / 2;
  const midY = (arrowFromY + arrowToY) / 2;
  const bowAmount = dist * 0.28;
  let ctrlX: number;
  let ctrlY: number;
  if (position === "above" || position === "below") {
    // Bow horizontally — sideways arc.
    const sign = anchor.x >= arrowFromX ? -1 : 1;
    ctrlX = midX + sign * bowAmount;
    ctrlY = midY;
  } else {
    // Bow vertically — up/down arc.
    const sign = anchor.y >= arrowFromY ? -1 : 1;
    ctrlX = midX;
    ctrlY = midY + sign * bowAmount;
  }
  const arrowPath = `M ${arrowFromX.toFixed(1)} ${arrowFromY.toFixed(1)} Q ${ctrlX.toFixed(1)} ${ctrlY.toFixed(1)} ${arrowToX.toFixed(1)} ${arrowToY.toFixed(1)}`;
  // Estimate path length for stroke-dasharray (simple straight-line + bow
  // approximation; not perfect but close enough for stroke-dashoffset).
  const pathLen = Math.max(60, dist * 1.18);
  // Pill body: subtle border in `subtle` token, fill that's a hair darker
  // than bg so it reads against the parchment.
  const pillFill = tokens.colors.subtle;
  const pillStroke = tokens.colors.muted;
  // Each line is its own <text> for clean leading; first line at padY +
  // fontSize, subsequent lines at +lineHeight.
  const textLines = lines
    .map((line, i) => {
      const lineY = pillY + padY + fontSize + i * lineHeight;
      return `<text x="${(pillX + width / 2).toFixed(1)}" y="${lineY.toFixed(1)}" text-anchor="middle" font-size="${fontSize}" font-style="italic" fill="${tokens.colors.muted}">${escapeHtml(line)}</text>`;
    })
    .join("\n  ");
  return `
  <g class="hf-pill hf-pill-${classId}" opacity="0">
    <rect x="${pillX.toFixed(1)}" y="${pillY.toFixed(1)}" width="${width.toFixed(1)}" height="${height.toFixed(1)}" rx="6" ry="6" fill="${pillFill}" fill-opacity="0.45" stroke="${pillStroke}" stroke-opacity="0.5" stroke-width="1" />
    ${textLines}
  </g>
  ${
    showLeader
      ? `<path class="hf-pill-leader hf-pill-leader-${classId}" d="${arrowPath}" fill="none" stroke="${tokens.colors.muted}" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="${pathLen.toFixed(1)}" stroke-dashoffset="${pathLen.toFixed(1)}" />`
      : ""
  }`.trim();
}

/**
 * Greedy word-wrap to a max character count per line. Preserves explicit
 * `\n` line breaks. Used by `renderAnnotation` so multi-line annotations
 * lay out predictably without measuring the actual text in a browser.
 */
export function wrapText(text: string, maxChars: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/\s+/).filter((w) => w.length > 0);
    let line = "";
    for (const word of words) {
      const test = line.length === 0 ? word : `${line} ${word}`;
      if (test.length > maxChars && line.length > 0) {
        out.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line.length > 0) out.push(line);
  }
  return out;
}
