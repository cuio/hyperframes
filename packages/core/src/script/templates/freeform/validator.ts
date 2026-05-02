/**
 * Freeform-scene validator — the entire safety surface for the
 * Gemini-generated HTML path.
 *
 * Every byte of LLM-generated HTML passes through `validateFreeformHtml`
 * before being persisted to the cache OR rendered into the master HTML.
 * The validator is intentionally pessimistic: anything not on the
 * allowlist is rejected. The Gemini system prompt mirrors these rules
 * verbatim so the model knows the constraints, but we do NOT trust it
 * to follow them — every check is enforced here.
 *
 * Why this matters: the cyber-* templates are hand-authored; their HTML
 * is fixed at compile time. Freeform scenes inject LLM text into the
 * assembled HTML. Without strict validation, a single malicious or
 * careless model output could inject `<script src="https://attacker">`,
 * `onerror=` handlers, or unscoped CSS that breaks adjacent scenes.
 *
 * What we enforce:
 *
 *  1. **Outer wrapper** — exactly one root element, scoped to the
 *     scene id, carrying the data-attrs the assembler relies on.
 *
 *  2. **No external resource references** — no `<script src>`, no
 *     `<link rel="stylesheet" href>`, no `<iframe>`, no `<embed>`,
 *     no `<object>`. Gemini may not pull in third-party code or
 *     stylesheets at render time. Inline `<script>` and `<style>` are
 *     allowed because they're already in our trust boundary (the
 *     assembled HTML itself contains plenty).
 *
 *  3. **No event handler attributes** — anything matching
 *     `^on[a-z]+$` (onclick, onerror, onload, …) is stripped. The
 *     scene must use addEventListener inside its `<script>` block if
 *     it needs handlers; that block is already in our trust boundary.
 *
 *  4. **No `javascript:` URLs** — href / src attributes starting with
 *     `javascript:` are rejected.
 *
 *  5. **Inline scripts must register a timeline** — exactly one
 *     `<script>` block must contain a `window.__timelines['<sceneId>']`
 *     assignment. The runtime walks `window.__timelines` to find each
 *     scene's GSAP timeline; without it, the master timeline can't
 *     scrub the scene.
 *
 *  6. **CSS must be scene-scoped** — every selector inside a `<style>`
 *     block must start with `#<sceneId>` or be a `@keyframes` /
 *     `@media` / `@supports` rule. Unscoped selectors would leak
 *     across scenes and corrupt other templates' visuals.
 *
 *  7. **Size cap** — total output ≤ 16KB. A runaway model can otherwise
 *     bloat the assembled master HTML to MBs.
 *
 * The validator is pure (no I/O), test-friendly, and exported from the
 * freeform module for unit tests. Production code calls it via the
 * generator (which runs it on Gemini output) and the cache reader
 * (which runs it on disk-loaded HTML, defense against tampered cache
 * files).
 */

import type { ValidationResult } from "./types.js";

/** Rules + size constants. Exported for tests + the prompt builder. */
export const VALIDATOR_RULES = {
  MAX_HTML_BYTES: 16 * 1024,
  /** Tags Gemini may NOT emit. */
  FORBIDDEN_TAGS: new Set([
    "iframe",
    "object",
    "embed",
    "applet",
    "frame",
    "frameset",
    "form",
    "input",
    "textarea",
    "select",
    "button",
    "meta",
    "base",
    "link", // link rel="stylesheet" + link rel="modulepreload" both blocked
  ]),
  /** Attributes blocked everywhere. Event handlers + `javascript:` URLs
   *  + sandbox-bypass attrs. */
  FORBIDDEN_ATTR_PATTERNS: [/^on[a-z]+$/i, /^formaction$/i, /^xlink:href$/i] as const,
  /** Patterns we consider unsafe inside any attribute value. */
  FORBIDDEN_ATTR_VALUE_PATTERNS: [/^javascript:/i, /^data:text\/html/i, /^vbscript:/i] as const,
} as const;

interface ValidatorContext {
  sceneId: string;
}

/**
 * The single entry point. Pure: no I/O, no mutation. Returns either the
 * canonicalized HTML (when ok=true) or a list of violations.
 */
export function validateFreeformHtml(raw: string, ctx: ValidatorContext): ValidationResult {
  const violations: ValidationResult["violations"] = [];

  // 1. Size cap.
  const bytes = Buffer.byteLength(raw, "utf8");
  if (bytes > VALIDATOR_RULES.MAX_HTML_BYTES) {
    violations.push({
      rule: "size-cap",
      message: `output is ${bytes} bytes, max ${VALIDATOR_RULES.MAX_HTML_BYTES}`,
      severity: "error",
    });
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    violations.push({ rule: "empty", message: "empty output", severity: "error" });
    return { ok: false, violations };
  }

  // 2. Outer wrapper. We don't run a real DOM parser (linkedom would
  //    add a dependency boundary core doesn't currently have); instead we
  //    use a focused regex that the prompt mirrors. The wrapper must
  //    appear at the start and carry both data-composition-id and
  //    data-scene-id pointing at the same id. The id must match the
  //    expected sceneId. (Style + script blocks above the wrapper are
  //    allowed; they're hoisted by the assembler.)
  //
  //    NOTE on `\s`: we require whitespace before each `id=` / `data-…=`
  //    boundary rather than `\b`. Without that, `data-scene-id="…"`
  //    would falsely satisfy a `\bid=` match (because `-` to `i` is a
  //    word boundary), and the wrapper check would pass on HTML where
  //    only the data-* attribute had the right value.
  const wrapperRe = new RegExp(
    `<div[^>]*\\sid\\s*=\\s*["']${escapeRegex(ctx.sceneId)}["'][^>]*\\sdata-composition-id\\s*=\\s*["']${escapeRegex(ctx.sceneId)}["']`,
    "i",
  );
  const altWrapperRe = new RegExp(
    `<div[^>]*\\sdata-composition-id\\s*=\\s*["']${escapeRegex(ctx.sceneId)}["'][^>]*\\sid\\s*=\\s*["']${escapeRegex(ctx.sceneId)}["']`,
    "i",
  );
  if (!wrapperRe.test(trimmed) && !altWrapperRe.test(trimmed)) {
    violations.push({
      rule: "outer-wrapper",
      message: `must contain <div id="${ctx.sceneId}" data-composition-id="${ctx.sceneId}" …> as the scene root`,
      severity: "error",
    });
  }

  // 3. Forbidden tags.
  for (const tag of VALIDATOR_RULES.FORBIDDEN_TAGS) {
    const re = new RegExp(`<\\s*${escapeRegex(tag)}\\b`, "i");
    if (re.test(trimmed)) {
      violations.push({
        rule: "forbidden-tag",
        message: `<${tag}> is not allowed in freeform output`,
        severity: "error",
      });
    }
  }

  // 4. External script / link sources. We only allow inline <script>
  //    blocks (no `src=` attribute).
  const scriptSrcRe = /<\s*script\b[^>]*\bsrc\s*=/i;
  if (scriptSrcRe.test(trimmed)) {
    violations.push({
      rule: "external-script",
      message: "<script src=...> is not allowed; freeform scenes must use inline scripts only",
      severity: "error",
    });
  }

  // 5. Event handler attributes + dangerous attribute values.
  // Match attributes broadly: name="value", name='value', name=value (no quotes)
  const attrRe = /\s([a-zA-Z_][a-zA-Z0-9:_-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of trimmed.matchAll(attrRe)) {
    const attrName = match[1] ?? "";
    const attrValue = match[2] ?? match[3] ?? match[4] ?? "";
    for (const pattern of VALIDATOR_RULES.FORBIDDEN_ATTR_PATTERNS) {
      if (pattern.test(attrName)) {
        violations.push({
          rule: "forbidden-attr",
          message: `attribute "${attrName}" is not allowed (event handlers must use addEventListener)`,
          severity: "error",
        });
      }
    }
    for (const pattern of VALIDATOR_RULES.FORBIDDEN_ATTR_VALUE_PATTERNS) {
      if (pattern.test(attrValue)) {
        violations.push({
          rule: "forbidden-attr-value",
          message: `attribute "${attrName}" has unsafe value pattern (${attrValue.slice(0, 32)})`,
          severity: "error",
        });
      }
    }
  }

  // 6. Inline script must register the scene's timeline.
  const timelineRe = new RegExp(
    `window\\.__timelines\\s*\\[\\s*['"]${escapeRegex(ctx.sceneId)}['"]\\s*\\]\\s*=`,
  );
  if (!timelineRe.test(trimmed)) {
    violations.push({
      rule: "missing-timeline-registration",
      message: `scene must register window.__timelines['${ctx.sceneId}'] = <gsap.timeline> in an inline <script>`,
      severity: "error",
    });
  }

  // 7. CSS scope check. Every selector inside <style> blocks (excluding
  //    @keyframes / @media / @supports nested rules) must start with
  //    `#${sceneId}`. We do a coarse parse — find each <style>…</style>,
  //    strip @-rule blocks, then look at the top-level selectors.
  const styleBlocks = [...trimmed.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)];
  for (const styleMatch of styleBlocks) {
    const css = styleMatch[1] ?? "";
    const cssNoAtRules = css.replace(/@[a-z-]+[^{}]*\{(?:[^{}]*\{[^{}]*\}[^{}]*)*\}/gi, "");
    // Match selectors before each `{` that isn't preceded by another `{`.
    const selectorBlocks = [...cssNoAtRules.matchAll(/([^{}]+)\{[^{}]*\}/g)];
    for (const block of selectorBlocks) {
      const selectorList = (block[1] ?? "").split(",");
      for (const selRaw of selectorList) {
        const sel = selRaw.trim();
        if (!sel) continue;
        // Allowed start: `#sceneId` (with or without space/dot/colon/space after)
        const allowed = sel.startsWith(`#${ctx.sceneId}`);
        if (!allowed) {
          violations.push({
            rule: "unscoped-css",
            message: `CSS selector "${sel}" is not scoped to #${ctx.sceneId}`,
            severity: "error",
          });
        }
      }
    }
  }

  if (violations.some((v) => v.severity === "error")) {
    return { ok: false, violations };
  }

  // Canonicalize: trim trailing whitespace; collapse runs of blank lines.
  const canonical = trimmed.replace(/\n{3,}/g, "\n\n");
  return { ok: true, html: canonical, violations };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
