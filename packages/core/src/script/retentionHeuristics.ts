/**
 * Retention heuristics — pure post-processors on a planned Script that
 * encode the structural rules of `skills/hyperframes/retention-ladder.md`.
 *
 * What these do (in order):
 *
 *   1. Never chart-at-scene-1. If the planner picked `chart-scene` for
 *      scene 0, prepend a `hook-bigtext` that lifts the chart's title.
 *      A chart at second zero has no stakes; viewers scroll.
 *
 *   2. Cap consecutive chart-scenes at 2. Three charts back-to-back
 *      reads as a slideshow. After every 2nd consecutive chart, insert
 *      a kinetic-words bridge with a short connector phrase pulled from
 *      the next chart's subtitle (or a generic stinger if absent).
 *
 *   3. Auto-emit a `chart-payoff` after every `chart-scene`. The chart
 *      shows the data; the payoff lands the meaning. Pulls the payoff
 *      text from the chart's annotation, falling back to title/subtitle.
 *
 *   4. Format-aware sustain hints. For short-form (script.meta.format ==
 *      "short" or targetDurationSeconds < 90), every chart-scene gets
 *      durationHint clamped to the short-form ceiling so the synth pass
 *      doesn't stretch a chart past its retention window.
 *
 * The transformations are pure and deterministic. New scenes get
 * deterministic ids based on their position so re-running the
 * heuristics on the same input produces the same output.
 *
 * Caller: `planScript` invokes `applyRetentionHeuristics` at the end of
 * its returned Script. Tests at retentionHeuristics.test.ts.
 */

import type { Script, SceneRef, ScriptMeta } from "./types.js";

const SHORT_FORM_CHART_DURATION_CAP_SEC = 5;
const LONG_FORM_CHART_DURATION_CAP_SEC = 10;

/** Inferred format for a script — drives sustain caps + bridge length. */
export type ScriptFormat = "short" | "long";

/**
 * Infer format from explicit meta or fall back to targetDurationSeconds.
 * `short` = ≤90s total, `long` = >90s.
 */
export function inferScriptFormat(meta: ScriptMeta): ScriptFormat {
  const explicit = (meta as { format?: unknown }).format;
  if (explicit === "short" || explicit === "long") return explicit;
  const target = meta.targetDurationSeconds;
  if (typeof target === "number" && target > 0) {
    return target <= 90 ? "short" : "long";
  }
  return "long"; // safe default — long-form is more permissive
}

/**
 * Apply all retention heuristics to a planned Script. Returns a new
 * Script — does not mutate the input.
 */
export function applyRetentionHeuristics(script: Script): Script {
  const format = inferScriptFormat(script.meta);
  let scenes = script.scenes.slice();
  scenes = avoidChartAtSceneOne(scenes);
  scenes = capConsecutiveCharts(scenes);
  scenes = autoEmitPayoff(scenes);
  scenes = clampChartDurations(scenes, format);
  scenes = renumberSceneIds(scenes);
  return { meta: script.meta, scenes };
}

/**
 * Rule 1: never start a video with chart-scene. Prepend a hook-bigtext
 * with the chart's title.
 */
export function avoidChartAtSceneOne(scenes: SceneRef[]): SceneRef[] {
  if (scenes.length === 0) return scenes;
  const first = scenes[0];
  if (!first || first.template !== "chart-scene") return scenes;
  // Pull a hook line from the chart-scene's title (preferred) or subtitle.
  const props = (first.props ?? {}) as { title?: unknown; subtitle?: unknown };
  const hookTitle =
    asString(props.title) || asString(props.subtitle) || "The story behind the numbers";
  const hookScene: SceneRef = {
    id: "s00-hook",
    text: hookTitle,
    template: "hook-bigtext",
    props: { title: hookTitle },
    hook: true,
    durationHint: 2.5,
    reasoning:
      "Auto-inserted by retention heuristics: charts must not open a video. See retention-ladder.md, rule: 'Don't open with a chart.'",
  };
  return [hookScene, ...scenes];
}

/**
 * Rule 2: after every 2 consecutive chart-scenes, insert a bridge scene
 * so 3-chart runs are broken up.
 */
export function capConsecutiveCharts(scenes: SceneRef[]): SceneRef[] {
  const out: SceneRef[] = [];
  let consecutiveCount = 0;
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    if (!scene) continue;
    out.push(scene);
    if (scene.template === "chart-scene") {
      consecutiveCount += 1;
      if (consecutiveCount === 2) {
        const next = scenes[i + 1];
        if (next && next.template === "chart-scene") {
          // Only insert a bridge if there's a 3rd chart following.
          const bridgeText = bridgeFromContext(next);
          out.push({
            id: `s${out.length.toString().padStart(2, "0")}-bridge`,
            text: bridgeText,
            template: "kinetic-words",
            props: { words: bridgeText.split(/\s+/).slice(0, 4) },
            durationHint: 1.8,
            reasoning:
              "Auto-inserted by retention heuristics: 3+ consecutive chart-scenes read as a slideshow. See retention-ladder.md, rule: 'Bridge between charts with metabolic cuts.'",
          });
          consecutiveCount = 0;
        }
      }
    } else {
      consecutiveCount = 0;
    }
  }
  return out;
}

function bridgeFromContext(nextScene: SceneRef): string {
  // Pull a 2-4 word stinger from the next chart's subtitle if available;
  // otherwise use a generic editorial-grade connector.
  const subtitle = asString((nextScene.props ?? {}).subtitle);
  if (subtitle) {
    const words = subtitle.split(/\s+/).filter((w) => w.length > 0);
    if (words.length >= 2) return words.slice(0, 4).join(" ");
  }
  return "But here's the next twist";
}

/**
 * Rule 3: emit a chart-payoff after every chart-scene.
 */
export function autoEmitPayoff(scenes: SceneRef[]): SceneRef[] {
  const out: SceneRef[] = [];
  for (const scene of scenes) {
    out.push(scene);
    if (scene.template !== "chart-scene") continue;
    // Skip if the very next scene the planner produced is already a payoff
    // (don't double-emit).
    const idxInOut = out.length - 1;
    const nextOriginal = scenes[scenes.indexOf(scene) + 1];
    if (nextOriginal?.template === "chart-payoff") continue;
    const payoffText = extractPayoffText(scene);
    if (!payoffText) continue;
    const props = (scene.props ?? {}) as Record<string, unknown>;
    out.push({
      id: `${scene.id}-payoff`,
      text: payoffText,
      template: "chart-payoff",
      props: {
        payoff: payoffText,
        byline: asString(props.byline) || asString(props.watermark),
        bgOverride: asString(props.bgOverride),
      },
      durationHint: 1.8,
      reasoning: `Auto-paired with scene ${scene.id} by retention heuristics. See retention-ladder.md, rule: 'End the chart on the annotation, not the chart.'`,
    });
    void idxInOut;
  }
  return out;
}

/**
 * Pull payoff text from a chart-scene. Priority:
 *   1. chart.props.annotation.text — the explicit interpretation
 *   2. chart-scene.props.subtitle — if the subtitle is itself a takeaway
 *   3. chart-scene.props.title — last resort
 */
function extractPayoffText(scene: SceneRef): string {
  const sceneProps = (scene.props ?? {}) as Record<string, unknown>;
  const chart = sceneProps.chart as { props?: unknown } | undefined;
  const chartProps = (chart?.props ?? {}) as Record<string, unknown>;
  const annotation = chartProps.annotation as { text?: unknown } | undefined;
  const annText = asString(annotation?.text);
  if (annText) return annText.replace(/\n+/g, " ").trim();
  const subtitle = asString(sceneProps.subtitle);
  if (subtitle && subtitle.length < 80) return subtitle;
  const title = asString(sceneProps.title);
  if (title) return title;
  return "";
}

/**
 * Rule 4: clamp chart-scene durationHints so short-form videos don't let
 * a chart sustain past its retention window.
 */
export function clampChartDurations(scenes: SceneRef[], format: ScriptFormat): SceneRef[] {
  const cap =
    format === "short" ? SHORT_FORM_CHART_DURATION_CAP_SEC : LONG_FORM_CHART_DURATION_CAP_SEC;
  return scenes.map((scene) => {
    if (scene.template !== "chart-scene") return scene;
    const hint = scene.durationHint;
    if (typeof hint === "number" && hint > cap) {
      return {
        ...scene,
        durationHint: cap,
        reasoning:
          (scene.reasoning ?? "") +
          ` [retention] clamped duration ${hint.toFixed(1)}s → ${cap}s for ${format}-form sustain budget.`,
      };
    }
    if (typeof hint !== "number") {
      // No hint set — prime it at the cap so audio synth doesn't stretch.
      return { ...scene, durationHint: cap };
    }
    return scene;
  });
}

/**
 * After all heuristics inject scenes, renumber ids so they're stable
 * sequential strings — the assembler + studio depend on this. Preserves
 * any author-set semantic suffixes (e.g. "-hook", "-bridge", "-payoff").
 */
export function renumberSceneIds(scenes: SceneRef[]): SceneRef[] {
  return scenes.map((scene, i) => {
    const idStem = `s${(i + 1).toString().padStart(2, "0")}`;
    // Preserve semantic suffix if the original had one (e.g. -payoff, -hook).
    const suffixMatch = scene.id.match(/-(?:hook|bridge|payoff)$/);
    const newId = suffixMatch ? `${idStem}${suffixMatch[0]}` : idStem;
    return { ...scene, id: newId };
  });
}

function asString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}
