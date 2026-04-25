import type { Hono } from "hono";
import type { StudioApiAdapter } from "../types.js";
import { CostLogger, type CostEntry } from "../../telemetry/cost.js";
import { OpsLogger } from "../../telemetry/ops.js";

/**
 * Studio-facing cost + ops endpoints. The CLI is the source of truth for
 * detailed views (`hyperframes costs`, `hyperframes ops`); these endpoints
 * exist so the in-browser studio can show a live spend total and the
 * activity feed without spawning a child process.
 */
export function registerCostsRoutes(api: Hono, adapter: StudioApiAdapter): void {
  // Aggregated cost summary for one project. The studio sidebar polls
  // this every few seconds while a plan / generate / render is running.
  api.get("/projects/:id/costs", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const sinceMs = parseSinceParam(c.req.query("since"));
    const limit = clampInt(c.req.query("limit"), 20, 1, 200);

    const logger = new CostLogger(project.dir);
    const all = logger.read();
    const entries = sinceMs == null ? all : all.filter((e) => Date.parse(e.ts) >= sinceMs);

    const totalCostUsd = entries.reduce((sum, e) => sum + e.costUsd, 0);
    const totalWallMs = entries.reduce((sum, e) => sum + e.wallMs, 0);

    const byOp = groupBy(entries, (e) => e.op);
    const byKind = groupBy(entries, (e) => e.details.kind);

    return c.json({
      project: project.id,
      totalCostUsd,
      totalWallMs,
      entryCount: entries.length,
      byOp,
      byKind,
      recent: entries.slice(-limit).reverse(),
    });
  });

  // Recent ops events for the studio activity feed. Errors-only and grep
  // filters mirror the CLI flags so the same query language works in both.
  api.get("/projects/:id/ops", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const sinceMs = parseSinceParam(c.req.query("since"));
    const minLevel = c.req.query("level");
    const grep = c.req.query("grep")?.toLowerCase();
    const limit = clampInt(c.req.query("limit"), 50, 1, 500);

    const logger = new OpsLogger(project.dir, { minLevel: "debug" });
    let entries = logger.read();
    if (sinceMs != null) entries = entries.filter((e) => Date.parse(e.ts) >= sinceMs);
    if (minLevel) {
      const min = LEVEL_RANK[minLevel as keyof typeof LEVEL_RANK];
      if (min != null) entries = entries.filter((e) => LEVEL_RANK[e.level] >= min);
    }
    if (grep) {
      entries = entries.filter(
        (e) => e.op.toLowerCase().includes(grep) || e.message.toLowerCase().includes(grep),
      );
    }
    return c.json({
      project: project.id,
      total: entries.length,
      entries: entries.slice(-limit).reverse(),
    });
  });
}

const LEVEL_RANK = { debug: 0, info: 1, warn: 2, error: 3 } as const;

function parseSinceParam(raw: string | undefined): number | null {
  if (!raw) return null;
  const match = raw.match(/^(\d+(?:\.\d+)?)([dhm])$/i);
  if (match) {
    const n = Number(match[1]);
    const unit = (match[2] ?? "").toLowerCase();
    const ms = unit === "d" ? n * 86_400_000 : unit === "h" ? n * 3_600_000 : n * 60_000;
    return Date.now() - ms;
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

interface GroupRow {
  label: string;
  count: number;
  costUsd: number;
  wallMs: number;
}

function groupBy(entries: CostEntry[], key: (e: CostEntry) => string): GroupRow[] {
  const m = new Map<string, GroupRow>();
  for (const e of entries) {
    const k = key(e);
    const row = m.get(k) ?? { label: k, count: 0, costUsd: 0, wallMs: 0 };
    row.count += 1;
    row.costUsd += e.costUsd;
    row.wallMs += e.wallMs;
    m.set(k, row);
  }
  return [...m.values()].sort((a, b) => b.costUsd - a.costUsd);
}
