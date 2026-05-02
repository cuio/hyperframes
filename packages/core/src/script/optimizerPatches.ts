/**
 * Pure helpers for the retention optimizer's patch surface.
 *
 * The optimizer (see `optimizer.ts`) runs a closed loop:
 *   render → review → propose patches → APPLY → re-synth → re-render → re-review.
 *
 * This module owns the "APPLY" step. Gemini proposes a list of typed patches
 * and the optimizer applies them via `applyPatches()` after running them
 * through `validatePatches()`. Both functions are pure — they don't read
 * disk, don't call APIs, don't mutate caller-owned objects (every mutation
 * produces a fresh Script).
 *
 * Why a separate module from optimizer.ts: this is the entire safety
 * surface. Gemini can hallucinate template ids, reference scenes that
 * don't exist, propose narration that's pages long. Validation has to
 * happen in one place, deterministically, with tight tests.
 *
 * Patch design philosophy:
 *   - **Small, surgical edits.** Each patch touches one scene and one
 *     concern. Multi-scene reorganizations are out of scope — the planner
 *     owns scene structure, the optimizer only nudges what's already there.
 *   - **Cheap to apply.** No re-plan; no new LLM call to interpret. The
 *     patch is fully self-describing.
 *   - **Auditable.** Every patch carries a `why` string so the optimizer
 *     can show the user exactly what changed and the reasoning for each
 *     change. The optimizer log is the audit trail.
 *
 * The five patch actions cover the realistic edits Gemini can make:
 *   editText        — rewrite narration; triggers ElevenLabs re-synth
 *   swapTemplate    — change scene.template to a different builtin
 *   addProp         — set scene.props[key] = value (accent word, atmosphere
 *                     override, motion intensity, etc.)
 *   splitScene      — break one slow scene into two punchier scenes
 *   fixBorders      — inject scene.props.cssOverride for overflow / clip
 *                     issues. Templates that paint glows past the
 *                     viewport are the most common offender.
 *
 * Anything outside this surface — re-ordering scenes, swapping themes,
 * regenerating from raw input — is a planner-level operation, NOT an
 * optimizer patch. Keeps the optimizer's mental model tight.
 */

import type { Script, SceneRef } from "./types.js";

export type EditPatchAction = "editText" | "swapTemplate" | "addProp" | "splitScene" | "fixBorders";

/** Tag union — discriminated by `action`. */
export type EditPatch =
  | EditTextPatch
  | SwapTemplatePatch
  | AddPropPatch
  | SplitScenePatch
  | FixBordersPatch;

interface PatchBase {
  /** Scene id this patch targets (must exist in the script). */
  sceneId: string;
  /** One-sentence rationale shown in the optimizer log. */
  why: string;
  /**
   * Optional Gemini-estimated retention delta — how much this patch is
   * expected to move the per-scene score, in 0-100 retention points. The
   * optimizer uses this to rank patches when budget is tight.
   */
  estimatedRetentionDelta?: number;
}

export interface EditTextPatch extends PatchBase {
  action: "editText";
  /** New narration text. Triggers re-synth on this scene. */
  text: string;
}

export interface SwapTemplatePatch extends PatchBase {
  action: "swapTemplate";
  /** New template id. Validated against the available templates list. */
  newTemplate: string;
  /** Optional new props for the new template (the old props rarely fit). */
  newProps?: Record<string, unknown>;
}

export interface AddPropPatch extends PatchBase {
  action: "addProp";
  /** Top-level key under scene.props to set (or replace). */
  key: string;
  /** Value — anything JSON-serializable; templates own validation. */
  value: unknown;
}

export interface SplitScenePatch extends PatchBase {
  action: "splitScene";
  /** Text for the first half. The original scene id keeps it. */
  firstText: string;
  /** Text for the second half. New scene id is auto-generated. */
  secondText: string;
  /** Optional template for the second half. Defaults to original. */
  secondTemplate?: string;
  /** Optional props for the second half. Defaults to {}. */
  secondProps?: Record<string, unknown>;
}

export interface FixBordersPatch extends PatchBase {
  action: "fixBorders";
  /**
   * Raw CSS injected into scene.props.cssOverride. The assembler is
   * already aware of cssOverride and concatenates it after the
   * template's own CSS. We bound the size to 4KB so a runaway Gemini
   * call can't DoS the assembled file.
   */
  cssOverride: string;
}

const MAX_TEXT_LEN = 600; // chars — enough for ~10s of voiceover
const MAX_CSS_LEN = 4_096;

export interface ValidatePatchesOptions {
  /** Source-of-truth list of valid template ids. */
  knownTemplates: ReadonlyArray<string>;
  /** Source-of-truth list of valid atmosphere ids (for addProp validation
   *  when key === "atmosphere"). */
  knownAtmospheres: ReadonlyArray<string>;
}

export interface ValidatedPatchSet {
  /** Patches that survived validation, in input order. */
  patches: EditPatch[];
  /** Patches dropped during validation, with the reason. The optimizer
   *  writes these to the log so the user can see what Gemini tried that
   *  didn't pass. */
  rejected: Array<{ patch: unknown; reason: string }>;
}

/**
 * Validate a raw list of Gemini-proposed patches against the script
 * + template/atmosphere catalogs. Pure: no I/O, no Script mutation.
 *
 * Rejects patches when:
 *   - sceneId doesn't exist in the script
 *   - action is unknown
 *   - swapTemplate references an unknown template id
 *   - editText / splitScene narration exceeds MAX_TEXT_LEN chars
 *   - fixBorders cssOverride exceeds MAX_CSS_LEN bytes
 *   - addProp key is reserved by the runtime (`id`, `text`, `template`)
 */
export function validatePatches(
  raw: unknown,
  script: Script,
  opts: ValidatePatchesOptions,
): ValidatedPatchSet {
  if (!Array.isArray(raw)) {
    return { patches: [], rejected: [{ patch: raw, reason: "not an array" }] };
  }
  const knownSceneIds = new Set(script.scenes.map((s) => s.id));
  const knownTemplates = new Set(opts.knownTemplates);
  const knownAtmospheres = new Set(opts.knownAtmospheres);
  const patches: EditPatch[] = [];
  const rejected: ValidatedPatchSet["rejected"] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") {
      rejected.push({ patch: item, reason: "patch is not an object" });
      continue;
    }
    const p = item as Record<string, unknown>;
    const sceneId = typeof p.sceneId === "string" ? p.sceneId : "";
    const why = typeof p.why === "string" ? p.why.slice(0, 240) : "";
    if (!sceneId || !knownSceneIds.has(sceneId)) {
      rejected.push({ patch: item, reason: `unknown sceneId "${sceneId}"` });
      continue;
    }
    const estimatedRetentionDelta =
      typeof p.estimatedRetentionDelta === "number" && Number.isFinite(p.estimatedRetentionDelta)
        ? Math.max(-100, Math.min(100, p.estimatedRetentionDelta))
        : undefined;

    const base: PatchBase = {
      sceneId,
      why,
      ...(estimatedRetentionDelta !== undefined ? { estimatedRetentionDelta } : {}),
    };

    switch (p.action) {
      case "editText": {
        const text = typeof p.text === "string" ? p.text.trim() : "";
        if (!text) {
          rejected.push({ patch: item, reason: "editText: empty text" });
          break;
        }
        if (text.length > MAX_TEXT_LEN) {
          rejected.push({
            patch: item,
            reason: `editText: text exceeds ${MAX_TEXT_LEN} chars (got ${text.length})`,
          });
          break;
        }
        patches.push({ ...base, action: "editText", text });
        break;
      }
      case "swapTemplate": {
        const newTemplate = typeof p.newTemplate === "string" ? p.newTemplate : "";
        if (!newTemplate || !knownTemplates.has(newTemplate)) {
          rejected.push({
            patch: item,
            reason: `swapTemplate: unknown template id "${newTemplate}"`,
          });
          break;
        }
        const newProps =
          p.newProps && typeof p.newProps === "object" && !Array.isArray(p.newProps)
            ? (p.newProps as Record<string, unknown>)
            : undefined;
        patches.push({
          ...base,
          action: "swapTemplate",
          newTemplate,
          ...(newProps ? { newProps } : {}),
        });
        break;
      }
      case "addProp": {
        const key = typeof p.key === "string" ? p.key : "";
        if (!key || RESERVED_PROP_KEYS.has(key)) {
          rejected.push({
            patch: item,
            reason: `addProp: invalid or reserved key "${key}"`,
          });
          break;
        }
        // Validate atmosphere overrides specifically — since the assembler
        // resolves it via the live registry, an unknown id silently
        // falls back to the template default. We surface the mismatch
        // earlier so it lands in the audit log instead of getting lost.
        if (key === "atmosphere" && typeof p.value === "string" && !knownAtmospheres.has(p.value)) {
          rejected.push({
            patch: item,
            reason: `addProp: unknown atmosphere id "${p.value}"`,
          });
          break;
        }
        patches.push({ ...base, action: "addProp", key, value: p.value });
        break;
      }
      case "splitScene": {
        const firstText = typeof p.firstText === "string" ? p.firstText.trim() : "";
        const secondText = typeof p.secondText === "string" ? p.secondText.trim() : "";
        if (!firstText || !secondText) {
          rejected.push({ patch: item, reason: "splitScene: both texts required" });
          break;
        }
        if (firstText.length > MAX_TEXT_LEN || secondText.length > MAX_TEXT_LEN) {
          rejected.push({ patch: item, reason: `splitScene: text exceeds ${MAX_TEXT_LEN} chars` });
          break;
        }
        const secondTemplate = typeof p.secondTemplate === "string" ? p.secondTemplate : undefined;
        if (secondTemplate && !knownTemplates.has(secondTemplate)) {
          rejected.push({
            patch: item,
            reason: `splitScene: unknown secondTemplate "${secondTemplate}"`,
          });
          break;
        }
        const secondProps =
          p.secondProps && typeof p.secondProps === "object" && !Array.isArray(p.secondProps)
            ? (p.secondProps as Record<string, unknown>)
            : undefined;
        patches.push({
          ...base,
          action: "splitScene",
          firstText,
          secondText,
          ...(secondTemplate ? { secondTemplate } : {}),
          ...(secondProps ? { secondProps } : {}),
        });
        break;
      }
      case "fixBorders": {
        const cssOverride = typeof p.cssOverride === "string" ? p.cssOverride : "";
        if (!cssOverride) {
          rejected.push({ patch: item, reason: "fixBorders: empty cssOverride" });
          break;
        }
        if (cssOverride.length > MAX_CSS_LEN) {
          rejected.push({
            patch: item,
            reason: `fixBorders: cssOverride exceeds ${MAX_CSS_LEN} chars`,
          });
          break;
        }
        patches.push({ ...base, action: "fixBorders", cssOverride });
        break;
      }
      default:
        rejected.push({ patch: item, reason: `unknown action "${String(p.action)}"` });
    }
  }
  return { patches, rejected };
}

/**
 * Reserved scene.props keys the optimizer must NEVER let Gemini touch.
 * These are the runtime / assembler integration points; an addProp on
 * any of them would corrupt the rendered output.
 */
const RESERVED_PROP_KEYS = new Set(["id", "text", "template", "voiceId", "audio"]);

export interface ApplyPatchesResult {
  /** Fresh script with patches applied. Caller-owned input is untouched. */
  script: Script;
  /** Subset of input patches that triggered ElevenLabs re-synth — the
   *  caller passes these scene ids to synthesizeScript() so unchanged
   *  scenes hit the voiceover cache. */
  resynthSceneIds: string[];
  /** Per-patch outcome for the audit log. */
  appliedLog: Array<{ patch: EditPatch; resultSceneIds: string[] }>;
}

/**
 * Apply validated patches to a Script in input order. Pure: input script
 * is not mutated. Returns the new script + the set of scene ids whose
 * narration changed (caller re-synths just those).
 *
 * Order matters when multiple patches target the same scene — the result
 * is the in-order composition. splitScene patches are applied last
 * within their target scene so other patches see the original scene.
 */
export function applyPatches(
  script: Script,
  patches: ReadonlyArray<EditPatch>,
): ApplyPatchesResult {
  // Group by sceneId to apply per-scene patches in a single pass; splits
  // get a separate phase because they expand the scene list.
  const bySceneId = new Map<string, EditPatch[]>();
  for (const p of patches) {
    const list = bySceneId.get(p.sceneId);
    if (list) list.push(p);
    else bySceneId.set(p.sceneId, [p]);
  }

  const resynthSceneIds: string[] = [];
  const appliedLog: ApplyPatchesResult["appliedLog"] = [];
  const newScenes: SceneRef[] = [];

  for (const scene of script.scenes) {
    const incoming = bySceneId.get(scene.id) ?? [];
    if (incoming.length === 0) {
      newScenes.push(scene);
      continue;
    }
    let working: SceneRef = { ...scene, props: { ...scene.props } };
    let split: SplitScenePatch | null = null;

    for (const p of incoming) {
      switch (p.action) {
        case "editText": {
          working = { ...working, text: p.text };
          if (!resynthSceneIds.includes(working.id)) resynthSceneIds.push(working.id);
          appliedLog.push({ patch: p, resultSceneIds: [working.id] });
          break;
        }
        case "swapTemplate": {
          working = {
            ...working,
            template: p.newTemplate,
            props: p.newProps ?? {},
          };
          appliedLog.push({ patch: p, resultSceneIds: [working.id] });
          break;
        }
        case "addProp": {
          working = {
            ...working,
            props: { ...working.props, [p.key]: p.value },
          };
          appliedLog.push({ patch: p, resultSceneIds: [working.id] });
          break;
        }
        case "fixBorders": {
          working = {
            ...working,
            props: { ...working.props, cssOverride: p.cssOverride },
          };
          appliedLog.push({ patch: p, resultSceneIds: [working.id] });
          break;
        }
        case "splitScene": {
          // Defer split until all in-place edits land. Last writer wins
          // if the optimizer somehow proposes two splits — defensive but
          // the validator already constrains this.
          split = p;
          break;
        }
      }
    }

    if (split) {
      const firstId = working.id;
      const secondId = nextSceneId(script, newScenes, firstId);
      const first: SceneRef = { ...working, text: split.firstText };
      const second: SceneRef = {
        id: secondId,
        text: split.secondText,
        template: split.secondTemplate ?? working.template,
        props: split.secondProps ? { ...split.secondProps } : {},
        ...(working.hook ? { hook: false } : {}),
        ...(working.voiceId ? { voiceId: working.voiceId } : {}),
      };
      newScenes.push(first, second);
      if (!resynthSceneIds.includes(firstId)) resynthSceneIds.push(firstId);
      resynthSceneIds.push(secondId);
      appliedLog.push({ patch: split, resultSceneIds: [firstId, secondId] });
    } else {
      newScenes.push(working);
    }
  }

  return {
    script: { ...script, scenes: newScenes },
    resynthSceneIds,
    appliedLog,
  };
}

/**
 * Generate a fresh scene id that doesn't collide with existing scenes
 * OR scenes already added in this batch. Format follows the planner's
 * convention: zero-padded sequential within the s-namespace, with a
 * "-split" suffix to distinguish optimizer-introduced scenes from
 * planner output.
 *
 * Exported for tests so we can verify uniqueness deterministically.
 */
export function nextSceneId(
  script: Script,
  alreadyAdded: ReadonlyArray<SceneRef>,
  parentId: string,
): string {
  const existing = new Set([...script.scenes.map((s) => s.id), ...alreadyAdded.map((s) => s.id)]);
  for (let i = 1; i < 100; i++) {
    const candidate = `${parentId}-split-${i}`;
    if (!existing.has(candidate)) return candidate;
  }
  // Pathological fallback — a scene with 100 splits is broken regardless.
  return `${parentId}-split-${Date.now().toString(36)}`;
}

/**
 * Compare two render reviews to decide whether the latest iteration is
 * an improvement. The optimizer uses this to detect regressions and
 * revert. Pure helper exported for unit testing.
 *
 * Improvement = retention rose by ≥1 point AND no scene's score dropped
 * by ≥3 points. The "no scene regressed badly" rule prevents the
 * pathological "average up but broke a key scene" outcome.
 */
export function isImprovement(
  prev: {
    overallRetentionScore: number;
    perScene: Array<{ sceneId: string; visualHook: number; paceMatch: number; onBrand: number }>;
  },
  next: {
    overallRetentionScore: number;
    perScene: Array<{ sceneId: string; visualHook: number; paceMatch: number; onBrand: number }>;
  },
): { improved: boolean; delta: number; regressedScenes: string[] } {
  const delta = next.overallRetentionScore - prev.overallRetentionScore;
  const prevById = new Map(prev.perScene.map((s) => [s.sceneId, s]));
  const regressedScenes: string[] = [];
  for (const ns of next.perScene) {
    const ps = prevById.get(ns.sceneId);
    if (!ps) continue;
    const prevMin = Math.min(ps.visualHook, ps.paceMatch, ps.onBrand);
    const nextMin = Math.min(ns.visualHook, ns.paceMatch, ns.onBrand);
    if (prevMin - nextMin >= 3) regressedScenes.push(ns.sceneId);
  }
  return {
    improved: delta >= 1 && regressedScenes.length === 0,
    delta,
    regressedScenes,
  };
}
