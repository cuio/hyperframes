/**
 * `hyperframes score` — pre-render retention scoring via Claude Haiku.
 *
 * Scores a planned script's retention potential WITHOUT rendering. Returns
 * per-scene scores (hook strength, sentiment, energy, predicted retention),
 * arc analysis (overall score, hook quality, momentum risks, closing
 * strength), and a sorted list of high-leverage recommendations.
 *
 * Use this in the iteration loop AFTER `hyperframes script` (which plans
 * + synths) but BEFORE `hyperframes render` (which costs ~30 minutes of
 * compute). Each call is ~$0.01 (Haiku), so iterate freely.
 *
 * The post-render Gemini retention review (`hyperframes optimize`) is
 * a complementary system — it scores the rendered VIDEO frames; this
 * scores the SCRIPT TEXT. Different views, different prices.
 */

import { defineCommand } from "citty";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Example } from "./_examples.js";
import { c } from "../ui/colors.js";
import { errorBox } from "../ui/format.js";
import { loadAnthropicKey, ANTHROPIC_KEY_NAME } from "@hyperframes/core/anthropic";
import {
  scoreScript,
  SCORER_DEFAULT_MODEL,
  type Script,
  type ScriptScore,
} from "@hyperframes/core/script";

const SCRIPT_FILE = "script.json";
const PLANNED_FILE = "script.generated.json";

export const examples: Example[] = [
  ["Score the planned script in the current dir", "hyperframes score"],
  ["Score a specific project", "hyperframes score ./my-video"],
  ["Output structured JSON instead of pretty text", "hyperframes score --json"],
  ["Override the model (default: claude-haiku-4-5)", "hyperframes score --model claude-sonnet-4-5"],
];

export default defineCommand({
  meta: {
    name: "score",
    description: "Score a planned script's retention potential before render (Claude Haiku)",
  },
  args: {
    project: {
      type: "positional",
      description: "Project directory (default: current)",
      required: false,
    },
    json: {
      type: "boolean",
      description: "Output structured JSON instead of pretty text",
      default: false,
    },
    model: {
      type: "string",
      description: `Override Anthropic model id (default: ${SCORER_DEFAULT_MODEL})`,
    },
  },
  async run({ args }) {
    const projectDir = resolve(args.project ?? ".");
    if (!existsSync(projectDir)) {
      console.error(errorBox(`Project directory not found: ${projectDir}`));
      process.exit(1);
    }
    const apiKey = loadAnthropicKey(projectDir);
    if (!apiKey) {
      console.error(
        errorBox(
          `${ANTHROPIC_KEY_NAME} is not set. Add it to your project's .env or your shell environment.`,
        ),
      );
      process.exit(1);
    }
    const script = loadScript(projectDir);
    if (!script) {
      console.error(
        errorBox(
          `No ${SCRIPT_FILE} or ${PLANNED_FILE} in ${projectDir}. Run \`hyperframes script\` first.`,
        ),
      );
      process.exit(1);
    }

    if (!args.json) {
      console.log(c.dim(`Scoring ${script.scenes.length} scenes via Claude Haiku…`));
    }
    const result = await scoreScript(script, {
      apiKey,
      model: args.model || undefined,
    });

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    prettyPrint(script, result);
  },
});

function loadScript(projectDir: string): Script | null {
  // Prefer the planned (audio-resolved) script if it exists; falls back to
  // the planner output. Either is structured the same way for our purposes.
  for (const file of [PLANNED_FILE, SCRIPT_FILE]) {
    const path = join(projectDir, file);
    if (!existsSync(path)) continue;
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as Script;
      if (raw && Array.isArray(raw.scenes)) return raw;
    } catch {
      // try next
    }
  }
  return null;
}

function prettyPrint(script: Script, result: ScriptScore): void {
  const { scenes, arc, recommendations, usage } = result;
  const overallEmoji = arc.overallRetention >= 85 ? "🟢" : arc.overallRetention >= 70 ? "🟡" : "🔴";
  console.log("");
  console.log(
    `${overallEmoji} ${c.bold(`Retention score: ${arc.overallRetention}/100`)}   ` +
      c.dim(`(Haiku, ${usage.inputTokens}+${usage.outputTokens} tokens)`),
  );
  console.log(`🔥 Hook quality: ${arc.hookQuality}/10`);
  console.log(`🎬 Closing strength: ${arc.closingStrength}/10`);
  console.log(
    `⚡ Energy peaks: ${arc.energyPeaks.map((i) => `s${(i + 1).toString().padStart(2, "0")}`).join(", ") || "none"}`,
  );
  if (arc.momentumRisks.length > 0) {
    console.log("");
    console.log(
      c.dim(
        `⚠️  ${arc.momentumRisks.length} momentum risk${arc.momentumRisks.length === 1 ? "" : "s"} flagged:`,
      ),
    );
    for (const risk of arc.momentumRisks) {
      console.log(c.dim(`   ${risk.sceneId}: ${risk.reason}`));
    }
  }

  console.log("");
  console.log(c.bold("Per-scene:"));
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    if (!s) continue;
    const planned = script.scenes[i];
    const emoji = s.predictedRetention >= 85 ? "✅" : s.predictedRetention >= 70 ? "🟡" : "🔴";
    const role = s.narrativeRole.padEnd(10);
    const tpl = (planned?.template ?? "").padEnd(20);
    console.log(
      `  ${emoji} ${s.sceneId.padEnd(4)} ${role} ${tpl} ` +
        `hook=${s.hookStrength}/10 ` +
        `energy=${s.energy}/10 ` +
        `${s.sentiment}/${s.sentimentIntensity} ` +
        c.dim(`→ ${s.predictedRetention}%`),
    );
  }

  if (recommendations.length > 0) {
    console.log("");
    console.log(c.bold(`Top recommendations (${recommendations.length}):`));
    for (const r of recommendations) {
      const conf = r.confidence === "high" ? "HIGH" : r.confidence === "medium" ? "MED " : "LOW ";
      const impact = `+${r.predictedImpact}`.padStart(3);
      console.log(
        `  ${c.dim(`[${conf} ${impact}]`)} ${c.bold(r.type)} ${r.sceneId}${r.field ? `.${r.field}` : ""}`,
      );
      console.log(`           ${r.suggestion}`);
    }
  }
  console.log("");
}
