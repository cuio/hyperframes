import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { withMutex } from "../internal/atomicWrite.js";
import { DEFAULT_RATES, loadRates, rateForModel, type CostRates } from "./rates.js";

export type AnthropicTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
};

export type CostOp =
  | ({
      kind: "anthropic";
      model: string;
    } & AnthropicTokenUsage)
  | ({
      kind: "vision";
      model: string;
      imageCount: number;
    } & AnthropicTokenUsage)
  | { kind: "elevenlabs"; voiceId: string; characters: number }
  | {
      kind: "render";
      durationSeconds: number;
      framesCaptured: number;
      quality: string;
      fps: number;
      outputBytes: number;
    };

export interface CostEntry {
  /** ISO 8601 timestamp. */
  ts: string;
  /** Basename of the project directory (e.g. "my-first-video"). */
  projectId: string;
  /** Stable operation tag, e.g. "script.plan", "elevenlabs.synthesize", "render". */
  op: string;
  /** Wall-clock duration of the operation in milliseconds. */
  wallMs: number;
  /** Computed cost in USD. */
  costUsd: number;
  /** Operation-specific details — model, tokens, voice, output bytes, etc. */
  details: CostOp;
  /** Free-form context (sceneId, output filename, etc.) for filtering. */
  meta?: Record<string, unknown>;
}

/**
 * Compute USD cost for a single op given current rate table. Returns 0 for
 * unknown op kinds rather than throwing — telemetry should never crash a
 * caller if a future op kind isn't priced yet.
 */
export function computeCost(rates: CostRates, op: CostOp): number {
  if (op.kind === "anthropic" || op.kind === "vision") {
    const rate = rateForModel(rates, op.model);
    const cacheReadPerMTok = rate.cacheReadPerMTok ?? rate.inputPerMTok * 0.1;
    const cacheWritePerMTok = rate.cacheWritePerMTok ?? rate.inputPerMTok * 1.25;
    const cacheRead = op.cacheReadInputTokens ?? 0;
    const cacheWrite = op.cacheCreationInputTokens ?? 0;
    const billableInput = Math.max(0, op.inputTokens - cacheRead - cacheWrite);
    return (
      (billableInput / 1_000_000) * rate.inputPerMTok +
      (op.outputTokens / 1_000_000) * rate.outputPerMTok +
      (cacheRead / 1_000_000) * cacheReadPerMTok +
      (cacheWrite / 1_000_000) * cacheWritePerMTok
    );
  }
  if (op.kind === "elevenlabs") {
    return (op.characters / 1_000_000) * rates.elevenlabs.perMChar;
  }
  if (op.kind === "render") {
    return (op.durationSeconds / 60) * rates.render.perMinute;
  }
  return 0;
}

export interface CostLoggerOptions {
  rates?: CostRates;
}

/**
 * Append-only cost log writer scoped to one project. Concurrent writers
 * serialize via withMutex so JSONL lines never tear, even if two routes
 * (e.g. `/script/plan` and `/elevenlabs/synthesize`) finish at the same
 * instant.
 */
export class CostLogger {
  readonly projectDir: string;
  readonly rates: CostRates;

  constructor(projectDir: string, options: CostLoggerOptions = {}) {
    this.projectDir = projectDir;
    this.rates = options.rates ?? loadRates(projectDir);
  }

  /** Path to this project's costs.jsonl, computed from projectDir. */
  get logPath(): string {
    return join(this.projectDir, ".hyperframes", "costs.jsonl");
  }

  /**
   * Record a cost entry. Returns the entry that was written (with cost
   * computed) so callers can echo it for live UI updates.
   */
  async log(
    op: string,
    details: CostOp,
    wallMs: number,
    meta?: Record<string, unknown>,
  ): Promise<CostEntry> {
    const entry: CostEntry = {
      ts: new Date().toISOString(),
      projectId: basename(this.projectDir),
      op,
      wallMs,
      costUsd: computeCost(this.rates, details),
      details,
      ...(meta ? { meta } : {}),
    };
    await withMutex(`costs:${this.projectDir}`, async () => {
      mkdirSync(dirname(this.logPath), { recursive: true, mode: 0o755 });
      appendFileSync(this.logPath, JSON.stringify(entry) + "\n");
    });
    return entry;
  }

  /** Read all cost entries; ignores corrupt lines so a partial write can't poison reads. */
  read(): CostEntry[] {
    if (!existsSync(this.logPath)) return [];
    const content = readFileSync(this.logPath, "utf-8");
    const entries: CostEntry[] = [];
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        entries.push(JSON.parse(trimmed) as CostEntry);
      } catch {
        // Skip malformed lines — an interrupted append can leave a torn JSON line.
      }
    }
    return entries;
  }
}

/**
 * Wrap an async function with wall-clock timing. Returns the result and the
 * elapsed milliseconds — feed `wallMs` into CostLogger.log directly.
 *
 * ```ts
 * const { result, wallMs } = await timed(() => callAnthropic(...));
 * await logger.log("script.plan", { kind: "anthropic", ...result.usage }, wallMs);
 * ```
 */
export async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; wallMs: number }> {
  const start = Date.now();
  const result = await fn();
  return { result, wallMs: Date.now() - start };
}

/** Fire-and-forget helper for callers that don't await the log write. */
export function logFireAndForget(
  logger: CostLogger,
  op: string,
  details: CostOp,
  wallMs: number,
  meta?: Record<string, unknown>,
): void {
  void logger.log(op, details, wallMs, meta).catch((err) => {
    console.warn(`[telemetry] cost log failed for ${op}`, err);
  });
}

/**
 * Callback shape that long-running functions (planScript, synthesizeScript,
 * etc.) accept so they can report per-op cost without taking a hard
 * dependency on the CostLogger class. Route handlers wire this to a
 * CostLogger; tests can pass a spy.
 */
export type CostEventSink = (
  op: string,
  details: CostOp,
  wallMs: number,
  meta?: Record<string, unknown>,
) => void;

/** Build a sink that funnels into a CostLogger (fire-and-forget). */
export function loggerSink(logger: CostLogger): CostEventSink {
  return (op, details, wallMs, meta) => logFireAndForget(logger, op, details, wallMs, meta);
}

export { DEFAULT_RATES, loadRates, rateForModel };
export type { CostRates };
