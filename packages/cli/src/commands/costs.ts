import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { CostLogger, type CostEntry } from "@hyperframes/core";
import { c } from "../ui/colors.js";
import { resolveProject } from "../utils/project.js";
import { withMeta } from "../utils/updateCheck.js";

export const examples: Example[] = [
  ["Show cost summary for the current project", "hyperframes costs"],
  ["Last 24 hours only", "hyperframes costs --since 1d"],
  ["Last 7 days, JSON output", "hyperframes costs --since 7d --json"],
  ["Group by operation, last month", "hyperframes costs --since 30d --by op"],
];

interface SummaryRow {
  label: string;
  count: number;
  costUsd: number;
  wallMs: number;
}

function parseSinceFlag(value: string | undefined): number | null {
  if (!value) return null;
  // Accepts "1d", "7d", "24h", "60m", or an ISO date.
  const match = value.match(/^(\d+(?:\.\d+)?)([dhm])$/i);
  if (match) {
    const n = Number(match[1]);
    const unit = (match[2] ?? "").toLowerCase();
    const ms = unit === "d" ? n * 86_400_000 : unit === "h" ? n * 3_600_000 : n * 60_000;
    return Date.now() - ms;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return parsed;
}

function group(entries: CostEntry[], key: (e: CostEntry) => string): SummaryRow[] {
  const m = new Map<string, SummaryRow>();
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

function fmtUsd(n: number): string {
  if (n === 0) return "$0.0000";
  if (n < 0.0001) return `$${n.toExponential(2)}`;
  return "$" + n.toFixed(4);
}

function fmtCount(n: number): string {
  return n === 1 ? "1 call" : `${n} calls`;
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function fmtTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 16).replace("T", " ");
}

function pad(s: string, width: number): string {
  if (s.length >= width) return s;
  return s + " ".repeat(width - s.length);
}

export default defineCommand({
  meta: {
    name: "costs",
    description: "Show production cost (Anthropic, ElevenLabs, render) for a project",
  },
  args: {
    dir: { type: "positional", description: "Project directory", required: false },
    since: {
      type: "string",
      description: "Filter to entries after this time (e.g. 1d, 7d, 30d, or ISO date)",
    },
    by: {
      type: "string",
      description: "Group rows by 'op' (default), 'kind', or 'model'",
      default: "op",
    },
    limit: {
      type: "string",
      description: "Most-recent rows to show in the activity tail (default 10)",
      default: "10",
    },
    json: { type: "boolean", description: "Output as JSON", default: false },
  },
  async run({ args }) {
    const project = resolveProject(args.dir as string | undefined);
    const logger = new CostLogger(project.dir);
    const allEntries = logger.read();

    const sinceMs = parseSinceFlag(args.since as string | undefined);
    const entries =
      sinceMs == null ? allEntries : allEntries.filter((e) => Date.parse(e.ts) >= sinceMs);

    const totalCost = entries.reduce((sum, e) => sum + e.costUsd, 0);
    const totalWall = entries.reduce((sum, e) => sum + e.wallMs, 0);

    if (args.json) {
      const grouping = (args.by as string) ?? "op";
      const groups =
        grouping === "kind"
          ? group(entries, (e) => e.details.kind)
          : grouping === "model"
            ? group(entries, (e) =>
                e.details.kind === "anthropic" || e.details.kind === "vision"
                  ? e.details.model
                  : e.details.kind === "elevenlabs"
                    ? "elevenlabs:" + e.details.voiceId
                    : "render",
              )
            : group(entries, (e) => e.op);
      console.log(
        JSON.stringify(
          withMeta({
            project: project.name,
            entryCount: entries.length,
            totalCostUsd: totalCost,
            totalWallMs: totalWall,
            groups,
            recent: entries.slice(-Number(args.limit)).reverse(),
          }),
          null,
          2,
        ),
      );
      return;
    }

    if (entries.length === 0) {
      console.log(
        c.bold(`Cost summary — ${project.name}`) +
          (sinceMs != null ? c.dim(` (since ${args.since})`) : ""),
      );
      console.log(c.dim("\n  No cost entries logged yet for this project."));
      console.log(
        c.dim(
          "  Costs accumulate as you run script.plan / synthesize / render through the studio or CLI.",
        ),
      );
      return;
    }

    console.log(
      c.bold(`Cost summary — ${project.name}`) +
        (sinceMs != null ? c.dim(` (since ${args.since})`) : ""),
    );
    console.log(c.dim(`  ${entries.length} ops · ${fmtDuration(totalWall)} of wall time\n`));

    const grouping = (args.by as string) ?? "op";
    const groups =
      grouping === "kind"
        ? group(entries, (e) => e.details.kind)
        : grouping === "model"
          ? group(entries, (e) =>
              e.details.kind === "anthropic" || e.details.kind === "vision"
                ? e.details.model
                : e.details.kind === "elevenlabs"
                  ? "elevenlabs:" + e.details.voiceId
                  : "render",
            )
          : group(entries, (e) => e.op);

    console.log(c.bold(`  By ${grouping}`));
    const labelWidth = Math.max(...groups.map((g) => g.label.length), 12) + 2;
    for (const row of groups) {
      console.log(
        "    " +
          pad(row.label, labelWidth) +
          c.dim(pad(fmtCount(row.count), 12)) +
          c.success(fmtUsd(row.costUsd)),
      );
    }
    console.log("    " + pad("─".repeat(labelWidth + 12 + 12), labelWidth + 24) + "");
    console.log(
      "    " +
        pad(c.bold("Total"), labelWidth) +
        pad("", 12) +
        c.bold(c.success(fmtUsd(totalCost))) +
        "\n",
    );

    const limit = Math.max(0, Number(args.limit));
    if (limit > 0) {
      const recent = entries.slice(-limit).reverse();
      console.log(c.bold("  Most recent"));
      for (const e of recent) {
        const detailHint = costDetailHint(e);
        console.log(
          "    " +
            c.dim(fmtTimestamp(e.ts)) +
            "  " +
            pad(e.op, 28) +
            c.success(pad(fmtUsd(e.costUsd), 11)) +
            c.dim(pad(fmtDuration(e.wallMs), 8)) +
            (detailHint ? c.dim(" " + detailHint) : ""),
        );
      }
    }
  },
});

function costDetailHint(e: CostEntry): string {
  const d = e.details;
  if (d.kind === "anthropic" || d.kind === "vision") {
    return `${d.model} · ${d.inputTokens.toLocaleString()}→${d.outputTokens.toLocaleString()} tok`;
  }
  if (d.kind === "elevenlabs") {
    return `${d.voiceId} · ${d.characters.toLocaleString()} chars`;
  }
  if (d.kind === "render") {
    return `${d.quality} · ${d.framesCaptured} frames · ${(d.outputBytes / 1_048_576).toFixed(1)}MB`;
  }
  return "";
}
