import type { DesignTokens } from "./types.js";
import { HACKERNOON_FT } from "../themes.js";

/**
 * Default tokens — HackerNoon FT-style data journalism (cream bg, red accent,
 * Georgia serif). Picked because it's the user's primary brand. To use a
 * different theme set `design.theme` in hyperframes.json or ship DESIGN.md.
 */
export const DEFAULT_TOKENS: DesignTokens = HACKERNOON_FT;
