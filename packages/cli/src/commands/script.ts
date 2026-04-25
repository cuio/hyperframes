import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as clack from "@clack/prompts";
import { c } from "../ui/colors.js";
import { errorBox } from "../ui/format.js";
import { loadAnthropicKey, ANTHROPIC_KEY_NAME } from "@hyperframes/core/anthropic";
import {
  loadElevenLabsKey,
  ELEVENLABS_KEY_NAME,
  readDefaultVoiceId,
} from "@hyperframes/core/elevenlabs";
import {
  planScript,
  synthesizeScript,
  assembleMaster,
  loadDesignBrief,
  resolveProjectTokens,
  ScriptPlannerError,
  type Script,
} from "@hyperframes/core/script";

export const examples: Example[] = [
  [
    "Plan a script with the AI director",
    "hyperframes script plan ./narration.md --project ./my-video",
  ],
  ["Generate audio + assemble master", "hyperframes script generate --project ./my-video"],
  [
    "Plan + generate end-to-end",
    "hyperframes script all ./narration.md --project ./my-video --voice <voiceId>",
  ],
  ["Re-render index.html only (skip audio)", "hyperframes script assemble --project ./my-video"],
  [
    "Use a different planner model",
    "hyperframes script plan ./n.md --project ./my-video --model claude-opus-4-7",
  ],
];

const PLAN_FILE = "script.json";
const PLANNED_FILE = "script.generated.json";

function readScript(projectDir: string): Script {
  const path = resolve(projectDir, PLAN_FILE);
  if (!existsSync(path)) {
    errorBox("No script.json", `Run "hyperframes script plan ..." first to create ${path}.`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, "utf-8")) as Script;
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

const planSubcommand = defineCommand({
  meta: { name: "plan", description: "Plan a script (md/txt) into scenes via Claude" },
  args: {
    input: { type: "positional", description: "Path to a .md or .txt script", required: true },
    project: { type: "string", description: "Project directory", default: "." },
    model: { type: "string", description: "Anthropic model (default: claude-sonnet-4-6)" },
    voice: { type: "string", description: "Default voice id for the script" },
    target: { type: "string", description: "Target overall duration in seconds (default: 60)" },
    "max-scene": { type: "string", description: "Max scene duration in seconds (default: 9)" },
    audience: { type: "string", description: "Audience hint (e.g. 'engineers')" },
    tone: { type: "string", description: "Tone hint (e.g. 'urgent, technical')" },
    title: { type: "string", description: "Working title" },
    json: { type: "boolean", description: "Output result as JSON", default: false },
  },
  async run({ args }) {
    const projectDir = resolve(args.project);
    const apiKey = loadAnthropicKey(projectDir);
    if (!apiKey) {
      errorBox(
        "Anthropic API key not found",
        `Set ${ANTHROPIC_KEY_NAME} in <project>/.env, ~/.hyperframes/.env, or your shell env.`,
      );
      process.exit(1);
    }
    const inputPath = resolve(args.input);
    if (!existsSync(inputPath)) {
      errorBox("Script file not found", inputPath);
      process.exit(1);
    }
    const text = readFileSync(inputPath, "utf-8").trim();
    if (!text) {
      errorBox("Script file is empty", inputPath);
      process.exit(1);
    }

    const spin = args.json ? null : clack.spinner();
    spin?.start(
      `Planning ${c.accent(args.input)} with ${c.accent(args.model ?? "claude-sonnet-4-6")}...`,
    );
    try {
      const script = await planScript(text, {
        apiKey,
        model: args.model,
        targetDurationSeconds: args.target ? parseFloat(args.target) : undefined,
        maxSceneDuration: args["max-scene"] ? parseFloat(args["max-scene"]) : undefined,
        meta: {
          title: args.title,
          audience: args.audience,
          tone: args.tone,
          voiceId: args.voice,
        },
        designBrief: loadDesignBrief(projectDir) ?? undefined,
      });
      writeJson(resolve(projectDir, PLAN_FILE), script);
      if (args.json) {
        console.log(JSON.stringify({ ok: true, script, planFile: resolve(projectDir, PLAN_FILE) }));
      } else {
        spin?.stop(c.success(`Planned ${c.accent(String(script.scenes.length))} scenes`));
        console.log(c.dim(`  Wrote → ${resolve(projectDir, PLAN_FILE)}`));
        for (const scene of script.scenes) {
          console.log(
            `  ${c.dim(scene.id)} ${c.accent(scene.template.padEnd(18))} ${scene.hook ? c.dim("[hook]") : "      "} ${trimText(scene.text, 60)}`,
          );
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (args.json) console.log(JSON.stringify({ ok: false, error: msg }));
      else spin?.stop(c.error(`Planning failed: ${msg}`));
      process.exit(err instanceof ScriptPlannerError ? 2 : 1);
    }
  },
});

const generateSubcommand = defineCommand({
  meta: {
    name: "generate",
    description: "Synthesize audio for the saved script.json and assemble index.html",
  },
  args: {
    project: { type: "string", description: "Project directory", default: "." },
    out: { type: "string", description: "Output HTML file (default: index.html)" },
    voice: { type: "string", description: "Override script.meta.voiceId" },
    "voice-model": {
      type: "string",
      description: "ElevenLabs model id (default: eleven_turbo_v2_5)",
    },
    json: { type: "boolean", description: "JSON output", default: false },
  },
  async run({ args }) {
    const projectDir = resolve(args.project);
    const elKey = loadElevenLabsKey(projectDir);
    if (!elKey) {
      errorBox(
        "ElevenLabs API key not found",
        `Set ${ELEVENLABS_KEY_NAME} in <project>/.env, ~/.hyperframes/.env, or your shell env.`,
      );
      process.exit(1);
    }

    const script = readScript(projectDir);
    const projectDefaultVoice = readDefaultVoiceId(projectDir);
    if (args.voice) {
      script.meta = { ...script.meta, voiceId: args.voice };
    } else if (!script.meta.voiceId && projectDefaultVoice) {
      script.meta = { ...script.meta, voiceId: projectDefaultVoice };
    }
    if (!script.meta.voiceId) {
      errorBox(
        "No voice selected",
        "Pass --voice <voiceId>, set tts.defaultVoiceId in hyperframes.json, or pick one in the Studio Voices tab.",
      );
      process.exit(1);
    }

    const probe = await loadAudioProbe();
    const spin = args.json ? null : clack.spinner();
    spin?.start("Synthesizing scene audio...");
    let processed = 0;
    let cachedCount = 0;
    try {
      const planned = await synthesizeScript(script, {
        apiKey: elKey,
        projectDir,
        modelId: args["voice-model"],
        probeDurationSeconds: probe,
        onScene: ({ scene, cached, skipped }) => {
          processed++;
          if (cached) cachedCount++;
          spin?.message(
            `${cached ? "Cached" : skipped ? "Silent" : "Synthesized"} ${scene.id} (${processed}/${script.scenes.length})`,
          );
        },
      });
      writeJson(resolve(projectDir, PLANNED_FILE), planned);
      const result = assembleMaster(planned, {
        projectDir,
        outFile: args.out,
        tokens: resolveProjectTokens(projectDir, loadDesignBrief(projectDir)),
      });
      if (args.json) {
        console.log(JSON.stringify({ ok: true, planned, result, cached: cachedCount }));
      } else {
        spin?.stop(
          c.success(
            `Generated ${c.accent(String(planned.scenes.length))} scenes (${cachedCount} cached) — ${c.accent(planned.totalDurationSeconds.toFixed(2) + "s")}`,
          ),
        );
        console.log(c.dim(`  Master → ${resolve(projectDir, result.outFile)}`));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (args.json) console.log(JSON.stringify({ ok: false, error: msg }));
      else spin?.stop(c.error(`Generation failed: ${msg}`));
      process.exit(1);
    }
  },
});

const assembleSubcommand = defineCommand({
  meta: {
    name: "assemble",
    description: "Re-emit index.html from the saved script.generated.json (no audio re-synth)",
  },
  args: {
    project: { type: "string", description: "Project directory", default: "." },
    out: { type: "string", description: "Output HTML file (default: index.html)" },
  },
  async run({ args }) {
    const projectDir = resolve(args.project);
    const path = resolve(projectDir, PLANNED_FILE);
    if (!existsSync(path)) {
      errorBox("No script.generated.json", `Run "hyperframes script generate" first.`);
      process.exit(1);
    }
    const planned = JSON.parse(readFileSync(path, "utf-8"));
    const result = assembleMaster(planned, {
      projectDir,
      outFile: args.out,
      tokens: resolveProjectTokens(projectDir, loadDesignBrief(projectDir)),
    });
    console.log(
      c.success(
        `Wrote ${resolve(projectDir, result.outFile)} (${result.totalDurationSeconds.toFixed(2)}s)`,
      ),
    );
  },
});

const allSubcommand = defineCommand({
  meta: { name: "all", description: "Plan + generate end-to-end (script → audio → master)" },
  args: {
    input: { type: "positional", description: "Path to a .md or .txt script", required: true },
    project: { type: "string", description: "Project directory", default: "." },
    model: { type: "string", description: "Anthropic planner model" },
    voice: {
      type: "string",
      description: "Voice id (required unless script.meta.voiceId is set later)",
    },
    target: { type: "string", description: "Target overall duration in seconds" },
    audience: { type: "string", description: "Audience hint" },
    tone: { type: "string", description: "Tone hint" },
    title: { type: "string", description: "Working title" },
    out: { type: "string", description: "Output HTML file (default: index.html)" },
  },
  async run({ args }) {
    const projectDir = resolve(args.project);
    const anthropicKey = loadAnthropicKey(projectDir);
    const elKey = loadElevenLabsKey(projectDir);
    if (!anthropicKey) {
      errorBox("Anthropic key missing", `Set ${ANTHROPIC_KEY_NAME} first.`);
      process.exit(1);
    }
    if (!elKey) {
      errorBox("ElevenLabs key missing", `Set ${ELEVENLABS_KEY_NAME} first.`);
      process.exit(1);
    }
    const inputPath = resolve(args.input);
    if (!existsSync(inputPath)) {
      errorBox("Script file not found", inputPath);
      process.exit(1);
    }
    const text = readFileSync(inputPath, "utf-8").trim();
    const projectDefaultVoice = readDefaultVoiceId(projectDir);
    const effectiveVoice = args.voice ?? projectDefaultVoice ?? undefined;
    if (!effectiveVoice) {
      errorBox(
        "No voice selected",
        "Pass --voice <voiceId>, set tts.defaultVoiceId in hyperframes.json, or pick one in the Studio Voices tab.",
      );
      process.exit(1);
    }

    const spin = clack.spinner();
    spin.start("Planning with AI...");
    try {
      const script = await planScript(text, {
        apiKey: anthropicKey,
        model: args.model,
        targetDurationSeconds: args.target ? parseFloat(args.target) : undefined,
        meta: {
          title: args.title,
          audience: args.audience,
          tone: args.tone,
          voiceId: effectiveVoice,
        },
        designBrief: loadDesignBrief(projectDir) ?? undefined,
      });
      writeJson(resolve(projectDir, PLAN_FILE), script);
      spin.message(`Planned ${script.scenes.length} scenes — synthesizing audio...`);

      const probe = await loadAudioProbe();
      const planned = await synthesizeScript(script, {
        apiKey: elKey,
        projectDir,
        probeDurationSeconds: probe,
        fallbackVoiceId: effectiveVoice,
        onScene: ({ scene, cached }) => {
          spin.message(`${cached ? "Cached" : "Synth"} ${scene.id}...`);
        },
      });
      writeJson(resolve(projectDir, PLANNED_FILE), planned);
      const result = assembleMaster(planned, {
        projectDir,
        outFile: args.out,
        tokens: resolveProjectTokens(projectDir, loadDesignBrief(projectDir)),
      });
      spin.stop(
        c.success(
          `${planned.scenes.length} scenes, ${planned.totalDurationSeconds.toFixed(2)}s → ${resolve(projectDir, result.outFile)}`,
        ),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      spin.stop(c.error(msg));
      process.exit(1);
    }
  },
});

export default defineCommand({
  meta: {
    name: "script",
    description:
      "Turn a written script into a video: AI scene planner + ElevenLabs TTS + master HTML",
  },
  subCommands: {
    plan: planSubcommand,
    generate: generateSubcommand,
    assemble: assembleSubcommand,
    all: allSubcommand,
  },
});

function trimText(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
