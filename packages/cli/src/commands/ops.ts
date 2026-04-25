import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { OpsLogger, type OpEntry, type OpLevel } from "@hyperframes/core";
import { c } from "../ui/colors.js";
import { resolveProject } from "../utils/project.js";
import { withMeta } from "../utils/updateCheck.js";

export const examples: Example[] = [
  ["Show recent operations for the current project", "hyperframes ops"],
  ["Errors only", "hyperframes ops --level error"],
  ["Last 24 hours, JSON", "hyperframes ops --since 1d --json"],
  ["Filter by op tag", "hyperframes ops --grep script.plan"],
];

const LEVEL_RANK: Record<OpLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function parseSinceFlag(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.match(/^(\d+(?:\.\d+)?)([dhm])$/i);
  if (match) {
    const n = Number(match[1]);
    const unit = (match[2] ?? "").toLowerCase();
    const ms = unit === "d" ? n * 86_400_000 : unit === "h" ? n * 3_600_000 : n * 60_000;
    return Date.now() - ms;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function fmtTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 19).replace("T", " ");
}

function fmtDuration(ms: number): string {
  if (ms === 0) return "";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function levelStyle(level: OpLevel, label: string): string {
  if (level === "error") return c.error(label);
  if (level === "warn") return c.warn(label);
  if (level === "debug") return c.dim(label);
  return c.success(label);
}

function pad(s: string, width: number): string {
  if (s.length >= width) return s;
  return s + " ".repeat(width - s.length);
}

export default defineCommand({
  meta: {
    name: "ops",
    description: "Show the project's operations log (every plan/synth/render/lint)",
  },
  args: {
    dir: { type: "positional", description: "Project directory", required: false },
    level: {
      type: "string",
      description: "Filter to entries at or above this level (debug/info/warn/error)",
    },
    since: {
      type: "string",
      description: "Only entries after this time (e.g. 1d, 7d, 24h, ISO date)",
    },
    grep: {
      type: "string",
      description: "Only entries whose op tag or message matches this substring",
    },
    limit: {
      type: "string",
      description: "Most-recent rows to show (default 30)",
      default: "30",
    },
    json: { type: "boolean", description: "Output as JSON", default: false },
  },
  async run({ args }) {
    const project = resolveProject(args.dir as string | undefined);
    const logger = new OpsLogger(project.dir, { minLevel: "debug" });
    const all = logger.read();

    const sinceMs = parseSinceFlag(args.since as string | undefined);
    const minRank = args.level
      ? (LEVEL_RANK[(args.level as OpLevel) ?? "info"] ?? LEVEL_RANK.info)
      : null;
    const grep = args.grep as string | undefined;

    let entries: OpEntry[] = all;
    if (sinceMs != null) entries = entries.filter((e) => Date.parse(e.ts) >= sinceMs);
    if (minRank != null) entries = entries.filter((e) => LEVEL_RANK[e.level] >= minRank);
    if (grep) {
      const needle = grep.toLowerCase();
      entries = entries.filter(
        (e) => e.op.toLowerCase().includes(needle) || e.message.toLowerCase().includes(needle),
      );
    }
    const limit = Math.max(1, Number(args.limit));
    const recent = entries.slice(-limit);

    if (args.json) {
      console.log(
        JSON.stringify(
          withMeta({
            project: project.name,
            total: entries.length,
            entries: recent,
          }),
          null,
          2,
        ),
      );
      return;
    }

    if (entries.length === 0) {
      console.log(
        c.bold(`Operations log — ${project.name}`) +
          (sinceMs != null ? c.dim(` (since ${args.since})`) : ""),
      );
      console.log(c.dim("\n  No ops logged yet for this project."));
      console.log(
        c.dim(
          "  Ops accumulate as you run plan / synth / render / lint through the studio or CLI.",
        ),
      );
      return;
    }

    console.log(
      c.bold(`Operations log — ${project.name}`) +
        (sinceMs != null ? c.dim(` (since ${args.since})`) : ""),
    );
    console.log(
      c.dim(
        `  ${recent.length} of ${entries.length} entries${grep ? ` matching "${grep}"` : ""}\n`,
      ),
    );

    for (const e of recent) {
      const tag = levelStyle(e.level, pad(e.level.toUpperCase(), 5));
      const okTag = e.ok ? c.dim(" OK ") : c.error(" FAIL ");
      const dur = fmtDuration(e.wallMs);
      console.log(
        "  " +
          c.dim(fmtTimestamp(e.ts)) +
          " " +
          tag +
          okTag +
          " " +
          pad(e.op, 26) +
          " " +
          (dur ? c.dim(pad(dur, 8)) : pad("", 8)) +
          " " +
          e.message,
      );
    }
  },
});
