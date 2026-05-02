/**
 * `hyperframes optimize` — closed-loop retention optimizer.
 *
 * Iteratively improves an already-rendered video by letting Gemini Flash
 * watch each render, propose surgical patches (text edits, template
 * swaps, prop tweaks, scene splits, border fixes), apply them, re-synth
 * the affected scenes, re-assemble, re-render, and re-review. Loops
 * until retention hits the target, max iterations is reached, or a
 * regression forces a revert to the previous best.
 *
 * Why a CLI command (vs a studio button): each iteration takes ~30 min
 * of render compute, so the user wants to kick this off from a terminal,
 * walk away, and find the final mp4 ready when they come back. The
 * studio path can wrap this same module later — the optimizer logic
 * lives in `@hyperframes/core/script`.
 */

import { defineCommand } from "citty";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Example } from "./_examples.js";
import { c } from "../ui/colors.js";
import { errorBox } from "../ui/format.js";
import { loadElevenLabsKey, ELEVENLABS_KEY_NAME } from "@hyperframes/core/elevenlabs";
import { loadGeminiKey, GEMINI_KEY_NAME } from "@hyperframes/core/gemini";
import {
  assembleMaster,
  BUILTIN_TEMPLATES,
  listAllAtmosphereIds,
  loadDesignBrief,
  optimizeRetention,
  resolveProjectTokens,
  synthesizeScript,
  type IterationReport,
  type OptimizeRetentionResult,
  type Script,
} from "@hyperframes/core/script";
import { CostLogger, loggerSink } from "@hyperframes/core";
import { loadProducer } from "../utils/producer.js";

const SCRIPT_FILE = "script.json";
const PLANNED_FILE = "script.generated.json";

export const examples: Example[] = [
  ["Run the optimizer on the most recent render", "hyperframes optimize ./my-video"],
  ["Set a higher retention target", "hyperframes optimize ./my-video --target 95"],
  ["Cap iterations to 1 (single-pass refine)", "hyperframes optimize ./my-video --max-iter 1"],
  [
    "Render only — skip the loop and just report what Gemini would change",
    "hyperframes optimize ./my-video --dry-run",
  ],
];

export default defineCommand({
  meta: {
    name: "optimize",
    description: "Close the Gemini retention loop on a rendered project",
  },
  args: {
    project: { type: "positional", description: "Project directory", required: true },
    target: {
      type: "string",
      description: "Target retention score 0-100 (default 90)",
    },
    "max-iter": {
      type: "string",
      description: "Max optimizer iterations (default 3)",
    },
    "max-patches": {
      type: "string",
      description: "Max patches Gemini can propose per iteration (default 6)",
    },
    "dry-run": {
      type: "boolean",
      description: "Skip the apply/synth/render/review loop — just propose patches",
      default: false,
    },
    quality: {
      type: "string",
      description: "Render quality (draft|standard|high). Default standard.",
    },
    fps: { type: "string", description: "Render fps. Default 30." },
  },
  async run({ args }) {
    const projectDir = resolve(args.project);
    if (!existsSync(projectDir)) {
      errorBox("Project does not exist", projectDir);
      process.exit(1);
    }

    const geminiKey = loadGeminiKey(projectDir);
    if (!geminiKey) {
      errorBox(
        "Gemini API key not found",
        `Set ${GEMINI_KEY_NAME} in <project>/.env, ~/.hyperframes/.env, or your shell env.`,
      );
      process.exit(1);
    }
    const elKey = loadElevenLabsKey(projectDir);
    if (!elKey) {
      errorBox(
        "ElevenLabs API key not found",
        `Set ${ELEVENLABS_KEY_NAME} — the optimizer re-synths scene narration on text edits.`,
      );
      process.exit(1);
    }

    // Load script.json + the most recent rendered mp4. The optimizer
    // operates on the SCRIPT (because re-synth changes audio), and uses
    // the mp4 only as the visual review surface.
    const scriptPath = join(projectDir, SCRIPT_FILE);
    if (!existsSync(scriptPath)) {
      errorBox(
        "No script.json",
        `Run "hyperframes script all <input>" first so the optimizer has something to refine.`,
      );
      process.exit(1);
    }
    let script: Script;
    try {
      script = JSON.parse(readFileSync(scriptPath, "utf-8")) as Script;
    } catch (err) {
      errorBox("script.json is unreadable", err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    const initialMp4 = findMostRecentRender(projectDir);
    if (!initialMp4) {
      errorBox(
        "No rendered mp4 found",
        `The optimizer reviews an existing render. Run "hyperframes render ${args.project}" first.`,
      );
      process.exit(1);
    }

    const target = args.target ? parseFloat(args.target) : 90;
    const maxIterations = args["max-iter"] ? parseInt(args["max-iter"], 10) : 3;
    const maxPatches = args["max-patches"] ? parseInt(args["max-patches"], 10) : 6;
    // Producer's createRenderJob locks fps to 24|30|60 and quality to a
    // narrow union — narrow them here so TS sees the literal types.
    const quality: "draft" | "standard" | "high" =
      args.quality === "draft" || args.quality === "standard" || args.quality === "high"
        ? args.quality
        : "standard";
    const fps: 24 | 30 | 60 = ((): 24 | 30 | 60 => {
      const n = args.fps ? parseInt(args.fps, 10) : 30;
      return n === 24 || n === 60 ? n : 30;
    })();

    console.log("");
    console.log(c.accent("hyperframes optimize"));
    console.log(c.dim(`  project:      ${projectDir}`));
    console.log(c.dim(`  baseline mp4: ${initialMp4}`));
    console.log(c.dim(`  scenes:       ${script.scenes.length}`));
    console.log(c.dim(`  target:       ${target}/100`));
    console.log(c.dim(`  max iter:     ${maxIterations}`));
    console.log("");

    if (args["dry-run"]) {
      console.log(c.dim("Dry run — proposing patches without applying."));
      console.log("");
    }

    // Set up the costSink so per-iteration Gemini + render spend hits
    // the project's cost log under script.optimizer.* ops.
    const costSink = loggerSink(new CostLogger(projectDir));
    const onCostEvent = costSink;

    // Wire up the injected callbacks. The optimizer module is decoupled
    // from the producer; the CLI provides the synth/assemble/render
    // implementations using the existing core + producer entry points.
    const producer = await loadProducer();

    const result = await optimizeRetention({
      projectDir,
      initialMp4Path: initialMp4,
      initialScript: script,
      geminiApiKey: geminiKey,
      targetRetention: target,
      maxIterations: args["dry-run"] ? 0 : maxIterations,
      maxPatchesPerIteration: maxPatches,
      knownTemplates: BUILTIN_TEMPLATES.map((t) => t.id),
      knownAtmospheres: listAllAtmosphereIds(),
      onCostEvent,
      onIteration: (report) => printIteration(report),
      runSynth: async (script, syntArgs) => {
        // Reuse the existing audio cache — synthesizeScript already
        // hashes per-scene narration and skips unchanged scenes.
        // dirtySceneIds is informational; the cache machinery handles
        // the actual cache hit/miss internally.
        const planned = await synthesizeScript(script, {
          apiKey: elKey,
          projectDir: syntArgs.projectDir,
          probeDurationSeconds: await loadAudioProbe(),
          fallbackVoiceId: script.meta.voiceId,
          onCostEvent,
        });
        // Persist the new planned script + raw script — same convention
        // as `hyperframes script all`.
        writeJson(join(syntArgs.projectDir, SCRIPT_FILE), script);
        writeJson(join(syntArgs.projectDir, PLANNED_FILE), planned);
        return planned;
      },
      runAssemble: async (planned, asmArgs) => {
        const tokens = resolveProjectTokens(
          asmArgs.projectDir,
          loadDesignBrief(asmArgs.projectDir),
        );
        const out = assembleMaster(planned, {
          projectDir: asmArgs.projectDir,
          tokens,
        });
        return resolve(asmArgs.projectDir, out.outFile);
      },
      runRender: async (rndArgs) => {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const outputPath = resolve(rndArgs.projectDir, "renders", `optimize-${stamp}.mp4`);
        mkdirSync(dirname(outputPath), { recursive: true });
        const job = producer.createRenderJob({
          fps,
          quality,
          format: "mp4",
        });
        await producer.executeRenderJob(job, rndArgs.projectDir, outputPath);
        return outputPath;
      },
    });

    printSummary(result);
  },
});

function printIteration(report: IterationReport): void {
  console.log("");
  console.log(
    c.accent(`◇  iteration ${report.iteration}`) +
      c.dim(
        `  retention=${report.review.overallRetentionScore}/100  brand=${report.review.brandConsistency.score}/100`,
      ),
  );
  if (report.strategy) {
    console.log(c.dim(`   strategy: ${report.strategy}`));
  }
  if (report.proposedPatches.length > 0) {
    console.log(c.dim(`   ${report.proposedPatches.length} patches → next iteration:`));
    for (const p of report.proposedPatches) {
      const tag =
        p.action === "editText"
          ? "✏️  text"
          : p.action === "swapTemplate"
            ? "🎬 template"
            : p.action === "addProp"
              ? "🎯 prop"
              : p.action === "splitScene"
                ? "✂️  split"
                : "🖼️ borders";
      const delta =
        typeof p.estimatedRetentionDelta === "number"
          ? c.dim(
              ` (~${p.estimatedRetentionDelta >= 0 ? "+" : ""}${p.estimatedRetentionDelta} pts)`,
            )
          : "";
      console.log(`     ${tag}  ${p.sceneId}${delta}  — ${p.why}`);
    }
  }
  if (report.rejectedPatches.length > 0) {
    console.log(c.dim(`   ${report.rejectedPatches.length} patches rejected:`));
    for (const r of report.rejectedPatches.slice(0, 3)) {
      console.log(c.dim(`     · ${r.reason}`));
    }
  }
  const t = report.timings;
  const wallMs =
    (t.uploadMs ?? 0) +
    (t.reviewMs ?? 0) +
    (t.proposeMs ?? 0) +
    (t.applyMs ?? 0) +
    (t.synthMs ?? 0) +
    (t.assembleMs ?? 0) +
    (t.renderMs ?? 0);
  if (wallMs > 0) {
    console.log(c.dim(`   ⏱  wall ${Math.round(wallMs / 1000)}s`));
  }
}

function printSummary(result: OptimizeRetentionResult): void {
  console.log("");
  console.log(c.success("◇  optimization complete"));
  console.log(c.dim(`  iterations:      ${result.iterations.length}`));
  console.log(c.dim(`  final retention: ${result.finalRetention}/100`));
  console.log(c.dim(`  hit target:      ${result.hitTarget ? "yes" : "no"}`));
  console.log(c.dim(`  stop reason:     ${result.stopReason}`));
  console.log(c.dim(`  final mp4:       ${result.finalMp4Path}`));

  // Show the trajectory line so the user sees the per-iteration arc
  // at a glance — useful when retention oscillates.
  const trajectory = result.iterations
    .map((i) => `${i.iteration}: ${i.review.overallRetentionScore}`)
    .join(" → ");
  console.log(c.dim(`  trajectory:      ${trajectory}`));
}

function findMostRecentRender(projectDir: string): string | null {
  const rendersDir = join(projectDir, "renders");
  if (!existsSync(rendersDir)) return null;
  const entries = readdirSync(rendersDir);
  const mp4s = entries.filter((f: string) => f.toLowerCase().endsWith(".mp4"));
  if (mp4s.length === 0) return null;
  const withMtime = mp4s.map((f: string) => ({
    f,
    mtime: statSync(join(rendersDir, f)).mtimeMs,
  }));
  withMtime.sort((a, b) => b.mtime - a.mtime);
  return withMtime[0] ? join(rendersDir, withMtime[0].f) : null;
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

async function loadAudioProbe() {
  const mod = await import("@hyperframes/engine");
  return async (filePath: string) => {
    const m = await mod.extractAudioMetadata(filePath);
    return m.durationSeconds;
  };
}

// Suppress "imported but unused" linter complaints on conditional imports.
void statSync;
