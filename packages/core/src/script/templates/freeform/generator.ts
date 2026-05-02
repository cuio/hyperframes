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
  DEFAULT_GEMINI_MODEL,
  type GeminiPart,
  type ToolFunctionDeclaration,
} from "../../../gemini/client.js";
import type { FreeformGeneration, GenerateFreeformSceneOptions } from "./types.js";
import { validateFreeformHtml, VALIDATOR_RULES } from "./validator.js";

/** Bumped when the prompt or validator rules change in a way that
 *  invalidates older cached scenes. The cache key includes this so a
 *  bump rotates every hash. */
export const FREEFORM_GENERATOR_VERSION = 1;

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
    "# Freeform scene generator",
    "",
    "You are writing the COMPLETE HTML for a single scene of a short-form video. The user's planner has already chosen the scene's narration and pacing; your job is to produce a visualization that supports the narration in the requested aesthetic.",
    "",
    "## Output contract (the validator enforces ALL of these)",
    "",
    "1. **Outer wrapper**. Exactly ONE root element:",
    "   ```html",
    '   <div id="SCENE_ID" data-composition-id="SCENE_ID" data-scene-id="SCENE_ID" data-duration="DUR">…</div>',
    "   ```",
    "   where SCENE_ID is the literal scene id provided in the user message.",
    "",
    "2. **Style + script siblings allowed**. You may emit `<style>` and `<script>` blocks immediately before the wrapper div. The assembler hoists them.",
    "",
    "3. **CSS scope-locked**. Every selector inside `<style>` MUST start with `#SCENE_ID`. The validator rejects unscoped selectors. `@keyframes`, `@media`, `@supports` are allowed; their inner selectors must still start with `#SCENE_ID`.",
    "",
    "4. **No external resources**. No `<script src=…>`, no `<link rel=stylesheet>`, no `<iframe>`, no `<object>`, no `<embed>`, no `<form>`. Inline `<script>` and `<style>` are fine. CSS may use `data:` URLs for SVG patterns.",
    "",
    "5. **No event-handler attributes**. `onclick`, `onload`, `onerror`, etc. are blocked. If you need handlers, use `addEventListener` inside the inline `<script>`.",
    "",
    "6. **Inline script must register a timeline**. Exactly one `<script>` block must contain:",
    "   ```js",
    "   window.__timelines = window.__timelines || {};",
    "   window.__timelines['SCENE_ID'] = gsap.timeline({ paused: true })…;",
    "   ```",
    "   The runtime walks `window.__timelines` to find each scene's GSAP timeline. Without it, the scene won't animate during master-timeline scrubbing.",
    "",
    `7. **Size cap**. Total output ≤ ${VALIDATOR_RULES.MAX_HTML_BYTES} bytes. Be terse — large CSS blocks are usually a sign of unfocused design.`,
    "",
    "## Aesthetic guidance",
    "",
    "Use ONLY the theme tokens provided. The bg/fg/accent/accent2 are your palette; the display/mono fonts are what you have. Don't pull arbitrary colors or fonts.",
    "",
    "Honor the reference profile when present:",
    "- `vibe` is the one-sentence description of what the scene should feel like.",
    "- `motionVibe` is the motion language (slow zooms vs glitch cuts vs character-by-character).",
    "- `pacingDensity` controls how many beats fit in the scene's duration.",
    "- `palette` priors are nice-to-haves; theme tokens win.",
    "",
    "Write GSAP timelines that match `pacingDensity`. `slow` → 1-2 beats over the duration. `fast` → 4-6 beats packed in.",
    "",
    "## Forbidden",
    "",
    "- DO NOT write `<script src=…>` — the validator will reject the entire scene.",
    "- DO NOT write `onclick=` or any `on*=` attribute.",
    "- DO NOT use `position: fixed` — scenes are layered absolutely; fixed breaks the parent stage.",
    "- DO NOT register more than one timeline for the same scene id.",
    "- DO NOT inject `<script>` blocks that read or modify other scenes (only your own scene's DOM).",
    "",
    "## Output",
    "",
    "Call `emit_freeform_scene` with `html` (the full scene markup) and `designNotes` (1-2 sentences on what you tried).",
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
 * Generate a single freeform scene. Calls Gemini, validates, retries
 * once with violations in the prompt if validation fails. Returns the
 * canonicalized HTML + telemetry.
 *
 * Caller is responsible for caching — this function is a pure-ish
 * "given inputs, produce output" wrapper around the Gemini call.
 */
export async function generateFreeformScene(
  opts: GenerateFreeformSceneOptions,
): Promise<GenerateFreeformResult> {
  const model = opts.model ?? DEFAULT_GEMINI_MODEL;
  const system = buildSystemPrompt();
  const user = buildUserPrompt(opts);

  let attempt = 0;
  let firstFailure: ValidationFailure | undefined;
  let lastRaw = "";
  let lastViolations: ValidationFailure["violations"] = [];

  while (attempt < 2) {
    attempt += 1;
    const userParts: GeminiPart[] = [{ text: user }];
    if (attempt === 2) {
      // Second attempt: feed the violations back in so the model can fix.
      userParts.push({
        text: [
          "## Your previous output failed validation",
          "",
          "Here are the specific violations the validator flagged:",
          ...lastViolations.map((v) => `- ${v.rule}: ${v.message}`),
          "",
          "Emit a corrected version that fixes ALL of these.",
        ].join("\n"),
      });
    }

    const { result, usage } = await generateStructured<GeneratorToolInput>(opts.apiKey, {
      model,
      parts: userParts,
      systemInstruction: system,
      tool: TOOL,
      temperature: 0.55,
      maxOutputTokens: 4096,
    });

    const html = typeof result.html === "string" ? result.html : "";
    lastRaw = html;
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
    `generateFreeformScene: scene ${opts.sceneId} failed validation on both attempts. ` +
      `Last violations: ${lastViolations.map((v) => v.rule).join(", ")}. ` +
      `Last raw output (first 256 chars): ${lastRaw.slice(0, 256)}`,
  );
}
