import { callStructuredTool, AnthropicError, DEFAULT_ANTHROPIC_MODEL } from "../anthropic/index.js";
import type { ToolDefinition } from "../anthropic/index.js";
import { RETENTION_PLAYBOOK } from "./playbook.js";
import { BUILTIN_TEMPLATES } from "./templates/index.js";
import { BUILTIN_CHARTS } from "./charts/index.js";
import type { Script, SceneRef, ScriptMeta } from "./types.js";

export interface PlanOptions {
  apiKey: string;
  model?: string;
  /** Optional context overrides — passed verbatim into the meta of the result. */
  meta?: Partial<ScriptMeta>;
  /** Soft target overall duration in seconds (default 60). */
  targetDurationSeconds?: number;
  /** Maximum scene duration the planner is allowed to emit (default 9). */
  maxSceneDuration?: number;
  /** Temperature for the planner model. Default 0.7. */
  temperature?: number;
  /**
   * Optional design-system brief (e.g. contents of <project>/DESIGN.md).
   * Appended to the planner's system prompt so it can pick props that align
   * with the brand voice — accent words for highlight, suggested chart
   * styles, tone matching, etc.
   */
  designBrief?: string;
}

interface PlanToolInput {
  meta?: {
    title?: string;
    audience?: string;
    tone?: string;
  };
  scenes: Array<{
    id: string;
    text: string;
    template: string;
    props: Record<string, unknown>;
    hook?: boolean;
    durationHint?: number;
    voiceId?: string;
  }>;
}

function buildToolDefinition(maxSceneDuration: number): ToolDefinition {
  const templateEnum = BUILTIN_TEMPLATES.map((t) => t.id);
  const templateCatalog = BUILTIN_TEMPLATES.map((t) => ({
    id: t.id,
    description: t.description,
    whenToUse: t.whenToUse,
    propsSchema: t.propsSchema,
    durationRange: t.durationRange,
  }));
  const chartCatalog = BUILTIN_CHARTS.map((c) => ({
    id: c.id,
    description: c.description,
    whenToUse: c.whenToUse,
    propsSchema: c.propsSchema,
  }));
  return {
    name: "plan_video",
    description:
      "Return a scene-by-scene plan for the video.\n\n" +
      "TEMPLATE CATALOG (pick template id from this list):\n" +
      JSON.stringify(templateCatalog, null, 2) +
      "\n\nCHART CATALOG (when template is chart-scene, the props.chart.type must be one of these and props.chart.props must match its propsSchema):\n" +
      JSON.stringify(chartCatalog, null, 2),
    input_schema: {
      type: "object",
      properties: {
        meta: {
          type: "object",
          properties: {
            title: { type: "string", description: "Inferred or extracted video title" },
            audience: {
              type: "string",
              description: "One-line description of who this video is for",
            },
            tone: {
              type: "string",
              description: "Adjectives describing the tone, e.g. 'urgent, technical'",
            },
          },
        },
        scenes: {
          type: "array",
          minItems: 2,
          items: {
            type: "object",
            properties: {
              id: {
                type: "string",
                pattern: "^s[0-9]{2,}$",
                description: "Stable id like s01, s02. Must be sequential.",
              },
              text: {
                type: "string",
                description: "Spoken narration for this scene. Empty for visual-only scenes.",
              },
              template: { type: "string", enum: templateEnum },
              props: {
                type: "object",
                description: "Props matching the chosen template's propsSchema",
              },
              hook: {
                type: "boolean",
                description: "True for scenes in the first ~30s",
              },
              durationHint: {
                type: "number",
                minimum: 1.5,
                maximum: maxSceneDuration,
                description: "Soft duration estimate in seconds",
              },
              voiceId: {
                type: "string",
                description: "Optional override of the script-level voice",
              },
            },
            required: ["id", "text", "template", "props"],
          },
        },
      },
      required: ["scenes"],
    },
  };
}

function buildUserMessage(rawScript: string, opts: PlanOptions): string {
  const target = opts.targetDurationSeconds ?? 60;
  const lines: string[] = [];
  lines.push("# Script to plan");
  lines.push("");
  lines.push(rawScript.trim());
  lines.push("");
  lines.push("# Constraints");
  lines.push(`- Target overall duration: about ${target} seconds.`);
  lines.push(`- Maximum single-scene duration: ${opts.maxSceneDuration ?? 9} seconds.`);
  if (opts.meta?.audience) lines.push(`- Audience: ${opts.meta.audience}`);
  if (opts.meta?.tone) lines.push(`- Tone: ${opts.meta.tone}`);
  if (opts.meta?.title) lines.push(`- Working title: ${opts.meta.title}`);
  lines.push("");
  lines.push(
    "Use the plan_video tool. Output sequential ids starting at s01. Mark first ~30s scenes hook=true.",
  );
  return lines.join("\n");
}

export class ScriptPlannerError extends Error {
  cause?: Error;
  constructor(message: string, cause?: Error) {
    super(message);
    this.name = "ScriptPlannerError";
    this.cause = cause;
  }
}

/**
 * Plan a video from raw script text. Returns a Script DSL ready for audio
 * synthesis. Validates that every chosen template id is real and that scene
 * ids are sequential.
 */
export async function planScript(rawScript: string, opts: PlanOptions): Promise<Script> {
  if (!rawScript.trim()) {
    throw new ScriptPlannerError("Script is empty");
  }

  const tool = buildToolDefinition(opts.maxSceneDuration ?? 9);
  const user = buildUserMessage(rawScript, opts);

  const system = opts.designBrief
    ? `${RETENTION_PLAYBOOK}\n\n# Visual identity (from project DESIGN.md)\n\n${opts.designBrief.trim()}\n\nMatch this design language: pick accentWord values that make sense given the palette, prefer the tone described above, keep title phrasing in the project's voice.`
    : RETENTION_PLAYBOOK;

  let result: PlanToolInput;
  try {
    const { result: r } = await callStructuredTool<PlanToolInput>(opts.apiKey, {
      model: opts.model ?? DEFAULT_ANTHROPIC_MODEL,
      system,
      user,
      tool,
      maxTokens: 4096,
      temperature: opts.temperature ?? 0.7,
    });
    result = r;
  } catch (err) {
    if (err instanceof AnthropicError) {
      throw new ScriptPlannerError(`Planner API call failed: ${err.message}`, err);
    }
    throw err;
  }

  if (!Array.isArray(result?.scenes) || result.scenes.length === 0) {
    throw new ScriptPlannerError("Planner returned no scenes");
  }

  const validIds = new Set(BUILTIN_TEMPLATES.map((t) => t.id));
  const scenes: SceneRef[] = result.scenes.map((scene, i) => {
    if (!validIds.has(scene.template)) {
      throw new ScriptPlannerError(
        `Planner picked unknown template "${scene.template}" for scene ${i + 1}`,
      );
    }
    return {
      id: scene.id || `s${String(i + 1).padStart(2, "0")}`,
      text: scene.text ?? "",
      template: scene.template,
      props: scene.props ?? {},
      hook: scene.hook === true,
      voiceId: scene.voiceId || undefined,
      durationHint: typeof scene.durationHint === "number" ? scene.durationHint : undefined,
    };
  });

  const meta: ScriptMeta = {
    ...opts.meta,
    title: opts.meta?.title ?? result.meta?.title,
    audience: opts.meta?.audience ?? result.meta?.audience,
    tone: opts.meta?.tone ?? result.meta?.tone,
    targetDurationSeconds: opts.targetDurationSeconds ?? opts.meta?.targetDurationSeconds,
  };

  return { meta, scenes };
}
