import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { withMutex } from "../internal/atomicWrite.js";

/**
 * Operations log — the "log everything" companion to costs.jsonl. Cheap
 * append-only event stream for non-cost operations: lint runs, validate
 * results, route hits, errors, settings changes, scaffold actions, etc.
 *
 * Use cases:
 *   - "what happened in this project last hour" audit trail
 *   - debugging non-cost issues (e.g. silent loader failures)
 *   - feeding a future Studio activity feed
 *
 * Cost-bearing ops still go to costs.jsonl via CostLogger — those are the
 * source of truth for billing. ops.jsonl is the source of truth for "did
 * anything happen and was it OK?" Some ops (e.g. a render) appear in both:
 * costs.jsonl with the priced details, ops.jsonl with the human summary.
 */

export type OpLevel = "debug" | "info" | "warn" | "error";

export interface OpEntry {
  /** ISO 8601 timestamp. */
  ts: string;
  /** Basename of the project directory. */
  projectId: string;
  /** Stable operation tag, e.g. "lint.run", "studio.api.plan", "render.start". */
  op: string;
  /** Severity. Defaults to "info". */
  level: OpLevel;
  /** Wall-clock duration in ms. Optional — pure events use 0. */
  wallMs: number;
  /** Whether the op completed successfully. true for events without an outcome. */
  ok: boolean;
  /** Human-readable one-liner. Shown in activity feeds and the CLI log viewer. */
  message: string;
  /** Optional structured context — sceneId, file path, error code, etc. */
  meta?: Record<string, unknown>;
}

export interface OpsLoggerOptions {
  /** Override the default level filter. Entries below this level are skipped. */
  minLevel?: OpLevel;
}

const LEVEL_RANK: Record<OpLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Per-project ops log writer. Same withMutex serialization as CostLogger so
 * concurrent appends never tear, and same skip-malformed-line read logic so
 * a torn write never poisons subsequent reads.
 */
export class OpsLogger {
  readonly projectDir: string;
  readonly minLevel: OpLevel;

  constructor(projectDir: string, options: OpsLoggerOptions = {}) {
    this.projectDir = projectDir;
    this.minLevel = options.minLevel ?? "info";
  }

  get logPath(): string {
    return join(this.projectDir, ".hyperframes", "ops.jsonl");
  }

  private shouldEmit(level: OpLevel): boolean {
    return LEVEL_RANK[level] >= LEVEL_RANK[this.minLevel];
  }

  /** Append an op entry. Returns the entry that was written. */
  async log(entry: {
    op: string;
    message: string;
    level?: OpLevel;
    wallMs?: number;
    ok?: boolean;
    meta?: Record<string, unknown>;
  }): Promise<OpEntry | null> {
    const level = entry.level ?? "info";
    if (!this.shouldEmit(level)) return null;
    const out: OpEntry = {
      ts: new Date().toISOString(),
      projectId: basename(this.projectDir),
      op: entry.op,
      level,
      wallMs: entry.wallMs ?? 0,
      ok: entry.ok ?? level !== "error",
      message: entry.message,
      ...(entry.meta ? { meta: entry.meta } : {}),
    };
    await withMutex(`ops:${this.projectDir}`, async () => {
      mkdirSync(dirname(this.logPath), { recursive: true, mode: 0o755 });
      appendFileSync(this.logPath, JSON.stringify(out) + "\n");
    });
    return out;
  }

  /** Convenience: log an error-level entry tied to a thrown Error. */
  async logError(
    op: string,
    err: unknown,
    meta?: Record<string, unknown>,
  ): Promise<OpEntry | null> {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    return this.log({
      op,
      level: "error",
      ok: false,
      message,
      meta: stack ? { ...(meta ?? {}), stack: stack.split("\n").slice(0, 5).join("\n") } : meta,
    });
  }

  /** Read all ops; skips malformed lines so a torn write can't poison reads. */
  read(): OpEntry[] {
    if (!existsSync(this.logPath)) return [];
    const content = readFileSync(this.logPath, "utf-8");
    const out: OpEntry[] = [];
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed) as OpEntry);
      } catch {
        /* tolerate torn lines */
      }
    }
    return out;
  }
}

/**
 * Fire-and-forget helper for callers that don't need to await the disk
 * write. Used inside route handlers where we want to log audit info but
 * not delay the response.
 */
export function opsFireAndForget(logger: OpsLogger, entry: Parameters<OpsLogger["log"]>[0]): void {
  void logger.log(entry).catch((err) => {
    console.warn(`[telemetry] ops log failed for ${entry.op}`, err);
  });
}
