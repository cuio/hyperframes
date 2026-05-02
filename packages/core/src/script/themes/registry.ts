import type { LoadedTheme } from "./manifest.js";
import { HACKERNOON_FT, DATA_DRIFT_DARK, DREAMSPACE, DEFAULT_THEME } from "../themes.js";
import { discoverThemeRoots, loadThemesFromRoot, type ThemeSearchRoots } from "./loader.js";

/**
 * The TS-defined themes wrapped as LoadedTheme so they can sit alongside
 * disk themes in one registry. These are the safety net — even with no
 * disk themes present the system has a usable palette.
 */
const BUILTIN: LoadedTheme[] = [
  {
    id: "hackernoon-ft",
    name: "HackerNoon FT",
    description:
      "Cream + red data-journalism palette. Georgia serif. Editorial, restrained, classic.",
    tokens: HACKERNOON_FT,
    fonts: { googleFonts: [] },
    preferences: {
      atmospheres: ["noise-grain", "gradient-mesh", "studio-flat"],
      transitions: ["fade", "wipe-left"],
      icons: [],
    },
    designSystemDoc: null,
    referenceRenderPath: null,
    templates: [],
    source: "builtin",
  },
  {
    id: "data-drift-dark",
    name: "Data Drift Dark",
    description: "Deep black + electric purple/cyan/amber. Inter + JetBrains Mono. Futuristic.",
    tokens: DATA_DRIFT_DARK,
    fonts: { googleFonts: [] },
    preferences: {
      // Removed cosmic-dust + particle-field + geometric-grid: they read as
      // "starfield / polkadot / wallpaper-grid" on a dark bg and almost
      // always make the render feel like a stock template instead of an
      // editorial piece. The new defaults — aurora + gradient-mesh +
      // studio-flat — keep the futuristic feel without the pattern noise.
      // Users who genuinely want those patterns can opt in via the studio
      // theme picker.
      atmospheres: ["aurora", "gradient-mesh", "studio-flat", "noise-grain"],
      transitions: ["fade", "zoom-in", "wipe-left"],
      icons: [],
    },
    designSystemDoc: null,
    referenceRenderPath: null,
    templates: [],
    source: "builtin",
  },
  {
    id: "dreamspace",
    name: "Dreamspace",
    description:
      "Ink-violet bg + UV/cyan/amber. Space Grotesk + JetBrains Mono + Inter. Cinematic explainer.",
    tokens: DREAMSPACE,
    fonts: {
      googleFonts: [
        "Space Grotesk:wght@300;400;500;600;700",
        "JetBrains Mono:wght@300;400;500",
        "Inter:wght@400;500",
      ],
    },
    preferences: {
      // Removed cosmic-dust (star/dust pattern user disliked).
      // radial-pulse and flow-lines kept — they're motion gradients, not
      // pattern textures. Added gradient-mesh for variety.
      atmospheres: ["aurora", "gradient-mesh", "radial-pulse", "studio-flat"],
      transitions: ["fade", "zoom-in", "zoom-out"],
      icons: ["sparkle", "bolt", "network", "target"],
    },
    designSystemDoc: null,
    referenceRenderPath: null,
    templates: [],
    source: "builtin",
  },
];

/**
 * Tiny TTL cache keyed by the resolved search-root pair. The studio loader
 * is called on every plan / variant request — caching avoids re-walking the
 * `docs/design-systems/` tree (~30+ folders) and re-parsing every theme.json
 * for each request. The TTL is short enough that an interactive `theme.json`
 * edit shows up within a second; the studio file watcher can also call
 * `invalidateThemeRegistry()` on disk changes for instant updates.
 */
const REGISTRY_CACHE_TTL_MS = 1000;
interface CacheEntry {
  themes: LoadedTheme[];
  expiresAt: number;
}
const registryCache = new Map<string, CacheEntry>();

function cacheKey(roots: ThemeSearchRoots): string {
  return `${roots.repoRoot ?? ""}::${roots.projectDir ?? ""}`;
}

/** Drop the cache so the next call walks the disk again. */
export function invalidateThemeRegistry(): void {
  registryCache.clear();
}

/**
 * Build the runtime theme registry. Built-in themes are seeded first; disk
 * themes are loaded next and OVERRIDE built-ins of the same id (so the
 * dreamspace built-in can be enriched with a full design-system doc by
 * dropping `docs/design-systems/dreamspace/theme.json` next to the
 * existing markdown).
 *
 * Project-local themes (under <project>/themes/) override repo-shipped
 * themes — that lets a single project ship a custom variant without
 * touching the framework.
 */
export function loadThemeRegistry(roots: ThemeSearchRoots = {}): LoadedTheme[] {
  const key = cacheKey(roots);
  const cached = registryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.themes;

  const byId = new Map<string, LoadedTheme>();
  for (const theme of BUILTIN) byId.set(theme.id, theme);
  const folders = discoverThemeRoots(roots);
  for (const folder of folders) {
    for (const disk of loadThemesFromRoot(folder)) {
      const existing = byId.get(disk.id);
      if (existing) {
        byId.set(disk.id, mergeWithBuiltin(disk, existing));
      } else {
        byId.set(disk.id, disk);
      }
    }
  }
  const themes = Array.from(byId.values());
  registryCache.set(key, { themes, expiresAt: Date.now() + REGISTRY_CACHE_TTL_MS });
  return themes;
}

function mergeWithBuiltin(disk: LoadedTheme, builtin: LoadedTheme): LoadedTheme {
  return {
    ...disk,
    fonts: {
      googleFonts:
        disk.fonts.googleFonts.length > 0 ? disk.fonts.googleFonts : builtin.fonts.googleFonts,
    },
    preferences: {
      atmospheres:
        disk.preferences.atmospheres.length > 0
          ? disk.preferences.atmospheres
          : builtin.preferences.atmospheres,
      transitions:
        disk.preferences.transitions.length > 0
          ? disk.preferences.transitions
          : builtin.preferences.transitions,
      icons: disk.preferences.icons.length > 0 ? disk.preferences.icons : builtin.preferences.icons,
    },
  };
}

export function getLoadedThemeByName(
  name: string | undefined | null,
  roots: ThemeSearchRoots = {},
): LoadedTheme | null {
  if (!name) return null;
  return loadThemeRegistry(roots).find((t) => t.id === name) ?? null;
}

export function getDefaultLoadedTheme(roots: ThemeSearchRoots = {}): LoadedTheme {
  const reg = loadThemeRegistry(roots);
  return reg.find((t) => t.id === DEFAULT_THEME) ?? reg[0] ?? BUILTIN[0]!;
}
