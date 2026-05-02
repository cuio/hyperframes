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

/**
 * Cyberlofi — pure-black canvas, JetBrains Mono everywhere, pixel-green and
 * glitch-pink accents on stark white. Designed to pair with the cyber-*
 * templates (cyber-data-cluster / cyber-glitch-word / cyber-pixel-still)
 * for the iglooghost / Pixflow data-art aesthetic. The reference profile
 * extractor identifies this aesthetic and the planner picks it when the
 * user's `--theme cyberlofi` flag is set OR when the reference profile's
 * preferredTemplates surface the cyber-* family.
 */
export const CYBERLOFI: DesignTokens = {
  colors: {
    bg: "#000000",
    fg: "#FFFFFF",
    // Surface is a hair off-black so any tile/panel reads against the void.
    surface: "#0a0a0a",
    // Pixel green — the lo-fi gaming UI accent.
    accent: "#66FF99",
    // Glitch magenta/pink — the chromatic-shift opposite color.
    accent2: "#FF6699",
    // Soft amber for the rare emphasis stroke.
    accent3: "#E8B46E",
    muted: "#666666",
    // Faint dividers — kept very dark so the void stays the dominant tone.
    subtle: "#222222",
  },
  fonts: {
    // JetBrains Mono carries everything. Display + body + mono all the same
    // family with weight changes does the layout work.
    display: "'JetBrains Mono', 'Space Mono', 'Courier New', monospace",
    body: "'JetBrains Mono', 'Space Mono', 'Courier New', monospace",
    mono: "'JetBrains Mono', 'Space Mono', 'Courier New', monospace",
  },
  motion: {
    // Hard cuts > smooth fades for this aesthetic. power4 makes entries snap.
    ease: "power4.out",
    enterMs: 280,
    staggerMs: 60,
  },
};

export const THEMES: Record<string, DesignTokens> = {
  "hackernoon-ft": HACKERNOON_FT,
  "data-drift-dark": DATA_DRIFT_DARK,
  dreamspace: DREAMSPACE,
  cyberlofi: CYBERLOFI,
};

export const DEFAULT_THEME = "hackernoon-ft";

export function getThemeByName(name: string | undefined | null): DesignTokens | null {
  if (!name) return null;
  return THEMES[name] ?? null;
}
