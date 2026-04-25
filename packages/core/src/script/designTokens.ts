import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_TOKENS } from "./templates/tokens.js";
import { getThemeByName } from "./themes.js";
import type { DesignTokens } from "./templates/types.js";

/**
 * Heuristic parser for DESIGN.md → DesignTokens. Looks for a "Colors" section
 * with a markdown table that includes hex codes, then matches role keywords
 * (background, accent, primary, muted, etc.) to slots. Falls back to defaults
 * for anything missing. Best-effort — humans write DESIGN.md however they want.
 */
export function parseDesignBriefToTokens(brief: string | null | undefined): DesignTokens {
  if (!brief || !brief.trim()) return DEFAULT_TOKENS;

  const next: DesignTokens = {
    colors: { ...DEFAULT_TOKENS.colors },
    fonts: { ...DEFAULT_TOKENS.fonts },
    motion: { ...DEFAULT_TOKENS.motion },
  };

  // Extract hex codes with surrounding role context.
  const lines = brief.split(/\r?\n/);
  const palette: Array<{ role: string; hex: string }> = [];
  for (const line of lines) {
    const hexMatches = line.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g);
    if (!hexMatches) continue;
    const role = line.toLowerCase();
    for (const hex of hexMatches) {
      palette.push({ role, hex: normalizeHex(hex) });
    }
  }

  // Slot assignment — first hex matching each role keyword wins.
  const findFor = (...keywords: string[]): string | null => {
    for (const entry of palette) {
      if (keywords.some((kw) => entry.role.includes(kw))) return entry.hex;
    }
    return null;
  };
  next.colors.bg = findFor("background", "bg deep", "bg-deep", "deep black") ?? next.colors.bg;
  next.colors.surface = findFor("surface", "card", "panel", "bg surface") ?? next.colors.surface;
  next.colors.accent =
    findFor("accent primary", "primary accent", "accent purple", "purple", "headline") ??
    next.colors.accent;
  next.colors.accent2 =
    findFor("accent secondary", "secondary accent", "accent cyan", "cyan", "label") ??
    next.colors.accent2;
  next.colors.accent3 =
    findFor("accent tertiary", "tertiary accent", "accent amber", "amber", "callout", "stat") ??
    next.colors.accent3;
  next.colors.fg =
    findFor("text primary", "primary text", "headline text", "body text") ?? next.colors.fg;
  next.colors.muted =
    findFor("text secondary", "secondary text", "subtitle", "description") ?? next.colors.muted;
  next.colors.subtle =
    findFor("text muted", "muted text", "footnote", "source") ?? next.colors.subtle;

  // Fonts — look for known font families.
  const fontMatch = (regex: RegExp): string | null => {
    for (const line of lines) {
      const m = line.match(regex);
      if (m) return m[0];
    }
    return null;
  };
  const interFamily = fontMatch(/\bInter\b(?: Black| Bold| SemiBold| Medium| Light| Regular)?/i);
  const monoFamily = fontMatch(
    /\bJetBrains Mono\b|\bIBM Plex Mono\b|\bRoboto Mono\b|\bFira Code\b/i,
  );
  if (interFamily) {
    next.fonts.display = `'${stripFontWeight(interFamily)}', sans-serif`;
    next.fonts.body = `'${stripFontWeight(interFamily)}', sans-serif`;
  }
  if (monoFamily) {
    next.fonts.mono = `'${monoFamily}', ui-monospace, monospace`;
  }

  // Motion — extract from "Entrances: power3.out, 0.4–0.7s, staggered 0.15–0.2s"
  const motionLine = lines.find((l) => /entrance/i.test(l) || /motion/i.test(l) || /ease/i.test(l));
  if (motionLine) {
    const easeMatch = motionLine.match(/\b(power\d(?:\.\d)?\.(?:in|out|inOut))\b/i);
    if (easeMatch && easeMatch[1]) next.motion.ease = easeMatch[1];
    const durMatch = motionLine.match(/(\d*\.?\d+)\s*[–-]\s*(\d*\.?\d+)\s*s/);
    if (durMatch && durMatch[1] && durMatch[2]) {
      const avg = (parseFloat(durMatch[1]) + parseFloat(durMatch[2])) / 2;
      next.motion.enterMs = Math.round(avg * 1000);
    }
    const staggerMatch = motionLine.match(/stagger(?:ed)?\s+(\d*\.?\d+)/i);
    if (staggerMatch && staggerMatch[1]) {
      next.motion.staggerMs = Math.round(parseFloat(staggerMatch[1]) * 1000);
    }
  }

  return next;
}

function normalizeHex(hex: string): string {
  if (hex.length === 4) {
    // Expand #abc → #aabbcc
    return (
      "#" +
      hex
        .slice(1)
        .split("")
        .map((c) => c + c)
        .join("")
    );
  }
  return hex.toLowerCase();
}

function stripFontWeight(name: string): string {
  return name.replace(/\s+(?:Black|Bold|SemiBold|Medium|Light|Regular)$/i, "").trim();
}

/**
 * Resolve the design tokens for a project. Precedence:
 *   1. hyperframes.json `design.theme` — explicit user choice always wins.
 *   2. DESIGN.md (or design.md) parsed via parseDesignBriefToTokens().
 *   3. DEFAULT_TOKENS (currently HackerNoon FT).
 *
 * `briefOverride` lets callers inject a brief they've already loaded.
 */
export function resolveProjectTokens(
  projectDir: string,
  briefOverride?: string | null,
): DesignTokens {
  // Step 1: explicit theme name in hyperframes.json takes precedence.
  const configPath = join(projectDir, "hyperframes.json");
  if (existsSync(configPath)) {
    try {
      const json = JSON.parse(readFileSync(configPath, "utf-8")) as {
        design?: { theme?: unknown };
      };
      const themeName = json?.design?.theme;
      if (typeof themeName === "string") {
        const themed = getThemeByName(themeName);
        if (themed) return themed;
      }
    } catch {
      /* ignore — fall through */
    }
  }
  // Step 2: parse DESIGN.md if present.
  if (briefOverride && briefOverride.trim()) {
    return parseDesignBriefToTokens(briefOverride);
  }
  // Step 3: ship default.
  return DEFAULT_TOKENS;
}
