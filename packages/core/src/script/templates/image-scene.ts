import type { Template, TemplateRenderContext, ImageRef } from "./types.js";
import { escapeHtml, asString, formatSec } from "./util.js";

/**
 * Image-scene template — one entry point, three flagship treatments.
 *
 * The visual director picks per-scene treatment id; the template
 * dispatches to the matching recipe. Each recipe is an opinionated
 * combination of layout + CSS + GSAP that handles a single visual
 * archetype well, so the same source image can appear in completely
 * different forms across a video without manual per-scene authoring.
 *
 * Treatments shipped today:
 *   editorial-bleed  — Full-bleed image, large display headline crossing
 *                      the subject. References: Sociyell cowboy carousel.
 *   duotone-bg       — Atmosphere image as backdrop, recolored toward
 *                      the theme's accent palette, content in the safe
 *                      zone with a backdrop blur for legibility.
 *   type-mask-fill   — Photo visible only inside the headline letters
 *                      (background-clip: text). The big-reveal moment.
 */

export const TREATMENT_IDS = ["editorial-bleed", "duotone-bg", "type-mask-fill"] as const;
export type TreatmentId = (typeof TREATMENT_IDS)[number];

const ROLE_HINT_BY_TREATMENT: Record<TreatmentId, string> = {
  "editorial-bleed":
    "Strong silhouette / dominant subject. Hero or subject role. Hooks, openers, climactic moments.",
  "duotone-bg":
    "Atmosphere or graphic role. Lives behind text — gradient, blur, abstract motion. Section underlay.",
  "type-mask-fill":
    "Hero or subject role with strong contrast. Big-reveal scenes, transitions between acts.",
};

export const IMAGE_SCENE_TEMPLATE: Template = {
  id: "image-scene",
  description:
    "Image-driven scene: one image rendered through one of three flagship treatments " +
    "(editorial-bleed / duotone-bg / type-mask-fill). Designed for re-using a small image " +
    "library across many scenes via varying treatment, crop, and color grade.",
  whenToUse: [
    "Scene has a strong visual asset and benefits from an image-led layout",
    "Hooks, climaxes, or section dividers where photography carries the message",
    "When the planner wants to escape pure-typography monotony",
  ],
  durationRange: { min: 2.5, max: 9 },
  propsSchema: {
    type: "object",
    properties: {
      imageId: {
        type: "string",
        description:
          "Image manifest id (run `hyperframes images list`). The visual director assigns this; do not invent ids.",
      },
      treatment: {
        type: "string",
        enum: [...TREATMENT_IDS],
        description:
          "How the image is presented. " +
          Object.entries(ROLE_HINT_BY_TREATMENT)
            .map(([k, v]) => `${k}: ${v}`)
            .join(" | "),
      },
      headline: {
        type: "string",
        description:
          "The big headline text. Keep under 12 words for editorial-bleed and type-mask-fill.",
      },
      subhead: {
        type: "string",
        description: "Optional second line / subhead under the headline.",
      },
      eyebrow: {
        type: "string",
        description: "Optional small uppercase label above the headline (4 words max).",
      },
      accentBlock: {
        type: "string",
        description:
          "Optional short tag rendered as a colored sticker (e.g. 'WITH AI'). Editorial-bleed only.",
      },
      accentWord: {
        type: "string",
        description: "One word from the headline to highlight in the theme's accent color.",
      },
    },
    required: ["imageId", "treatment", "headline"],
  },
  render(props, ctx) {
    const treatmentRaw = asString(props.treatment) || "editorial-bleed";
    const treatment = (TREATMENT_IDS as readonly string[]).includes(treatmentRaw)
      ? (treatmentRaw as TreatmentId)
      : "editorial-bleed";
    if (!ctx.image) {
      // Defensive: assembler should have resolved this. Fall back to
      // a clearly-labeled placeholder rather than crashing the render.
      return renderMissingImage(props, ctx);
    }
    if (treatment === "editorial-bleed") return renderEditorialBleed(props, ctx, ctx.image);
    if (treatment === "duotone-bg") return renderDuotoneBg(props, ctx, ctx.image);
    return renderTypeMaskFill(props, ctx, ctx.image);
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────

function focalCss(image: ImageRef): string {
  return `${(image.focalPoint.x * 100).toFixed(1)}% ${(image.focalPoint.y * 100).toFixed(1)}%`;
}

function renderMissingImage(props: Record<string, unknown>, ctx: TemplateRenderContext): string {
  const id = asString(props.imageId) || "(no imageId)";
  const headline = asString(props.headline) || "Image not found";
  const dur = formatSec(ctx.durationSeconds);
  return `
<div class="scene scene-image-missing" id="${ctx.sceneId}" data-composition-id="${ctx.sceneId}" data-start="0" data-duration="${dur}">
  <style>
    #${ctx.sceneId}.scene-image-missing { position: absolute; inset: 0; background: ${ctx.tokens.colors.bg}; color: ${ctx.tokens.colors.fg}; display: flex; align-items: center; justify-content: center; padding: 80px; font-family: ${ctx.tokens.fonts.body}; }
    #${ctx.sceneId} .imw { max-width: 60ch; text-align: center; }
    #${ctx.sceneId} .imw .tag { font-family: ${ctx.tokens.fonts.mono}; font-size: 14px; letter-spacing: 0.18em; text-transform: uppercase; color: ${ctx.tokens.colors.accent3}; margin-bottom: 18px; }
    #${ctx.sceneId} .imw h1 { font-family: ${ctx.tokens.fonts.display}; font-size: 64px; font-weight: 700; line-height: 1.05; }
  </style>
  <div class="imw">
    <div class="tag">image '${escapeHtml(id)}' not in manifest</div>
    <h1>${escapeHtml(headline)}</h1>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl_${ctx.sceneId.replace(/-/g, "_")} = gsap.timeline({ paused: true });
    tl_${ctx.sceneId.replace(/-/g, "_")}.set({}, {}, ${dur});
    window.__timelines["${ctx.sceneId}"] = tl_${ctx.sceneId.replace(/-/g, "_")};
  </script>
</div>`;
}

// ── Treatment 1: editorial-bleed ──────────────────────────────────────────
//
// Full-bleed image, oversized serif headline laid OVER the subject. Subtle
// vignette gradient at the bottom for legibility. Optional eyebrow on top
// and accent sticker block. Ken Burns 1.0 → 1.04 over the scene's duration
// for a quiet sense of motion. Headline rises in word-by-word with a
// slight stagger.

function renderEditorialBleed(
  props: Record<string, unknown>,
  ctx: TemplateRenderContext,
  image: ImageRef,
): string {
  const t = ctx.tokens;
  const dur = formatSec(ctx.durationSeconds);
  const id = ctx.sceneId;
  const tlVar = `tl_${id.replace(/-/g, "_")}`;
  const eyebrow = asString(props.eyebrow);
  const headline = asString(props.headline) || "";
  const subhead = asString(props.subhead);
  const accentBlock = asString(props.accentBlock);
  const accentWord = asString(props.accentWord).toLowerCase();

  const words = headline.split(/(\s+)/).filter((w) => w.length > 0);
  const wordHtml = words
    .map((w, i) => {
      if (/^\s+$/.test(w)) return '<span class="eb-space">&nbsp;</span>';
      const stripped = w.toLowerCase().replace(/[^a-z0-9]/g, "");
      const isAccent = accentWord && stripped === accentWord;
      return `<span class="eb-word${isAccent ? " eb-accent" : ""}" style="--i:${i}">${escapeHtml(w)}</span>`;
    })
    .join("");

  return `
<div class="scene scene-eb" id="${id}" data-composition-id="${id}" data-start="0" data-duration="${dur}">
  <style>
    #${id}.scene-eb { position: absolute; inset: 0; overflow: hidden; background: ${t.colors.bg}; color: #ffffff; font-family: ${t.fonts.display}; }
    #${id} .eb-img { position: absolute; inset: -8%; background-image: url("${escapeHtml(image.src)}"); background-size: cover; background-position: ${focalCss(image)}; will-change: transform; }
    #${id} .eb-vignette { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0.0) 35%, rgba(0,0,0,0.15) 60%, rgba(0,0,0,0.55) 100%); pointer-events: none; }
    #${id} .eb-side { position: absolute; inset: 0 50% 0 0; background: linear-gradient(90deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.1) 60%, transparent 100%); pointer-events: none; opacity: 0.55; }
    #${id} .eb-content { position: absolute; left: 8%; right: 8%; bottom: 9%; display: flex; flex-direction: column; gap: 24px; }
    #${id} .eb-eyebrow { font-family: ${t.fonts.mono}; font-size: 14px; letter-spacing: 0.28em; text-transform: uppercase; color: rgba(255,255,255,0.85); opacity: 0; transform: translateY(8px); }
    #${id} .eb-headline { font-family: ${t.fonts.display}; font-size: clamp(96px, 9vw, 168px); font-weight: 700; line-height: 0.95; letter-spacing: -0.02em; color: #ffffff; text-shadow: 0 2px 18px rgba(0,0,0,0.55); }
    #${id} .eb-headline .eb-word { display: inline-block; opacity: 0; transform: translateY(40px) scale(1.02); }
    #${id} .eb-headline .eb-accent { font-style: italic; color: ${t.colors.accent}; }
    #${id} .eb-subhead { font-family: ${t.fonts.body}; font-size: 26px; line-height: 1.3; color: rgba(255,255,255,0.9); max-width: 60%; opacity: 0; transform: translateY(12px); }
    #${id} .eb-accent-block { position: absolute; right: 8%; bottom: 24%; padding: 14px 22px; background: ${t.colors.accent}; color: ${t.colors.bg}; font-family: ${t.fonts.display}; font-size: 32px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; transform: rotate(-2deg) scale(0.9); opacity: 0; transform-origin: center; box-shadow: 0 8px 24px rgba(0,0,0,0.35); }
    #${id} .eb-rule { position: absolute; left: 8%; top: 9%; width: 0; height: 3px; background: ${t.colors.accent}; opacity: 0.95; }
  </style>
  <div class="eb-img"></div>
  <div class="eb-side"></div>
  <div class="eb-vignette"></div>
  <div class="eb-rule"></div>
  <div class="eb-content">
    ${eyebrow ? `<div class="eb-eyebrow">${escapeHtml(eyebrow)}</div>` : ""}
    <h1 class="eb-headline">${wordHtml}</h1>
    ${subhead ? `<div class="eb-subhead">${escapeHtml(subhead)}</div>` : ""}
  </div>
  ${accentBlock ? `<div class="eb-accent-block">${escapeHtml(accentBlock)}</div>` : ""}
  <script>
    window.__timelines = window.__timelines || {};
    const ${tlVar} = gsap.timeline({ paused: true });
    ${tlVar}.fromTo("#${id} .eb-img", { scale: 1.0, x: 0 }, { scale: 1.05, x: -22, duration: ${dur}, ease: "none" }, 0);
    ${tlVar}.to("#${id} .eb-rule", { width: "min(360px, 22%)", duration: 0.55, ease: "power3.out" }, 0.05);
    ${tlVar}.to("#${id} .eb-eyebrow", { opacity: 0.95, y: 0, duration: 0.5, ease: "power2.out" }, 0.18);
    ${tlVar}.to("#${id} .eb-headline .eb-word", { opacity: 1, y: 0, scale: 1, duration: 0.65, ease: "power3.out", stagger: 0.06 }, 0.32);
    ${tlVar}.to("#${id} .eb-subhead", { opacity: 1, y: 0, duration: 0.55, ease: "power2.out" }, 0.32 + 0.06 * ${words.filter((w) => !/^\\s+$/.test(w)).length} + 0.18);
    ${tlVar}.fromTo("#${id} .eb-accent-block", { opacity: 0, scale: 0.7, rotate: -8 }, { opacity: 1, scale: 0.95, rotate: -2, duration: 0.45, ease: "back.out(2.4)" }, 0.32 + 0.06 * ${words.filter((w) => !/^\\s+$/.test(w)).length} + 0.45);
    ${tlVar}.set({}, {}, ${dur});
    window.__timelines["${id}"] = ${tlVar};
  </script>
</div>`;
}

// ── Treatment 2: duotone-bg ───────────────────────────────────────────────
//
// Atmosphere image as full-bleed background, recolored toward the theme's
// accent palette via a stacked gradient overlay using the dominant color
// of the image. Slow parallax pan across the scene for a sense of breath.
// Content layer sits in a centered safe zone with a backdrop-blurred plate
// for legibility, regardless of what's beneath.

function renderDuotoneBg(
  props: Record<string, unknown>,
  ctx: TemplateRenderContext,
  image: ImageRef,
): string {
  const t = ctx.tokens;
  const dur = formatSec(ctx.durationSeconds);
  const id = ctx.sceneId;
  const tlVar = `tl_${id.replace(/-/g, "_")}`;
  const eyebrow = asString(props.eyebrow);
  const headline = asString(props.headline) || "";
  const subhead = asString(props.subhead);

  return `
<div class="scene scene-duotone" id="${id}" data-composition-id="${id}" data-start="0" data-duration="${dur}">
  <style>
    #${id}.scene-duotone { position: absolute; inset: 0; overflow: hidden; background: ${t.colors.bg}; color: ${t.colors.fg}; font-family: ${t.fonts.display}; }
    #${id} .dt-img { position: absolute; inset: -10%; background-image: url("${escapeHtml(image.src)}"); background-size: cover; background-position: ${focalCss(image)}; filter: blur(6px) saturate(1.05) brightness(0.85); will-change: transform; }
    #${id} .dt-overlay { position: absolute; inset: 0; background: linear-gradient(135deg, ${t.colors.accent}33 0%, transparent 45%, ${t.colors.accent2}26 100%), radial-gradient(circle at 30% 30%, ${image.dominantColor}55 0%, transparent 55%); mix-blend-mode: screen; pointer-events: none; }
    #${id} .dt-tint { position: absolute; inset: 0; background: ${t.colors.bg}; opacity: 0.55; pointer-events: none; }
    #${id} .dt-grain { position: absolute; inset: 0; background-image: radial-gradient(circle at 25% 25%, rgba(255,255,255,0.04) 1px, transparent 1.5px), radial-gradient(circle at 75% 75%, rgba(255,255,255,0.03) 1px, transparent 1.5px); background-size: 6px 6px, 6px 6px; pointer-events: none; opacity: 0.7; }
    #${id} .dt-content { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 80px 100px; text-align: center; }
    #${id} .dt-plate { padding: 44px 60px; border: 1px solid ${t.colors.subtle}; background: rgba(0,0,0,0.30); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border-radius: 8px; max-width: 64ch; opacity: 0; transform: translateY(18px); }
    #${id} .dt-eyebrow { font-family: ${t.fonts.mono}; font-size: 13px; letter-spacing: 0.28em; text-transform: uppercase; color: ${t.colors.accent2}; margin-bottom: 22px; }
    #${id} .dt-headline { font-family: ${t.fonts.display}; font-size: clamp(64px, 6vw, 116px); font-weight: 700; line-height: 1.02; letter-spacing: -0.015em; margin-bottom: 22px; color: ${t.colors.fg}; }
    #${id} .dt-subhead { font-family: ${t.fonts.body}; font-size: 22px; line-height: 1.45; color: ${t.colors.muted}; }
  </style>
  <div class="dt-img"></div>
  <div class="dt-overlay"></div>
  <div class="dt-tint"></div>
  <div class="dt-grain"></div>
  <div class="dt-content">
    <div class="dt-plate">
      ${eyebrow ? `<div class="dt-eyebrow">${escapeHtml(eyebrow)}</div>` : ""}
      <h1 class="dt-headline">${escapeHtml(headline)}</h1>
      ${subhead ? `<div class="dt-subhead">${escapeHtml(subhead)}</div>` : ""}
    </div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const ${tlVar} = gsap.timeline({ paused: true });
    ${tlVar}.fromTo("#${id} .dt-img", { x: -16, y: -8, scale: 1.06 }, { x: 16, y: 8, scale: 1.10, duration: ${dur}, ease: "none" }, 0);
    ${tlVar}.fromTo("#${id} .dt-tint", { opacity: 0.75 }, { opacity: 0.55, duration: 0.6, ease: "power2.out" }, 0);
    ${tlVar}.to("#${id} .dt-plate", { opacity: 1, y: 0, duration: 0.7, ease: "power3.out" }, 0.25);
    ${tlVar}.set({}, {}, ${dur});
    window.__timelines["${id}"] = ${tlVar};
  </script>
</div>`;
}

// ── Treatment 3: type-mask-fill ───────────────────────────────────────────
//
// Photo visible only inside the headline letters via background-clip: text.
// The negative space is the theme's bg color so the image silhouette
// floats. Subtle scale-in on letters, photo Ken-Burns'd in subtly behind.
// Subhead in normal type follows.

function renderTypeMaskFill(
  props: Record<string, unknown>,
  ctx: TemplateRenderContext,
  image: ImageRef,
): string {
  const t = ctx.tokens;
  const dur = formatSec(ctx.durationSeconds);
  const id = ctx.sceneId;
  const tlVar = `tl_${id.replace(/-/g, "_")}`;
  const eyebrow = asString(props.eyebrow);
  const headline = (asString(props.headline) || "").toUpperCase();
  const subhead = asString(props.subhead);

  // For mask-fill we render each letter as its own span so we can stagger
  // the scale-in. Spaces become normal whitespace nodes.
  const letters = Array.from(headline)
    .map((ch, i) => {
      if (ch === " ") return '<span class="tm-sp">&nbsp;</span>';
      return `<span class="tm-l" style="--i:${i}">${escapeHtml(ch)}</span>`;
    })
    .join("");

  return `
<div class="scene scene-typemask" id="${id}" data-composition-id="${id}" data-start="0" data-duration="${dur}">
  <style>
    #${id}.scene-typemask { position: absolute; inset: 0; overflow: hidden; background: ${t.colors.bg}; color: ${t.colors.fg}; font-family: ${t.fonts.display}; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 80px; }
    #${id} .tm-eyebrow { font-family: ${t.fonts.mono}; font-size: 14px; letter-spacing: 0.32em; text-transform: uppercase; color: ${t.colors.accent2}; margin-bottom: 36px; opacity: 0; transform: translateY(8px); }
    #${id} .tm-headline { font-family: ${t.fonts.display}; font-size: clamp(140px, 16vw, 280px); font-weight: 900; line-height: 0.92; letter-spacing: -0.04em; text-align: center; max-width: 95%; word-wrap: break-word; }
    #${id} .tm-headline .tm-l { display: inline-block; background-image: url("${escapeHtml(image.src)}"); background-size: 170% auto; background-position: ${focalCss(image)}; -webkit-background-clip: text; background-clip: text; color: transparent; -webkit-text-fill-color: transparent; opacity: 0; transform: scale(1.06); will-change: transform; }
    #${id} .tm-headline .tm-sp { display: inline-block; }
    #${id} .tm-subhead { font-family: ${t.fonts.body}; font-size: 26px; line-height: 1.4; color: ${t.colors.muted}; margin-top: 44px; max-width: 56ch; text-align: center; opacity: 0; transform: translateY(12px); }
    /* Subtle moving glow behind the headline echoing the image's dominant color. */
    #${id} .tm-glow { position: absolute; inset: 20% 15%; background: radial-gradient(circle, ${image.dominantColor}33 0%, transparent 65%); filter: blur(28px); opacity: 0; pointer-events: none; }
  </style>
  <div class="tm-glow"></div>
  ${eyebrow ? `<div class="tm-eyebrow">${escapeHtml(eyebrow)}</div>` : ""}
  <h1 class="tm-headline">${letters}</h1>
  ${subhead ? `<div class="tm-subhead">${escapeHtml(subhead)}</div>` : ""}
  <script>
    window.__timelines = window.__timelines || {};
    const ${tlVar} = gsap.timeline({ paused: true });
    ${tlVar}.to("#${id} .tm-glow", { opacity: 0.65, duration: 0.9, ease: "power2.out" }, 0.05);
    ${tlVar}.to("#${id} .tm-eyebrow", { opacity: 0.95, y: 0, duration: 0.5, ease: "power2.out" }, 0.1);
    ${tlVar}.to("#${id} .tm-headline .tm-l", { opacity: 1, scale: 1, duration: 0.7, ease: "expo.out", stagger: 0.025 }, 0.2);
    ${tlVar}.to("#${id} .tm-headline .tm-l", { backgroundPositionX: "+=12%", duration: ${dur}, ease: "none" }, 0.2);
    ${tlVar}.to("#${id} .tm-subhead", { opacity: 1, y: 0, duration: 0.55, ease: "power2.out" }, 0.6 + 0.025 * ${Array.from(headline).length});
    ${tlVar}.set({}, {}, ${dur});
    window.__timelines["${id}"] = ${tlVar};
  </script>
</div>`;
}
