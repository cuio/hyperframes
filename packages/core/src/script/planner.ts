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
  /**
   * Optional per-video art direction (DESIGN-ART.md). Drives mood, pacing,
   * motifs, transitions for THIS video specifically.
   */
  artDirection?: string;
  /**
   * Optional research file (RESEARCH.md) — facts, sources, quotes, caveats.
   * The planner is told that every numerical claim must trace to a line here
   * and to populate chart-scene source/watermark from this file.
   */
  research?: string;
}

interface PlanToolInput {
  meta?: {
    title?: string;
    audience?: string;
    tone?: string;
    overallReasoning?: string;
  };
  scenes: Array<{
    id: string;
    text: string;
    template: string;
    props: Record<string, unknown>;
    hook?: boolean;
    durationHint?: number;
    voiceId?: string;
    reasoning?: string;
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
            overallReasoning: {
              type: "string",
              description:
                "2–4 sentences explaining your overall approach to this video: the hook strategy, how the visual flow supports the narrative arc, and how the design brief shaped your choices.",
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
                description:
                  "VERBATIM from the source script. Do not paraphrase, summarize, or rewrite. May split a sentence or merge adjacent sentences only.",
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
              reasoning: {
                type: "string",
                description:
                  "REQUIRED. 2–4 sentences explaining WHY this template + chart was chosen for this exact narration. Reference the playbook AND the design brief if one was supplied. Be specific and visual — name the animation, the colors, why this beats the alternatives.",
              },
            },
            required: ["id", "text", "template", "props", "reasoning"],
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
  lines.push("# Source script (use these exact words as scene narration — DO NOT REWRITE)");
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
  lines.push("# Reminders");
  lines.push("- Every scene's `text` must be verbatim from the source above.");
  lines.push("- Every scene MUST include a `reasoning` field (2–4 sentences).");
  lines.push("- Open with a hook scene that uses the most striking number/claim.");
  lines.push("- Prefer chart-scene whenever the sentence has 2+ numbers in a relationship.");
  lines.push("- Mark every scene in the first ~30s as `hook: true`.");
  lines.push("- End with outro-cta.");
  lines.push("");
  lines.push("Call the plan_video tool now.");
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

  const sections: string[] = [RETENTION_PLAYBOOK];
  if (opts.designBrief?.trim()) {
    sections.push(
      `# Visual identity — project DESIGN.md\n\n${opts.designBrief.trim()}\n\n## How to apply this brief\n\n- Every scene's reasoning MUST reference at least one specific element\n  from the brief (a color, a font, a motion principle, a chart-style cue).\n- Pick chart colors deliberately: map the brief's "primary" palette role\n  to props.color = "primary", "secondary" role to "secondary", etc.\n- Set props.watermark to the brief's author byline if mentioned. Set\n  props.source to citation lines from RESEARCH.md when relevant.\n- Type hierarchy: hook scenes use the brief's display font; data\n  numbers use the mono font; body uses the body font.`,
    );
  } else {
    sections.push(
      `# No DESIGN.md supplied\n\nDefault aesthetic is HackerNoon FT (cream + red + Georgia serif). Use\nclassic data-journalism hierarchy: bold serif title, italic subtitle,\nred accent for the focal data point, source line bottom-left.`,
    );
  }
  if (opts.artDirection?.trim()) {
    sections.push(
      `# Art direction — DESIGN-ART.md\n\n${opts.artDirection.trim()}\n\n## How to apply\n\n- Match the mood specified above. If "urgent investigative", lean on\n  hard cuts, accent3 (warning/amber) for outliers, dense type.\n- Honor pacing rules. If scenes should be ≤4s, bias toward shorter\n  durationHints. If "no fades", set transition: "cut".\n- Reference DESIGN-ART motifs in your reasoning ("Per art direction\n  motif: red horizontal rule…").`,
    );
  }
  if (opts.research?.trim()) {
    sections.push(
      `# Research — RESEARCH.md\n\n${opts.research.trim()}\n\n## How to apply\n\n- Every numerical claim in the script must correspond to a line here.\n- Populate chart-scene props.source from "Key sources" section.\n- Use "Quotes" verbatim (with attribution) for quote scene templates.\n- Honor "Counterpoints / caveats" — surface them in the analysis act.\n- NEVER invent numbers, dates, names, or sources. If the script\n  references a fact not in RESEARCH.md, flag it via meta.warnings.\n- Any item under "Don't claim" must NOT appear in any scene text.`,
    );
  }
  const system = sections.join("\n\n");

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
      reasoning: typeof scene.reasoning === "string" ? scene.reasoning : undefined,
    };
  });

  const meta: ScriptMeta = {
    ...opts.meta,
    title: opts.meta?.title ?? result.meta?.title,
    audience: opts.meta?.audience ?? result.meta?.audience,
    tone: opts.meta?.tone ?? result.meta?.tone,
    targetDurationSeconds: opts.targetDurationSeconds ?? opts.meta?.targetDurationSeconds,
    overallReasoning: result.meta?.overallReasoning ?? opts.meta?.overallReasoning,
    warnings: collectWarnings(opts, scenes),
  };

  return { meta, scenes };
}

// ── Variant generation ────────────────────────────────────────────────────

export interface VariantOptions {
  apiKey: string;
  model?: string;
  /** Number of variants to return. Default 3. Max 5 for cost reasons. */
  count?: number;
  /** Optional context. */
  designBrief?: string;
  artDirection?: string;
  research?: string;
  temperature?: number;
}

interface VariantToolInput {
  variants: Array<{
    template: string;
    props: Record<string, unknown>;
    reasoning: string;
    label: string;
  }>;
}

/**
 * Generate N alternative visual treatments for a single scene's narration.
 * Same text, different template + props. The user picks one in the UI.
 *
 * The planner is told explicitly that all N must use DIFFERENT templates
 * or DIFFERENT chart types — no two variants should look the same.
 */
export async function planSceneVariants(
  scene: SceneRef,
  scriptContext: { meta: ScriptMeta; allScenes: SceneRef[] },
  opts: VariantOptions,
): Promise<Array<SceneRef & { label: string }>> {
  const count = Math.min(5, Math.max(2, opts.count ?? 3));

  const sections: string[] = [
    "# Scene variant generator",
    "",
    "You are remixing a single scene's visual treatment. The narration text",
    "is FIXED — you cannot change it. Generate " + count + " visually DIFFERENT",
    "treatments using different templates or different chart types. Each",
    "variant must include reasoning AND a short 4-6 word label that the user",
    "will see in a card grid (e.g. 'Big number stamp', 'Crash chart', 'Quote pull').",
    "",
    "The variants must be meaningfully different — never two of the same",
    "template, never two of the same chart type. If the scene is hook-grade,",
    "all variants should be hook-grade.",
  ];
  if (opts.designBrief?.trim()) sections.push(`# DESIGN.md\n${opts.designBrief.trim()}`);
  if (opts.artDirection?.trim()) sections.push(`# DESIGN-ART.md\n${opts.artDirection.trim()}`);
  if (opts.research?.trim()) sections.push(`# RESEARCH.md\n${opts.research.trim()}`);

  const templateEnum = BUILTIN_TEMPLATES.map((t) => t.id);
  const templateCatalog = BUILTIN_TEMPLATES.map((t) => ({
    id: t.id,
    description: t.description,
    propsSchema: t.propsSchema,
  }));
  const chartCatalog = BUILTIN_CHARTS.map((c) => ({
    id: c.id,
    description: c.description,
    propsSchema: c.propsSchema,
  }));

  const tool: ToolDefinition = {
    name: "scene_variants",
    description:
      "Return " +
      count +
      " visually distinct treatments for the same scene narration.\n\n" +
      "TEMPLATE CATALOG:\n" +
      JSON.stringify(templateCatalog, null, 2) +
      "\n\nCHART CATALOG:\n" +
      JSON.stringify(chartCatalog, null, 2),
    input_schema: {
      type: "object",
      properties: {
        variants: {
          type: "array",
          minItems: count,
          maxItems: count,
          items: {
            type: "object",
            properties: {
              template: { type: "string", enum: templateEnum },
              props: { type: "object" },
              reasoning: {
                type: "string",
                description: "Why this treatment fits this narration. 2-3 sentences.",
              },
              label: {
                type: "string",
                description: "4-6 word card label, e.g. 'Big number stamp' or 'Cliff chart'.",
              },
            },
            required: ["template", "props", "reasoning", "label"],
          },
        },
      },
      required: ["variants"],
    },
  };

  const userMsg: string[] = [
    "# The scene to remix",
    "",
    "Narration (FIXED — do not change):",
    JSON.stringify(scene.text),
    "",
    "Currently: template = " + scene.template + ", hook = " + (scene.hook ? "true" : "false"),
    "Position in video: " +
      (scriptContext.allScenes.findIndex((s) => s.id === scene.id) + 1) +
      " of " +
      scriptContext.allScenes.length,
    "",
    "Return exactly " + count + " variants. They must use DIFFERENT templates",
    "(or different chart types within chart-scene). Provide a 4-6 word label",
    "for each so the user can pick visually.",
  ];

  let result: VariantToolInput;
  try {
    const { result: r } = await callStructuredTool<VariantToolInput>(opts.apiKey, {
      model: opts.model ?? DEFAULT_ANTHROPIC_MODEL,
      system: sections.join("\n\n"),
      user: userMsg.join("\n"),
      tool,
      maxTokens: 4096,
      temperature: opts.temperature ?? 0.85,
    });
    result = r;
  } catch (err) {
    if (err instanceof AnthropicError) {
      throw new ScriptPlannerError(`Variant API call failed: ${err.message}`, err);
    }
    throw err;
  }

  if (!Array.isArray(result?.variants) || result.variants.length === 0) {
    throw new ScriptPlannerError("Variant planner returned no variants");
  }

  const validIds = new Set(BUILTIN_TEMPLATES.map((t) => t.id));
  return result.variants
    .filter((v) => validIds.has(v.template))
    .map((v) => ({
      id: scene.id,
      text: scene.text,
      template: v.template,
      props: v.props ?? {},
      hook: scene.hook,
      voiceId: scene.voiceId,
      durationHint: scene.durationHint,
      reasoning: v.reasoning,
      label: v.label,
    }));
}

// ── Helpers ───────────────────────────────────────────────────────────────

function collectWarnings(opts: PlanOptions, scenes: SceneRef[]): string[] {
  const warnings: string[] = [];
  if (!opts.designBrief?.trim()) {
    warnings.push("No DESIGN.md found — using default HackerNoon FT theme.");
  }
  if (!opts.artDirection?.trim()) {
    warnings.push(
      "No DESIGN-ART.md found — planner used generic art direction. Add one for tighter mood control.",
    );
  }
  // Detect orphan numeric claims when research is supplied.
  if (opts.research?.trim()) {
    const research = opts.research.toLowerCase();
    const numberPattern = /\$?\d[\d,]*\.?\d*\s*(?:bn|b|m|k|%|trillion|billion|million)?/gi;
    const orphans = new Set<string>();
    for (const scene of scenes) {
      const claims = scene.text.match(numberPattern) ?? [];
      for (const claim of claims) {
        const norm = claim.toLowerCase().replace(/[\s,]/g, "");
        if (norm.length < 2) continue;
        if (!research.replace(/[\s,]/g, "").includes(norm)) {
          orphans.add(claim.trim());
        }
      }
    }
    if (orphans.size > 0) {
      warnings.push(
        `Orphan numeric claims (not found in RESEARCH.md): ${Array.from(orphans).slice(0, 8).join(", ")}`,
      );
    }
  } else {
    warnings.push(
      "No RESEARCH.md found — planner couldn't fact-check claims or auto-cite sources.",
    );
  }
  return warnings;
}
