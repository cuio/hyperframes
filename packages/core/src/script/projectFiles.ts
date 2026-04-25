import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Loaders for the four project files that drive the planner. Every loader
 * returns null when the file is missing or empty so the planner can degrade
 * gracefully. Files are truncated at maxChars so the planner prompt stays
 * bounded.
 *
 *   DESIGN.md       — brand identity (rarely changes)
 *   DESIGN-ART.md   — this video's art direction (per-video)
 *   RESEARCH.md     — facts / sources / quotes / caveats (per-video)
 *   script.md       — the spoken narration (per-video)
 */

const FILE_VARIANTS = {
  designArt: ["DESIGN-ART.md", "design-art.md", "DesignArt.md"],
  research: ["RESEARCH.md", "research.md", "Research.md"],
  script: ["script.md", "SCRIPT.md", "Script.md"],
};

function readFirst(projectDir: string, names: string[], maxChars = 12000): string | null {
  for (const name of names) {
    const path = join(projectDir, name);
    if (!existsSync(path)) continue;
    try {
      const raw = readFileSync(path, "utf-8");
      if (!raw.trim()) return null;
      return raw.length > maxChars ? raw.slice(0, maxChars) + "\n\n[…truncated]" : raw;
    } catch {
      return null;
    }
  }
  return null;
}

export function loadDesignArt(projectDir: string, maxChars = 8000): string | null {
  return readFirst(projectDir, FILE_VARIANTS.designArt, maxChars);
}

export function loadResearch(projectDir: string, maxChars = 12000): string | null {
  return readFirst(projectDir, FILE_VARIANTS.research, maxChars);
}

export function loadScriptMd(projectDir: string, maxChars = 12000): string | null {
  return readFirst(projectDir, FILE_VARIANTS.script, maxChars);
}

/** Markdown skeletons we drop into a project on first plan. */
export const DESIGN_ART_TEMPLATE = `# Art direction

> One-shot art direction for this specific video. Different from DESIGN.md
> (which is brand identity that rarely changes). Edit before each video.

## Mood
Urgent investigative. Dense. Authoritative.

## Pacing
Tight. Average scene 4–5s. Hook ≤3s. No scene >7s.

## Motifs
- Red horizontal rule on every scene
- All numbers in JetBrains Mono / IBM Plex Mono
- Charts emphasize SCALE, not ratios — prefer bars over donuts

## Transitions
Hard cuts. No fades except the outro.

## Sound notes (narrator delivery)
Slightly accelerated. Press pause before each big number.
`;

export const RESEARCH_TEMPLATE = `# Research

> Facts, numbers, sources, quotes, caveats for this video.
> Every numerical claim in the script should trace back to a line here.
> The planner will warn about orphan claims and refuse to invent numbers.

## Headline numbers
- US Treasuries onchain: **$5.8bn** (RWA.xyz, March 2026)
- Private credit: **$3.2bn** (Blocklr, March 2026)

## Key sources
- RWA.xyz dashboard — https://rwa.xyz
- BlackRock BUIDL disclosures
- Ondo Finance Q1 2026 report

## Quotes
- "Tokenization is the future of finance." — Larry Fink, BlackRock CEO

## Counterpoints / caveats
- Onchain volume ≠ liquidity; most tokenized treasuries trade <1% daily turnover

## Don't claim
- Don't call it a "$10bn+ market" — that includes stablecoins, which are not RWA
`;
