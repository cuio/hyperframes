import type { DesignTokens } from "./templates/types.js";

/**
 * Built-in named themes. The user picks one via hyperframes.json:
 *   { "design": { "theme": "hackernoon-ft" } }
 *
 * If they ship a DESIGN.md instead, parseDesignBriefToTokens() takes precedence
 * and the theme acts as the fallback.
 */

export const HACKERNOON_FT: DesignTokens = {
  colors: {
    bg: "#F2E8D5",
    fg: "#1A1A1A",
    surface: "rgba(255,255,255,0.5)",
    accent: "#E3120B",
    accent2: "#0E5A89",
    accent3: "#D4A574",
    muted: "#888888",
    subtle: "#C8C0B4",
  },
  fonts: {
    display: "'Georgia', 'Times New Roman', serif",
    body: "'Georgia', 'Times New Roman', serif",
    mono: "'IBM Plex Mono', 'Courier New', monospace",
  },
  motion: {
    ease: "power3.out",
    enterMs: 600,
    staggerMs: 150,
  },
};

export const DATA_DRIFT_DARK: DesignTokens = {
  colors: {
    bg: "#0a0a0a",
    fg: "#f0f0f0",
    surface: "#111118",
    accent: "#7c3aed",
    accent2: "#06b6d4",
    accent3: "#FFB300",
    muted: "#8a8a9a",
    subtle: "#555566",
  },
  fonts: {
    display: "'Inter', sans-serif",
    body: "'Inter', sans-serif",
    mono: "'JetBrains Mono', ui-monospace, monospace",
  },
  motion: {
    ease: "power3.out",
    enterMs: 600,
    staggerMs: 180,
  },
};

/**
 * Dreamspace explainer aesthetic — deep ink-violet bg, oklch-anchored UV /
 * cyan / amber accents, Space Grotesk display + JetBrains Mono chrome +
 * Inter body. Hex approximations of the oklch tokens defined in the
 * Dreamspace design handoff (see docs/design-systems/dreamspace.md).
 *
 * Use this theme as a base for explainer-style videos; it pairs naturally
 * with aurora / cosmic-dust / radial-pulse atmospheres and the layered
 * hook (eyebrow + title + subtext) flow.
 */
export const DREAMSPACE: DesignTokens = {
  colors: {
    bg: "#0d0d18",
    fg: "#f6f6f8",
    surface: "#15151f",
    accent: "#a78bfa",
    accent2: "#5cd5e7",
    accent3: "#e8b46e",
    muted: "#aeaeb4",
    subtle: "#3a3a48",
  },
  fonts: {
    display: "'Space Grotesk', 'Inter', sans-serif",
    body: "'Inter', system-ui, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, monospace",
  },
  motion: {
    // easeOutQuart maps to GSAP's power4.out — matches the spec's hero
    // entrance feel for counters and big text.
    ease: "power4.out",
    enterMs: 600,
    staggerMs: 180,
  },
};

export const THEMES: Record<string, DesignTokens> = {
  "hackernoon-ft": HACKERNOON_FT,
  "data-drift-dark": DATA_DRIFT_DARK,
  dreamspace: DREAMSPACE,
};

export const DEFAULT_THEME = "hackernoon-ft";

export function getThemeByName(name: string | undefined | null): DesignTokens | null {
  if (!name) return null;
  return THEMES[name] ?? null;
}
