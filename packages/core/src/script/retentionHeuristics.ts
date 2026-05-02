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
 *
 * Order matters: avoidChartAtSceneOne runs FIRST so we know whether
 * scene-0 is a hook before engineerFirstFiveSeconds tries to expand it.
 */
export function applyRetentionHeuristics(script: Script): Script {
  const format = inferScriptFormat(script.meta);
  let scenes = script.scenes.slice();
  scenes = avoidChartAtSceneOne(scenes);
  scenes = engineerFirstFiveSeconds(scenes, format);
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

// ── engineerFirstFiveSeconds ───────────────────────────────────────────────
//
// Implements the "hyper-cut hook" pattern from retention-overdrive.md.
// Detects a dense opening hook scene and splits it into 3-5 micro-scenes,
// each 0.6-1.5s, rotating templates + bg flashes for visible
// type-and-color changes. 4-6 cuts/sec is the retention-winning cadence
// for the first 5 seconds.

/** Templates rotated through the hyper-hook for visible type changes. */
const HYPER_HOOK_TEMPLATE_ROTATION = [
  "kinetic-words",
  "cyber-glitch-word",
  "hook-bigtext",
  "kinetic-words",
  "hook-bigtext",
] as const;

/** Bg-override flashes — 3-stop palette rotated through scenes. The
 *  values are CSS background expressions that lean on the active theme's
 *  accent + fg + bg colours; each consumer renders against whatever
 *  theme is loaded so we don't hardcode brand colours here. We pass the
 *  literal CSS string and the theme's accent shows through where we use
 *  `currentColor` etc. (Templates that don't honour bgOverride just
 *  ignore the prop — the rotation still produces a visible cut.) */
const HYPER_HOOK_BG_ROTATION = [
  null, // theme bg — first frame anchors
  "linear-gradient(135deg, #000 0%, #1a0a14 100%)",
  null,
  "radial-gradient(ellipse at center, #1a1a2e 0%, #000 100%)",
  null,
] as const;

/** Threshold for triggering hyper-hook engineering. */
const HYPER_HOOK_MIN_DURATION_SEC = 2.5;
const HYPER_HOOK_MIN_WORD_COUNT = 6;
const HYPER_HOOK_MAX_MICRO_SCENES = 5;
const HYPER_HOOK_MIN_MICRO_DURATION_SEC = 0.6;
const HYPER_HOOK_MAX_MICRO_DURATION_SEC = 1.5;

/**
 * If the opening hook scene is dense enough to warrant it, replace it
 * with a sequence of 3–5 micro-scenes that rotate templates + bg
 * flashes. The micro-scenes share total duration with the original.
 *
 * Conservative — only triggers when:
 *   - Scene 0 exists
 *   - Scene 0 is a hook (template == "hook-bigtext", "kinetic-words",
 *     "cyber-glitch-word", "hook-statreveal", or .hook === true)
 *   - Scene 0's narration has >= 6 words
 *   - Scene 0's durationHint OR text-implied duration is >= 2.5s
 *
 * For long-form, we only split if the hook is actually long (> 4s) so
 * we don't fragment short hooks that work fine.
 *
 * Test coverage at retentionHeuristics.test.ts.
 */
export function engineerFirstFiveSeconds(scenes: SceneRef[], format: ScriptFormat): SceneRef[] {
  if (scenes.length === 0) return scenes;
  const opener = scenes[0];
  if (!opener) return scenes;
  if (!isHookScene(opener)) return scenes;

  const text = opener.text || asString((opener.props ?? {}).title);
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length < HYPER_HOOK_MIN_WORD_COUNT) return scenes;

  const baseDur = opener.durationHint ?? estimateDurationFromWords(words.length);
  // Long-form needs a hook that's actually long enough to warrant fragments.
  const trigger = format === "short" ? HYPER_HOOK_MIN_DURATION_SEC : 4;
  if (baseDur < trigger) return scenes;

  // Plan the micro-scenes. We aim for one punchword cluster per micro,
  // keeping duration in [0.6, 1.5]s. For a 4s hook with 8 words that's
  // 4-5 micros at 0.8-1.0s each.
  const microCount = Math.min(
    HYPER_HOOK_MAX_MICRO_SCENES,
    Math.max(3, Math.floor(baseDur / HYPER_HOOK_MAX_MICRO_DURATION_SEC) + 1),
  );
  const wordsPerMicro = Math.ceil(words.length / microCount);
  const microDur = clamp(
    baseDur / microCount,
    HYPER_HOOK_MIN_MICRO_DURATION_SEC,
    HYPER_HOOK_MAX_MICRO_DURATION_SEC,
  );

  const micros: SceneRef[] = [];
  for (let i = 0; i < microCount; i++) {
    const wordSlice = words.slice(i * wordsPerMicro, (i + 1) * wordsPerMicro).join(" ");
    if (!wordSlice) continue;
    const tplIdx = i % HYPER_HOOK_TEMPLATE_ROTATION.length;
    const bgIdx = i % HYPER_HOOK_BG_ROTATION.length;
    const template = HYPER_HOOK_TEMPLATE_ROTATION[tplIdx] ?? "kinetic-words";
    const bgOverride = HYPER_HOOK_BG_ROTATION[bgIdx] ?? null;
    micros.push({
      id: `s00-hyper${i}`,
      text: wordSlice,
      template,
      props: buildHyperHookProps(template, wordSlice, bgOverride),
      hook: true,
      durationHint: microDur,
      transition: "cut", // hard cuts only — fades soften the cadence
      reasoning:
        `Auto-generated micro-scene ${i + 1}/${microCount} of the hyper-cut hook ` +
        `(retention-overdrive.md). Original opener split into ${microCount} type-and-bg ` +
        `flashes for 4–6 cuts/sec opening cadence.`,
    });
  }
  if (micros.length === 0) return scenes;

  return [...micros, ...scenes.slice(1)];
}

/** Did the planner flag this as a hook, or is it one of the hook templates? */
function isHookScene(scene: SceneRef): boolean {
  if (scene.hook === true) return true;
  return (
    scene.template === "hook-bigtext" ||
    scene.template === "kinetic-words" ||
    scene.template === "cyber-glitch-word" ||
    scene.template === "hook-statreveal"
  );
}

/** Build the right props shape for whichever template the rotation picked. */
function buildHyperHookProps(
  template: string,
  text: string,
  bgOverride: string | null,
): Record<string, unknown> {
  const base: Record<string, unknown> = {};
  if (bgOverride) base.bgOverride = bgOverride;
  if (template === "kinetic-words") {
    // kinetic-words takes a `words` array
    return { ...base, words: text.split(/\s+/).slice(0, 4) };
  }
  if (template === "cyber-glitch-word") {
    // cyber-glitch-word takes a single `word`
    return { ...base, word: text.split(/\s+/)[0] ?? text };
  }
  // hook-bigtext takes a `title`
  return { ...base, title: text };
}

/** Rough duration estimate for a hook scene with N words at ~3 words/sec. */
function estimateDurationFromWords(n: number): number {
  return Math.max(2, n / 3);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
