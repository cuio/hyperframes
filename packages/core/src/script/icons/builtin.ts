import type { IconRenderOptions } from "./types.js";

/**
 * Built-in icon library — minimal geometric SVG paths in a 24×24 viewBox,
 * stroke-only so they pick up token colours via currentColor. Every icon
 * shipped here is hand-drawn from primitives (lines, arcs, rects) — no
 * third-party paths, no licensing concerns.
 *
 * Used by templates that accept an icon prop (e.g. concept-callout items
 * can name an icon to render alongside the badge). The planner is told
 * which icons exist and is expected to pick semantically.
 */
export const BUILTIN_ICONS: Record<string, { paths: string[]; description: string }> = {
  "arrow-right": {
    paths: ["M5 12h14", "M13 6l6 6-6 6"],
    description: "Forward arrow — CTAs, comparisons, transitions",
  },
  "arrow-down": {
    paths: ["M12 5v14", "M6 13l6 6 6-6"],
    description: "Downward arrow — timelines, declines, drill-down",
  },
  "chart-up": {
    paths: ["M3 17l6-6 4 4 8-8", "M14 7h7v7"],
    description: "Trend going up — growth, gains, positive outcomes",
  },
  "chart-down": {
    paths: ["M3 7l6 6 4-4 8 8", "M14 17h7v-7"],
    description: "Trend going down — decline, losses, negative outcomes",
  },
  bolt: {
    paths: ["M13 2L3 14h7l-1 8 10-12h-7l1-8z"],
    description: "Lightning — speed, energy, breakthrough",
  },
  dollar: {
    paths: ["M12 1v22", "M17 5H9.5a3.5 3.5 0 100 7h5a3.5 3.5 0 110 7H6"],
    description: "Money — financial, revenue, cost",
  },
  network: {
    paths: [
      "M16 8a3 3 0 100-6 3 3 0 000 6z",
      "M5 22a3 3 0 100-6 3 3 0 000 6z",
      "M19 22a3 3 0 100-6 3 3 0 000 6z",
      "M7.5 18.5l4.5-7.5",
      "M16.5 18.5l-4.5-7.5",
    ],
    description: "Connected nodes — networks, partnerships, integration",
  },
  lock: {
    paths: ["M5 11h14v10H5z", "M7 11V7a5 5 0 0110 0v4"],
    description: "Padlock — security, custody, protection",
  },
  globe: {
    paths: [
      "M12 1a11 11 0 100 22 11 11 0 000-22z",
      "M3 12h18",
      "M12 1c2.5 3 4 6.5 4 11s-1.5 8-4 11",
      "M12 1c-2.5 3-4 6.5-4 11s1.5 8 4 11",
    ],
    description: "Globe — global scope, worldwide, international",
  },
  target: {
    paths: [
      "M12 1v4",
      "M12 19v4",
      "M1 12h4",
      "M19 12h4",
      "M12 5a7 7 0 100 14 7 7 0 000-14z",
      "M12 9a3 3 0 100 6 3 3 0 000-6z",
    ],
    description: "Bullseye — goals, targets, focus",
  },
  check: {
    paths: ["M5 13l4 4L19 7"],
    description: "Checkmark — success, complete, validated",
  },
  x: {
    paths: ["M6 6l12 12", "M18 6L6 18"],
    description: "Cross — failure, removed, blocked",
  },
  plus: {
    paths: ["M12 5v14", "M5 12h14"],
    description: "Plus — addition, new, expand",
  },
  minus: {
    paths: ["M5 12h14"],
    description: "Minus — removed, reduced",
  },
  info: {
    paths: ["M12 1a11 11 0 100 22 11 11 0 000-22z", "M12 8h.01", "M11 12h1v4h1"],
    description: "Information — context, details, footnote",
  },
  warning: {
    paths: ["M12 2L1 22h22z", "M12 9v6", "M12 18h.01"],
    description: "Triangle alert — risks, caution, caveats",
  },
  star: {
    paths: ["M12 1l3.4 7L23 9.3l-5.5 5.4L19 22l-7-3.7L5 22l1.5-7.3L1 9.3l7.6-1.3z"],
    description: "Star — favourite, premium, marquee",
  },
  sparkle: {
    paths: [
      "M12 2l1.5 4 4 1.5-4 1.5L12 13l-1.5-4-4-1.5 4-1.5z",
      "M5 16l1 2 2 1-2 1-1 2-1-2-2-1 2-1z",
      "M18 15l1 2 2 1-2 1-1 2-1-2-2-1 2-1z",
    ],
    description: "Sparkles — magic, AI, novel",
  },
  shield: {
    paths: ["M12 1l9 4v6c0 6-4 10-9 12-5-2-9-6-9-12V5z"],
    description: "Shield — defence, trust, compliance",
  },
  clock: {
    paths: ["M12 1a11 11 0 100 22 11 11 0 000-22z", "M12 6v6l4 2"],
    description: "Clock — time, schedule, deadline, milestone",
  },
};

export const ICON_IDS = Object.keys(BUILTIN_ICONS);

/**
 * Render an icon by id to an inline SVG string. Returns "" for unknown ids
 * so callers can safely chain it into template fragments without guards.
 */
export function renderIcon(id: string, opts: IconRenderOptions = {}): string {
  const icon = BUILTIN_ICONS[id];
  if (!icon) return "";
  const size = opts.size ?? 24;
  const color = opts.color ?? "currentColor";
  const sw = opts.strokeWidth ?? 2;
  const paths = icon.paths.map((d) => `<path d="${d}" />`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

export function hasIcon(id: string): boolean {
  return id in BUILTIN_ICONS;
}
