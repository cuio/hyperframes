import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Per-model cost rates in USD per million tokens.
 *
 * Anthropic published prices as of 2026-04. The fork's UI shows these at the
 * time of each call so the user can sanity-check. A user override is loaded
 * from `~/.hyperframes/cost-rates.json` (global) and
 * `<project>/.hyperframes/cost-rates.json` (per-project, wins).
 */
export interface AnthropicRate {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWritePerMTok?: number;
  cacheReadPerMTok?: number;
}

export interface GeminiRate {
  inputPerMTok: number;
  outputPerMTok: number;
}

export interface CostRates {
  anthropic: Record<string, AnthropicRate>;
  elevenlabs: { perMChar: number };
  /** Gemini per-model rates. `default` is the fallback when a model id isn't
   *  in the table — keeps cost reporting sensible even when the model lineup
   *  changes upstream. */
  gemini: Record<string, GeminiRate> & { default: GeminiRate };
  render: { perMinute: number };
}

/**
 * Conservative defaults. Override via cost-rates.json. Keys match the model
 * ids the planner / vision / improveHook code paths pass through.
 */
export const DEFAULT_RATES: CostRates = {
  anthropic: {
    "claude-opus-4-7": {
      inputPerMTok: 15,
      outputPerMTok: 75,
      cacheWritePerMTok: 18.75,
      cacheReadPerMTok: 1.5,
    },
    "claude-sonnet-4-6": {
      inputPerMTok: 3,
      outputPerMTok: 15,
      cacheWritePerMTok: 3.75,
      cacheReadPerMTok: 0.3,
    },
    "claude-haiku-4-5-20251001": {
      inputPerMTok: 1,
      outputPerMTok: 5,
      cacheWritePerMTok: 1.25,
      cacheReadPerMTok: 0.1,
    },
    // Legacy aliases the planner may still emit.
    "claude-3-5-sonnet": {
      inputPerMTok: 3,
      outputPerMTok: 15,
      cacheWritePerMTok: 3.75,
      cacheReadPerMTok: 0.3,
    },
    "claude-3-5-haiku": {
      inputPerMTok: 1,
      outputPerMTok: 5,
      cacheWritePerMTok: 1.25,
      cacheReadPerMTok: 0.1,
    },
  },
  elevenlabs: { perMChar: 30 },
  gemini: {
    // Google's published pricing as of 2026-04. Flash is the workhorse for
    // every storyline action (render review, scroll-test, image analysis);
    // Pro is reserved for multi-video comparison work that isn't in scope yet.
    "gemini-2.5-flash": { inputPerMTok: 0.3, outputPerMTok: 2.5 },
    "gemini-2.5-pro": { inputPerMTok: 1.25, outputPerMTok: 10 },
    default: { inputPerMTok: 0.3, outputPerMTok: 2.5 },
  },
  render: { perMinute: 0.1 },
};

function readJsonIfExists(path: string): unknown {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    console.warn(`[telemetry] cost-rates.json at ${path} is not valid JSON; ignoring`, err);
    return null;
  }
}

function isPartialRates(value: unknown): value is Partial<CostRates> {
  return value != null && typeof value === "object";
}

function mergeRates(base: CostRates, override: Partial<CostRates> | null): CostRates {
  if (!override) return base;
  return {
    anthropic: { ...base.anthropic, ...(override.anthropic ?? {}) },
    elevenlabs: override.elevenlabs
      ? { ...base.elevenlabs, ...override.elevenlabs }
      : base.elevenlabs,
    gemini: override.gemini
      ? ({ ...base.gemini, ...override.gemini } as CostRates["gemini"])
      : base.gemini,
    render: override.render ? { ...base.render, ...override.render } : base.render,
  };
}

/**
 * Resolve effective rates by layering:
 *   1. Defaults (this file)
 *   2. ~/.hyperframes/cost-rates.json
 *   3. <projectDir>/.hyperframes/cost-rates.json (highest precedence)
 */
export function loadRates(projectDir?: string): CostRates {
  let rates = DEFAULT_RATES;
  const homeFile = join(homedir(), ".hyperframes", "cost-rates.json");
  const homeOverride = readJsonIfExists(homeFile);
  if (isPartialRates(homeOverride)) rates = mergeRates(rates, homeOverride);
  if (projectDir) {
    const projectFile = join(projectDir, ".hyperframes", "cost-rates.json");
    const projectOverride = readJsonIfExists(projectFile);
    if (isPartialRates(projectOverride)) rates = mergeRates(rates, projectOverride);
  }
  return rates;
}

/**
 * Look up the rate for a given model. Falls back to claude-sonnet-4-6 rates
 * when an unknown model id slips through, so cost reporting degrades to a
 * useful estimate instead of zero.
 */
export function rateForModel(rates: CostRates, model: string): AnthropicRate {
  return (
    rates.anthropic[model] ??
    rates.anthropic["claude-sonnet-4-6"] ?? {
      inputPerMTok: 3,
      outputPerMTok: 15,
    }
  );
}
