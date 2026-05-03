/**
 * `hyperframes score` — pre-render retention scoring + auto-apply pipeline.
 *
 * Three layers, all opt-in:
 *
 *   1. Default — score the planned script via Claude Haiku, return per-scene
 *      scores + arc analysis + recommendations + a deterministic visual
 *      storyboard score. Pretty-prints a dashboard or JSON.
 *
 *   2. `--apply-top N` — automatically apply the top N high-confidence
 *      recommendations (rewrite-text, duration-adjust, template-swap,
 *      theme-shift). Conservative: structural changes (split-scene,
 *      merge-scene, add-hook) are surfaced but not auto-applied.
 *
 *   3. `--vary-hook` — generate 3 alternative hook variants via the
 *      planner, score each, replace scene 0 with the winner.
 *
 *   4. `--apply-themes` — sentiment-driven bgOverride atmospheres applied
 *      to chart-scene / chart-payoff scenes whose sentiment matches an
 *      atmosphere.
 *
 * Every apply mode writes the edited script back to script.json and
 * shows a diff. Use `--dry-run` to see what would change without
 * persisting.
 *
 * Use this in the iteration loop AFTER `hyperframes script` (which plans
 * + synths) but BEFORE `hyperframes render` (which costs ~30 minutes of
 * compute). Each call is ~$0.01 for the score, +~$0.05 for --vary-hook.
 *
 * The post-render Gemini retention review (`hyperframes optimize`) is
 * a complementary system — it scores the rendered VIDEO frames; this
 * scores the SCRIPT TEXT + visual rhythm. Different views, different
 * prices.
 */

import { defineCommand } from "citty";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Example } from "./_examples.js";
import { c } from "../ui/colors.js";
import { errorBox } from "../ui/format.js";
import { loadAnthropicKey, ANTHROPIC_KEY_NAME } from "@hyperframes/core/anthropic";
import {
  scoreScript,
  scoreVisualStoryboard,
  applyRecommendations,
  applySentimentTheming,
  varyHookAndScore,
  applyHookWinner,
  SCORER_DEFAULT_MODEL,
  BUILTIN_TEMPLATES,
  THEMES,
  type Script,
  type ScriptScore,
  type VisualScore,
  type ApplyReport,
  type SentimentThemingReport,
  type VaryHookResult,
} from "@hyperframes/core/script";

const SCRIPT_FILE = "script.json";
const PLANNED_FILE = "script.generated.json";

export const examples: Example[] = [
  ["Score the planned script in the current dir", "hyperframes score"],
  ["Score a specific project", "hyperframes score ./my-video"],
  ["Output structured JSON instead of pretty text", "hyperframes score --json"],
  [
    "Apply the top 3 high-confidence recommendations and write back to script.json",
    "hyperframes score --apply-top 3",
  ],
  [
    "Generate 3 hook variants, score each, replace scene 0 with the winner",
    "hyperframes score --vary-hook",
  ],
  [
    "Apply sentiment-driven bgOverrides to chart scenes (skips light themes)",
    "hyperframes score --apply-themes",
  ],
  ["Show what would change without writing", "hyperframes score --apply-top 5 --dry-run"],
];

export default defineCommand({
  meta: {
    name: "score",
    description: "Score + auto-apply retention recommendations on a planned script (Claude Haiku)",
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
    "apply-top": {
      type: "string",
      description:
        "Apply the top N high-confidence recommendations (rewrite-text, duration-adjust, template-swap, theme-shift). Writes back to script.json.",
    },
    "vary-hook": {
      type: "boolean",
      description:
        "Generate 3 alternative hook variants, score each, replace scene 0 with the winner. Writes back to script.json.",
      default: false,
    },
    "apply-themes": {
      type: "boolean",
      description:
        "Apply sentiment-driven bgOverride atmospheres to chart scenes. Writes back to script.json.",
      default: false,
    },
    "dry-run": {
      type: "boolean",
      description: "Show what would change without writing back to disk",
      default: false,
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
    const { script: loaded, sourceFile } = loadScriptWithPath(projectDir);
    if (!loaded) {
      console.error(
        errorBox(
          `No ${SCRIPT_FILE} or ${PLANNED_FILE} in ${projectDir}. Run \`hyperframes script\` first.`,
        ),
      );
      process.exit(1);
    }

    let workingScript = loaded;
    const dryRun = args["dry-run"] === true;
    const applyTopN = args["apply-top"] ? Number(args["apply-top"]) : null;
    const varyHook = args["vary-hook"] === true;
    const applyThemes = args["apply-themes"] === true;

    // ── Step 1: Vary the hook FIRST (changes scene 0 before scoring) ────
    let varyResult: VaryHookResult | null = null;
    if (varyHook) {
      if (!args.json) console.log(c.dim(`Generating 3 hook variants + scoring each…`));
      varyResult = await varyHookAndScore(workingScript, { apiKey });
      workingScript = applyHookWinner(workingScript, varyResult.winner);
      if (!args.json) {
        console.log(
          c.bold(
            `🏆 Hook winner: "${varyResult.winner.label}" (predicted ${varyResult.winner.score.predictedRetention}%)`,
          ),
        );
      }
    }

    // ── Step 2: Score (Haiku + visual) ──────────────────────────────────
    if (!args.json) {
      console.log(c.dim(`Scoring ${workingScript.scenes.length} scenes via Claude Haiku…`));
    }
    const haikuScore = await scoreScript(workingScript, {
      apiKey,
      model: args.model || undefined,
    });
    const visualScore = scoreVisualStoryboard(workingScript);

    // ── Step 3: Apply sentiment theming if requested ────────────────────
    let themeReport: SentimentThemingReport | null = null;
    if (applyThemes) {
      const result = applySentimentTheming(workingScript, {
        sceneScores: haikuScore.scenes,
      });
      workingScript = result.script;
      themeReport = result.report;
    }

    // ── Step 4: Apply top-N recommendations if requested ────────────────
    let applyReport: ApplyReport | null = null;
    if (applyTopN != null && Number.isFinite(applyTopN) && applyTopN > 0) {
      const knownTemplates = new Set(BUILTIN_TEMPLATES.map((t) => t.id));
      const knownThemes = new Set(Object.keys(THEMES));
      const result = applyRecommendations(workingScript, haikuScore.recommendations, {
        topN: applyTopN,
        minConfidence: "high",
        knownTemplates,
        knownThemes,
      });
      workingScript = result.script;
      applyReport = result.report;
    }

    // ── Step 5: Write back if any apply mode is enabled ─────────────────
    const anyApply = varyHook || applyThemes || (applyTopN != null && applyTopN > 0);
    let wroteFile = false;
    if (anyApply && !dryRun) {
      writeFileSync(join(projectDir, sourceFile), JSON.stringify(workingScript, null, 2), "utf8");
      wroteFile = true;
    }

    // ── Output ──────────────────────────────────────────────────────────
    if (args.json) {
      console.log(
        JSON.stringify(
          {
            haikuScore,
            visualScore,
            varyResult,
            themeReport,
            applyReport,
            wroteFile,
            scriptFile: anyApply ? sourceFile : null,
          },
          null,
          2,
        ),
      );
      return;
    }
    prettyPrint(workingScript, haikuScore, visualScore);
    if (varyResult) prettyPrintVaryReport(varyResult);
    if (themeReport) prettyPrintThemeReport(themeReport);
    if (applyReport) prettyPrintApplyReport(applyReport);
    if (wroteFile) {
      console.log(c.bold(`✏️  Wrote ${sourceFile}`));
    } else if (anyApply && dryRun) {
      console.log(c.dim(`(dry-run — no file written)`));
    }
  },
});

function loadScriptWithPath(projectDir: string): { script: Script | null; sourceFile: string } {
  for (const file of [PLANNED_FILE, SCRIPT_FILE]) {
    const path = join(projectDir, file);
    if (!existsSync(path)) continue;
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as Script;
      if (raw && Array.isArray(raw.scenes)) return { script: raw, sourceFile: file };
    } catch {
      // try next
    }
  }
  return { script: null, sourceFile: SCRIPT_FILE };
}

function prettyPrint(script: Script, result: ScriptScore, visual: VisualScore): void {
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
  // Visual storyboard sub-score
  const visualEmoji = visual.overall >= 85 ? "🟢" : visual.overall >= 70 ? "🟡" : "🔴";
  console.log(
    `${visualEmoji} ${c.bold(`Visual rhythm: ${visual.overall}/100`)}   ` +
      c.dim(
        `tpl=${visual.variety.template}/10 atm=${visual.variety.atmosphere}/10 palette=${visual.variety.palette}/10 rhythm=${visual.rhythm}/10 opening=${visual.openingDensity}/10`,
      ),
  );
  if (visual.issues.length > 0) {
    for (const issue of visual.issues.slice(0, 3)) {
      console.log(c.dim(`   ${issue.type}: ${issue.message}`));
    }
  }
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

function prettyPrintVaryReport(result: VaryHookResult): void {
  console.log(c.bold(`Hook variants:`));
  for (const v of result.variants) {
    const isWinner = v === result.winner;
    const marker = isWinner ? "🏆" : "  ";
    console.log(
      `  ${marker} ${v.score.predictedRetention}% ${c.dim(`(hook=${v.score.hookStrength}/10)`)} ` +
        `${c.bold(v.label)} — ${v.scene.template}`,
    );
    if (v.reasoning) console.log(c.dim(`         ${v.reasoning}`));
  }
  console.log("");
}

function prettyPrintThemeReport(report: SentimentThemingReport): void {
  if (report.changes.length === 0 && report.skipped.length === 0) return;
  console.log(c.bold(`Sentiment theming:`));
  for (const change of report.changes) {
    console.log(
      c.dim(`  ✓ ${change.sceneId} (${change.sentiment}) ← ${change.bgApplied?.slice(0, 60)}…`),
    );
  }
  for (const skip of report.skipped) {
    console.log(c.dim(`  · ${skip.sceneId} skipped — ${skip.reason}`));
  }
  console.log("");
}

function prettyPrintApplyReport(report: ApplyReport): void {
  console.log(
    c.bold(`Auto-apply: ${report.applied.length} applied, ${report.skipped.length} skipped`),
  );
  for (const a of report.applied) {
    console.log(c.dim(`  ✓ ${a.recommendation.type} ${a.recommendation.sceneId}: ${a.diff}`));
  }
  for (const s of report.skipped) {
    console.log(
      c.dim(
        `  · ${s.recommendation.type} ${s.recommendation.sceneId}: ${s.skipReason ?? "skipped"}`,
      ),
    );
  }
  console.log("");
}
