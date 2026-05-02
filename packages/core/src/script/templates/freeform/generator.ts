/**
 * Freeform-scene generator — calls Gemini Flash to write the actual
 * HTML/CSS/JS for a single scene given the scene's narration + the
 * project's reference profile + theme tokens.
 *
 * This is the "Gemini as the rendering engine, not just the grader"
 * surface. The hand-authored templates (cyberlofi, image-scene, etc.)
 * are visual archetypes that humans wrote. Freeform is the meta-template
 * that lets Gemini synthesize any aesthetic the reference profile
 * implies, no human author required.
 *
 * The output is bounded by:
 *   - The validator (validator.ts) — strips unsafe constructs
 *   - The system prompt — encodes the constraints in plain language
 *     so Gemini knows what shape we expect
 *   - A 16KB byte cap (validator-enforced)
 *   - A 4096-token Gemini output cap (cost containment)
 *
 * Cost: ~$0.03-0.10 per scene with gemini-2.5-flash. The cache reuses
 * generations so a re-render of the same script + profile + theme is
 * free.
 */

import {
  generateStructured,
  GeminiError,
  type GeminiPart,
  type ToolFunctionDeclaration,
} from "../../../gemini/client.js";
import type { FreeformGeneration, GenerateFreeformSceneOptions } from "./types.js";
import { validateFreeformHtml, VALIDATOR_RULES } from "./validator.js";

/** Bumped when the prompt or validator rules change in a way that
 *  invalidates older cached scenes. The cache key includes this so a
 *  bump rotates every hash.
 *
 *  v2 (May 2026): switched default model from gemini-2.5-flash to
 *  gemini-2.5-pro for genuinely creative HTML/CSS, and rewrote the
 *  system prompt to demand CSS 3D + multi-layer depth + motion
 *  choreography across the FULL scene duration (not just an entrance).
 *  Also bumped the per-call retry budget from 1 retry (2 attempts
 *  total) to 2 retries (3 attempts total).
 */
export const FREEFORM_GENERATOR_VERSION = 2;

/**
 * Default model for freeform scene generation. Pro is ~4x the cost of
 * Flash ($1.25/$10 vs $0.30/$2.50 per 1M tokens) but the quality gap on
 * creative HTML/CSS+animations is large enough that the 5-7 cents per
 * scene is justified for a render targeting >85 retention. The render
 * review and patch proposer paths still use Flash — that's structured
 * grading, not creative code.
 */
export const FREEFORM_DEFAULT_MODEL = "gemini-2.5-pro";

/** Maximum number of attempts. The generator retries with violations
 *  fed back into the prompt; each retry is one additional Gemini call.
 *  3 attempts gives Pro enough room to recover from the occasional
 *  unscoped-CSS slip without bloating cost on common-case clean runs. */
const MAX_GENERATOR_ATTEMPTS = 3;

const TOOL: ToolFunctionDeclaration = {
  name: "emit_freeform_scene",
  description:
    "Emit a single self-contained HTML scene that visualizes the narration in the requested aesthetic.",
  parameters: {
    type: "object",
    properties: {
      html: {
        type: "string",
        description:
          "The complete scene as a single HTML string: <style> + <div id='SCENE_ID' …> + <script>. " +
          "Must follow the rules in the system prompt EXACTLY — the validator will reject unscoped CSS, " +
          "external script srcs, event-handler attributes, missing timeline registration, or output > 16KB.",
      },
      designNotes: {
        type: "string",
        description:
          "1-2 sentences on the visual approach you took. Surfaced in the studio overlay so the user sees what you intended.",
      },
    },
    required: ["html"],
  },
};

interface GeneratorToolInput {
  html?: string;
  designNotes?: string;
}

function buildSystemPrompt(): string {
  return [
    "# Freeform scene generator — cinematic 3D HTML",
    "",
    "You are designing ONE scene of a short-form retention-optimized video. The hand-authored templates the user already has are flat 2D typography. Your job is to do something they CAN'T — a cinematic 3D scene with real depth, perspective, and motion that evolves through the entire scene duration.",
    "",
    "**The retention bar is 90+/100.** Every prior render plateaued at ~70 because the scenes go static after a 1s entrance and sit while voiceover continues for another 5-6 seconds. Your scene must NOT do that. Motion choreography across the FULL duration is the entire point of using freeform.",
    "",
    "## Output contract (validator enforces)",
    "",
    "1. **Outer wrapper** — exactly ONE root element:",
    "   ```html",
    '   <div id="SCENE_ID" data-composition-id="SCENE_ID" data-scene-id="SCENE_ID" data-duration="DUR">…</div>',
    "   ```",
    "   SCENE_ID is the literal id from the user message.",
    "",
    "2. **Style + script siblings allowed**. `<style>` and `<script>` can appear immediately before the wrapper div. The assembler hoists them.",
    "",
    "3. **CSS scope-locked**. EVERY selector inside `<style>` MUST start with `#SCENE_ID`. `@keyframes` / `@media` / `@supports` are allowed; their inner selectors must still start with `#SCENE_ID`. UNSCOPED RULES ARE REJECTED.",
    "",
    "4. **No external resources** — no `<script src=…>`, no `<link>`, no `<iframe>`, no `<object>`, no `<embed>`, no `<form>`. Inline `<style>` and `<script>` only. Inline `data:` URLs for SVG patterns are fine.",
    "",
    "5. **No event-handler attributes** — `on*=` blocked. Use `addEventListener` if you need handlers.",
    "",
    "6. **Inline script must register a timeline**:",
    "   ```js",
    "   window.__timelines = window.__timelines || {};",
    "   window.__timelines['SCENE_ID'] = gsap.timeline({ paused: true })…;",
    "   ```",
    "",
    `7. **Size cap**: total output ≤ ${VALIDATOR_RULES.MAX_HTML_BYTES} bytes.`,
    "",
    "## Visual ambition — what 'amazing 3D' means here",
    "",
    "The user wants a real cinematic feel, not just typography. Use CSS 3D primitives:",
    "",
    "- **`perspective`** on the outer wrapper (between 800px and 1600px) so child transforms have visible depth.",
    "- **`transform-style: preserve-3d`** on container elements so nested 3D transforms compose properly.",
    "- **`translateZ()` + `rotateX/rotateY/rotateZ`** for real depth — push background layers BACK on the Z axis (negative Z), pull foreground layers FORWARD. The eye should feel multiple planes.",
    "- **At least 3 distinct depth planes**: background (Z < -100px, blurred or low-contrast), midground (Z ≈ 0, the focal data), foreground (Z > 100px, accent / overlay decoration).",
    "- **Parallax**: when the background moves slowly and the foreground moves faster, the brain reads it as depth. Use this on slow camera-style sweeps.",
    "- **Depth-of-field**: apply `filter: blur()` to elements you want to read as 'far'. Pull focus by changing blur values across the timeline.",
    "- **Subtle camera moves**: a gentle `rotateX(2deg) rotateY(-2deg)` on the wrapper that breathes across 6-8s gives real cinematic life without being gimmicky.",
    "",
    "## Motion choreography (THE 90+ RETENTION RULE)",
    "",
    "**Every scene with narration > 3 seconds MUST have motion that evolves continuously.** The standard pattern that beats Gemini's 'static after entrance' complaint:",
    "",
    "  - **0.0–0.8s**: ENTRANCE. Hero element resolves (translate + fade + chromatic split).",
    "  - **0.8–2.0s**: SETTLE. Camera-style ease, depth blur pulls focus, secondary layer animates in.",
    "  - **2.0–4.0s**: DEVELOPMENT. New visual beat — count-up, character ticker, layer swap, secondary callout reveal, glitch flicker, subtle parallax sweep. Whatever the data wants.",
    "  - **4.0–end**: SUSTAIN. Continuous evolution: CSS infinite keyframes on the depth layers (slow rotate, breathing scale, scanline drift, accent pulse). NEVER let the scene sit fully static.",
    "",
    "Every visible element should have either a GSAP tween OR a CSS infinite animation. Static elements that sit through the scene are the #1 retention killer.",
    "",
    "## Aesthetic + theme",
    "",
    "Use ONLY the theme tokens provided. The bg/fg/accent/accent2 are your palette. Don't invent colors. Use the display + mono fonts the user gives you.",
    "",
    "Honor the reference profile when present:",
    "- `vibe` is the one-sentence target feel.",
    "- `motionVibe` is the motion language (cinematic slow zoom vs glitch hard cuts).",
    "- `pacingDensity` controls beat density: slow = 2-3 beats over duration, medium = 4-5, fast = 6+.",
    "- `palette` priors are advisory; theme tokens win on conflict.",
    "",
    "## Forbidden",
    "",
    "- NO `<script src=…>`. Validator rejects the entire scene.",
    "- NO `on*=` event handler attributes.",
    "- NO `position: fixed` — scenes are layered absolutely.",
    "- NO multiple timelines for the same scene id.",
    "- NO scripts that read or modify OTHER scenes' DOM. Stay in your own scene.",
    "- NO static visuals after ~1s. The 'static after entrance' pattern caps retention at ~70.",
    "",
    "## Output",
    "",
    "Call `emit_freeform_scene` with:",
    "  - `html`: the complete `<style>` + `<script>` + scene `<div>` markup",
    "  - `designNotes`: 1-2 sentences on the depth structure + motion arc you chose",
  ].join("\n");
}

function buildUserPrompt(opts: GenerateFreeformSceneOptions): string {
  const lines: string[] = [];
  lines.push(`## Scene id`);
  lines.push(opts.sceneId);
  lines.push("");
  lines.push(`## Narration (this is what the voiceover will say — your visual must support it)`);
  lines.push(opts.narration);
  lines.push("");
  if (opts.accentWord) {
    lines.push(`## Accent word (focal element)`);
    lines.push(opts.accentWord);
    lines.push("");
  }
  if (opts.isHook) {
    lines.push(`## Hook scene`);
    lines.push("This is a hook — push motion intensity, chromatic decoration, density.");
    lines.push("");
  }
  lines.push(`## Theme tokens (use these EXACT colors and fonts)`);
  lines.push(`- background: ${opts.themeTokens.bg}`);
  lines.push(`- foreground: ${opts.themeTokens.fg}`);
  lines.push(`- accent: ${opts.themeTokens.accent}`);
  lines.push(`- accent2: ${opts.themeTokens.accent2}`);
  lines.push(`- display font: ${opts.themeTokens.fontDisplay}`);
  lines.push(`- mono font: ${opts.themeTokens.fontMono}`);
  lines.push("");
  if (opts.referenceProfile) {
    lines.push(`## Reference profile`);
    if (opts.referenceProfile.vibe) lines.push(`- vibe: ${opts.referenceProfile.vibe}`);
    if (opts.referenceProfile.motionVibe)
      lines.push(`- motion: ${opts.referenceProfile.motionVibe}`);
    if (opts.referenceProfile.pacingDensity)
      lines.push(`- pacing: ${opts.referenceProfile.pacingDensity}`);
    if (opts.referenceProfile.typographyEnergy)
      lines.push(`- typography energy: ${opts.referenceProfile.typographyEnergy}`);
    if (opts.referenceProfile.palette?.length)
      lines.push(`- palette priors: ${opts.referenceProfile.palette.join(" ")}`);
    lines.push("");
  }
  lines.push("Now call `emit_freeform_scene` with the complete HTML.");
  return lines.join("\n");
}

export interface GenerateFreeformResult {
  generation: FreeformGeneration;
  /** When validator rejected the model output, the violation list. The
   *  generator does ONE retry with the violations fed back into the
   *  prompt. If the retry also fails, the violations are surfaced here
   *  for the caller to handle (typically: fall through to a hand-
   *  authored template). */
  rejectedFirstPass?: ValidationFailure;
}

export interface ValidationFailure {
  attempt: number;
  violations: Array<{ rule: string; message: string }>;
  rawHtml: string;
}

/**
 * Generate a single freeform scene. Calls Gemini, validates, retries up
 * to 2 more times (3 attempts total) with violations in the prompt if
 * validation fails. Returns the canonicalized HTML + telemetry.
 *
 * Default model is Pro for genuinely creative HTML/CSS; callers can
 * override via opts.model when cost matters more than quality.
 *
 * Caller is responsible for caching — this function is a pure-ish
 * "given inputs, produce output" wrapper around the Gemini call.
 */
export async function generateFreeformScene(
  opts: GenerateFreeformSceneOptions,
): Promise<GenerateFreeformResult> {
  // Pro by default for creative HTML/CSS. Ignore the global
  // DEFAULT_GEMINI_MODEL (which is Flash) — Flash hits MALFORMED_FUNCTION_CALL
  // ~30% of the time on the 3D-cinematic prompt because the structured
  // output gets long. Pro handles it cleanly.
  const model = opts.model ?? FREEFORM_DEFAULT_MODEL;
  const system = buildSystemPrompt();
  const user = buildUserPrompt(opts);

  let attempt = 0;
  let firstFailure: ValidationFailure | undefined;
  let lastRaw = "";
  let lastViolations: ValidationFailure["violations"] = [];
  // Keep the prior raw output so we can show the model EXACTLY what it
  // emitted — sometimes Pro repeats the same mistake when only told the
  // rule was violated; quoting the actual offending CSS makes the fix
  // deterministic.
  let lastRawForRetry = "";

  while (attempt < MAX_GENERATOR_ATTEMPTS) {
    attempt += 1;
    const userParts: GeminiPart[] = [{ text: user }];
    if (attempt > 1) {
      // Retry: feed violations + a snippet of the previous output back
      // so the model knows exactly what to fix. Quoting the raw output
      // turned out to be necessary on attempt-3 cases — without it, the
      // model often repeats the same mistake on a different element.
      const snippet = lastRawForRetry.slice(0, 1200);
      userParts.push({
        text: [
          `## Attempt ${attempt - 1} failed validation`,
          "",
          "The validator flagged these violations:",
          ...lastViolations.map((v) => `- ${v.rule}: ${v.message}`),
          "",
          "Here is the start of your previous output for reference (first 1.2KB):",
          "```html",
          snippet,
          "```",
          "",
          "Emit a fully corrected version that fixes ALL of these violations. Pay special attention to scoped CSS — every selector must start with `#" +
            opts.sceneId +
            "`.",
        ].join("\n"),
      });
    }

    const { result, usage } = await generateStructured<GeneratorToolInput>(opts.apiKey, {
      model,
      parts: userParts,
      systemInstruction: system,
      tool: TOOL,
      // Higher temperature for the cinematic creative latitude. Pro at
      // 0.65 stays coherent; Flash at this temp tends to hallucinate
      // more, hence the model upgrade above.
      temperature: 0.65,
      // 4096 was too tight on Flash — the 16KB HTML cap already eats
      // ~4K tokens, plus JSON wrapper + designNotes pushed Flash to
      // MALFORMED_FUNCTION_CALL. 8192 is comfortable on Pro too.
      maxOutputTokens: 8192,
    });

    const html = typeof result.html === "string" ? result.html : "";
    lastRaw = html;
    lastRawForRetry = html;
    const validation = validateFreeformHtml(html, { sceneId: opts.sceneId });
    if (validation.ok && validation.html) {
      const generation: FreeformGeneration = {
        html: validation.html,
        model,
        generatedAt: new Date().toISOString(),
        usage: {
          promptTokens: usage.promptTokenCount ?? 0,
          outputTokens: usage.candidatesTokenCount ?? 0,
        },
      };
      return firstFailure ? { generation, rejectedFirstPass: firstFailure } : { generation };
    }

    lastViolations = validation.violations.map((v) => ({ rule: v.rule, message: v.message }));
    if (attempt === 1) {
      firstFailure = { attempt: 1, violations: lastViolations, rawHtml: html };
    }
  }

  throw new GeminiError(
    `generateFreeformScene: scene ${opts.sceneId} failed validation on all ${MAX_GENERATOR_ATTEMPTS} attempts. ` +
      `Last violations: ${lastViolations.map((v) => v.rule).join(", ")}. ` +
      `Last raw output (first 256 chars): ${lastRaw.slice(0, 256)}`,
  );
}
