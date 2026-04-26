import type { Template, TemplateRenderContext, ImageRef } from "./types.js";
import { escapeHtml, asString, formatSec } from "./util.js";

/**
 * Reels-grade kinetic typography templates.
 *
 * These are the scroll-stopper visuals — what shows up in the first 1.5 seconds
 * of a vertical reel and decides whether the viewer keeps watching. Each
 * template targets a specific motion language we kept seeing in viral reels:
 *
 *   HOOK_VHS_RIP    — Tape-distortion opener. Photo + RGB chromatic split text +
 *                     scanlines + jitter. The "incoming transmission" energy.
 *   KINETIC_WORDS   — Word-by-word reveal where the closing word lands with
 *                     heavier weight + italic + drop shadow. The "you can be
 *                     incredibly … SKILLED" pattern.
 *   EDITORIAL_SERIF — Pure-typography breath scene. Hairline rule with dot
 *                     terminator + script-italic phrase. Used between dense
 *                     scenes so the eye gets a break.
 *
 * All three accept an optional imageId, but only HOOK_VHS_RIP and KINETIC_WORDS
 * meaningfully use it. EDITORIAL_SERIF is photo-free by design.
 */

// ── HOOK_VHS_RIP ─────────────────────────────────────────────────────────────

export const HOOK_VHS_RIP_TEMPLATE: Template = {
  id: "hook-vhs-rip",
  description:
    "VHS / broadcast-intercept opener: photo background, RGB chromatic split title, " +
    "scanline overlay, intermittent tape-warp jitter. Use as the first scene of a video.",
  whenToUse: [
    "Scene 1 of any video — a visual scroll-stopper",
    "Pattern-interrupt moments inside a longer narrative",
    "When narration starts mid-claim ('the truth is …')",
  ],
  durationRange: { min: 2, max: 5 },
  hookOnly: true,
  propsSchema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description:
          "The big claim. ≤6 words. Will render with heavy chromatic distortion — keep punchy.",
      },
      eyebrow: {
        type: "string",
        description:
          "Small mono tag at top-left. Often a faux-broadcast label like 'INCOMING TRANSMISSION', " +
          "'CHANNEL 03', or '[ STAGE 1 / 5 ]'. 2–4 words.",
      },
      sourceTag: {
        type: "string",
        description:
          "Optional second mono tag at top-right (mirrors a broadcast ID). e.g. 'PIXFLOW ARTIST 1H'.",
      },
      imageId: {
        type: "string",
        description:
          "Image manifest id. Optional — falls back to a textured dark background. " +
          "If supplied, the photo lives behind the chromatic title with heavy tint and grain.",
      },
    },
    required: ["title"],
  },
  render(props, ctx) {
    return renderHookVhsRip(props, ctx, ctx.image ?? null);
  },
};

function renderHookVhsRip(
  props: Record<string, unknown>,
  ctx: TemplateRenderContext,
  image: ImageRef | null,
): string {
  const t = ctx.tokens;
  const dur = formatSec(ctx.durationSeconds);
  const id = ctx.sceneId;
  const tlVar = `tl_${id.replace(/-/g, "_")}`;
  const title = asString(props.title) || "UNTITLED";
  const eyebrow = asString(props.eyebrow);
  const sourceTag = asString(props.sourceTag);
  const titleEsc = escapeHtml(title);

  // The photo background is optional — if none, we paint a dark textured plate.
  const bgLayer = image
    ? `<div class="vh-photo" style="background-image: url('${escapeHtml(image.src)}'); background-position: ${image.focalPoint.x * 100}% ${image.focalPoint.y * 100}%;"></div>`
    : `<div class="vh-photo vh-photo-placeholder"></div>`;

  return `
<div class="scene scene-vhs-rip" id="${id}" data-composition-id="${id}" data-start="0" data-duration="${dur}">
  <style>
    #${id}.scene-vhs-rip { position: absolute; inset: 0; overflow: hidden; background: #0a0a0a; color: #f5f5f5; font-family: ${t.fonts.display}; }
    #${id} .vh-photo { position: absolute; inset: -6%; background-size: cover; filter: contrast(1.18) saturate(1.1) brightness(0.62); will-change: transform, filter; }
    #${id} .vh-photo-placeholder { background: radial-gradient(circle at 50% 40%, #2a1a14 0%, #0a0a0a 70%), repeating-linear-gradient(0deg, transparent 0 3px, rgba(255,255,255,0.02) 3px 4px); }
    #${id} .vh-tint { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0.30) 0%, rgba(0,0,0,0.15) 30%, rgba(0,0,0,0.55) 100%); pointer-events: none; }
    #${id} .vh-scanlines { position: absolute; inset: 0; background: repeating-linear-gradient(0deg, rgba(0,0,0,0.32) 0 2px, transparent 2px 4px); mix-blend-mode: multiply; opacity: 0.55; pointer-events: none; }
    #${id} .vh-grain { position: absolute; inset: 0; background-image: radial-gradient(circle at 25% 25%, rgba(255,255,255,0.06) 0.7px, transparent 1.2px), radial-gradient(circle at 75% 75%, rgba(255,255,255,0.05) 0.7px, transparent 1.2px); background-size: 3px 3px, 3px 3px; pointer-events: none; opacity: 0.6; mix-blend-mode: screen; }
    /* Top-left + top-right mono tags (broadcast-intercept feel). */
    #${id} .vh-meta-row { position: absolute; top: 60px; left: 60px; right: 60px; display: flex; justify-content: space-between; align-items: center; font-family: ${t.fonts.mono}; font-size: 13px; letter-spacing: 0.28em; text-transform: uppercase; color: rgba(245,245,245,0.85); opacity: 0; }
    #${id} .vh-meta-row .vh-meta-left { display: flex; align-items: center; gap: 12px; }
    #${id} .vh-meta-row .vh-dot { width: 8px; height: 8px; border-radius: 50%; background: ${t.colors.accent}; box-shadow: 0 0 14px ${t.colors.accent}; animation: vh-blink-${id} 0.9s steps(2) infinite; }
    @keyframes vh-blink-${id} { 0%, 50% { opacity: 1; } 50.01%, 100% { opacity: 0.2; } }
    /* Title stack: three layered copies of the same text, offset to make a chromatic split.
       The middle (white) layer is the "true" text. R + B layers sit slightly displaced and animate independently. */
    #${id} .vh-title-frame { position: absolute; left: 60px; right: 60px; bottom: 14%; display: flex; flex-direction: column; gap: 16px; }
    #${id} .vh-title-stack { position: relative; display: inline-block; line-height: 0.92; }
    #${id} .vh-title-layer { font-family: ${t.fonts.display}; font-size: clamp(96px, 11vw, 168px); font-weight: 900; letter-spacing: -0.025em; text-transform: uppercase; line-height: 0.92; white-space: pre-wrap; overflow-wrap: break-word; }
    #${id} .vh-title-layer.vh-title-base { position: relative; color: #ffffff; text-shadow: 0 4px 24px rgba(0,0,0,0.75); opacity: 0; transform: translateY(40px); will-change: opacity, transform; }
    #${id} .vh-title-layer.vh-title-r, #${id} .vh-title-layer.vh-title-b { position: absolute; inset: 0; pointer-events: none; mix-blend-mode: screen; opacity: 0; will-change: opacity, transform; }
    #${id} .vh-title-layer.vh-title-r { color: #ff2b3a; transform: translate(-3px, 1px); }
    #${id} .vh-title-layer.vh-title-b { color: #1ad6ff; transform: translate(3px, -1px); }
    /* Subtle wipe — a horizontal bar that slashes across the title at entry. */
    #${id} .vh-slash { position: absolute; left: 0; right: 0; top: 50%; height: 4px; background: ${t.colors.accent}; transform: translateY(-50%) scaleX(0); transform-origin: left; opacity: 0.85; mix-blend-mode: screen; }
    /* Defense-in-depth: by scene end every layer is visible regardless of GSAP state. */
    #${id} .vh-title-layer.vh-title-base { animation: vh-base-${id} 0.001s linear ${Math.max(0.01, ctx.durationSeconds - 0.05).toFixed(2)}s forwards; }
    @keyframes vh-base-${id} { to { opacity: 1; transform: translateY(0); } }
  </style>
  ${bgLayer}
  <div class="vh-tint"></div>
  <div class="vh-scanlines"></div>
  <div class="vh-grain"></div>
  ${
    eyebrow || sourceTag
      ? `<div class="vh-meta-row">
          <div class="vh-meta-left">${eyebrow ? `<span class="vh-dot"></span><span>${escapeHtml(eyebrow)}</span>` : ""}</div>
          <div class="vh-meta-right">${sourceTag ? `<span>${escapeHtml(sourceTag)}</span>` : ""}</div>
        </div>`
      : ""
  }
  <div class="vh-title-frame">
    <div class="vh-title-stack">
      <div class="vh-title-layer vh-title-r" aria-hidden="true">${titleEsc}</div>
      <div class="vh-title-layer vh-title-b" aria-hidden="true">${titleEsc}</div>
      <div class="vh-title-layer vh-title-base">${titleEsc}</div>
      <div class="vh-slash"></div>
    </div>
  </div>
  <script>
    (function(){
      var s = document.getElementById('${id}');
      if (!window.gsap || !s) return;
      var ${tlVar} = window.gsap.timeline({ paused: true });
      // Photo: gentle parallax + a sharp filter pulse at entry to mimic a tape sync.
      ${tlVar}.fromTo('#${id} .vh-photo',
        { scale: 1.12, x: -8, filter: 'contrast(1.4) saturate(1.0) brightness(0.45) hue-rotate(8deg)' },
        { scale: 1.04, x: 0, filter: 'contrast(1.18) saturate(1.1) brightness(0.62)', duration: ${dur}, ease: 'none' }, 0);
      // Slash wipe.
      ${tlVar}.fromTo('#${id} .vh-slash', { scaleX: 0 }, { scaleX: 1, duration: 0.32, ease: 'expo.out' }, 0.1);
      ${tlVar}.to('#${id} .vh-slash', { opacity: 0, duration: 0.4, ease: 'power2.in' }, 0.5);
      // Title base layer: smash up.
      ${tlVar}.fromTo('#${id} .vh-title-base',
        { opacity: 0, y: 60 },
        { opacity: 1, y: 0, duration: 0.55, ease: 'expo.out' }, 0.18);
      // Chromatic R + B layers fade in slightly after, then pulse offsets for the VHS jitter.
      ${tlVar}.fromTo('#${id} .vh-title-r', { opacity: 0 }, { opacity: 0.85, duration: 0.32, ease: 'power2.out' }, 0.25);
      ${tlVar}.fromTo('#${id} .vh-title-b', { opacity: 0 }, { opacity: 0.85, duration: 0.32, ease: 'power2.out' }, 0.25);
      // Jitter the chromatic offsets across the scene — driven by a repeating tween.
      ${tlVar}.to('#${id} .vh-title-r', { x: '+=2', y: '-=1', duration: 0.08, ease: 'none', repeat: Math.max(2, Math.floor((${ctx.durationSeconds.toFixed(
        2,
      )} - 0.6) / 0.16)), yoyo: true }, 0.6);
      ${tlVar}.to('#${id} .vh-title-b', { x: '-=2', y: '+=1', duration: 0.08, ease: 'none', repeat: Math.max(2, Math.floor((${ctx.durationSeconds.toFixed(
        2,
      )} - 0.6) / 0.16)), yoyo: true }, 0.6);
      // Meta row fades in last.
      var meta = s.querySelector('.vh-meta-row');
      if (meta) ${tlVar}.fromTo(meta, { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' }, 0.6);
      // Final-state guarantee.
      ${tlVar}.set('#${id} .vh-title-base', { opacity: 1, y: 0, clearProps: 'transform' }, Math.min(${ctx.durationSeconds.toFixed(
        2,
      )} - 0.05, 0.85));
      window.__timelines = window.__timelines || {};
      window.__timelines['${id}'] = ${tlVar};
    })();
  </script>
</div>`.trim();
}

// ── KINETIC_WORDS ────────────────────────────────────────────────────────────

export const KINETIC_WORDS_TEMPLATE: Template = {
  id: "kinetic-words",
  description:
    "Word-by-word reveal where each word lands one at a time and the closing word " +
    "renders heavier — italic, larger, with chromatic shadow. Photo or atmosphere backdrop.",
  whenToUse: [
    "Single-sentence revelations where the closing word IS the payoff",
    "Mid-video pattern interrupts ('you can be incredibly … SKILLED')",
    "Replacing a wall of text with a single rising line",
  ],
  durationRange: { min: 2.5, max: 5 },
  propsSchema: {
    type: "object",
    properties: {
      words: {
        type: "array",
        items: { type: "string" },
        minItems: 2,
        maxItems: 6,
        description:
          "The phrase, split into 3–6 words. Cinematic reels are TERSE — fewer words = stronger " +
          "punch. The LAST word is the emphasis word unless emphasisIndex is set. Examples: " +
          "['you', 'can', 'be', 'incredibly', 'skilled'] · ['we', 'don\\'t', 'need', 'more'] · " +
          "['the', 'world', 'is', 'moving', 'on']. Avoid full sentences here.",
      },
      emphasisIndex: {
        type: "number",
        description: "0-based index of the word to render in heavy italic. Defaults to last word.",
      },
      emphasisStyle: {
        type: "string",
        enum: ["italic-heavy", "outline", "underline"],
        description:
          "How to style the emphasis word. italic-heavy: bigger, italic, drop-shadow (default). " +
          "outline: outlined-only letters. underline: heavy underline strike.",
      },
      shake: {
        type: "boolean",
        description:
          "Apply a brief camera-shake on the emphasis word's entry. Default true — turn off for " +
          "calmer scenes (interview / B-roll narration). Hooks should leave it on.",
      },
      imageId: {
        type: "string",
        description: "Optional image manifest id. Renders behind the words with heavy blur + tint.",
      },
      eyebrow: { type: "string", description: "Optional small label above the phrase." },
    },
    required: ["words"],
  },
  render(props, ctx) {
    return renderKineticWords(props, ctx, ctx.image ?? null);
  },
};

function renderKineticWords(
  props: Record<string, unknown>,
  ctx: TemplateRenderContext,
  image: ImageRef | null,
): string {
  const t = ctx.tokens;
  const dur = formatSec(ctx.durationSeconds);
  const id = ctx.sceneId;
  const tlVar = `tl_${id.replace(/-/g, "_")}`;
  const wordsRaw = Array.isArray(props.words)
    ? (props.words as unknown[]).map((w) => asString(w)).filter((w) => w.length > 0)
    : [];
  // Hard cap at 6 words: the cinematic effect collapses past that. Beyond cap,
  // we trim to the first 5 + force the original last word into the emphasis slot.
  const lastWord = wordsRaw[wordsRaw.length - 1];
  const trimmedWords =
    wordsRaw.length > 6 && lastWord !== undefined ? [...wordsRaw.slice(0, 5), lastWord] : wordsRaw;
  const words = trimmedWords.length > 0 ? trimmedWords : ["LET", "IT", "LAND"];
  const emphasisIndexRaw = Number(props.emphasisIndex);
  const emphasisIndex =
    Number.isFinite(emphasisIndexRaw) && emphasisIndexRaw >= 0 && emphasisIndexRaw < words.length
      ? Math.floor(emphasisIndexRaw)
      : words.length - 1;
  const emphasisStyleRaw = asString(props.emphasisStyle) || "italic-heavy";
  const emphasisStyle =
    emphasisStyleRaw === "outline" || emphasisStyleRaw === "underline"
      ? emphasisStyleRaw
      : "italic-heavy";
  const shake = props.shake !== false; // default ON
  const eyebrow = asString(props.eyebrow);

  // Compute per-word entry timings: cluster reveals into the first 70% of the scene
  // so the emphasis word has air to breathe before the cut.
  const cascadeWindow = Math.max(0.6, ctx.durationSeconds * 0.65);
  const perWord = cascadeWindow / Math.max(1, words.length);
  const wordTimings = words.map((_, i) => 0.15 + i * perWord);

  const wordHtml = words
    .map((w, i) => {
      const cls = ["kw-word"];
      if (i === emphasisIndex) cls.push(`kw-emph kw-emph-${emphasisStyle}`);
      return `<span class="${cls.join(" ")}" data-i="${i}">${escapeHtml(w)}</span>`;
    })
    .join(" ");

  const bgLayer = image
    ? `<div class="kw-photo" style="background-image: url('${escapeHtml(image.src)}'); background-position: ${image.focalPoint.x * 100}% ${image.focalPoint.y * 100}%;"></div>`
    : `<div class="kw-photo kw-photo-placeholder"></div>`;

  return `
<div class="scene scene-kinetic-words" id="${id}" data-composition-id="${id}" data-start="0" data-duration="${dur}">
  <style>
    #${id}.scene-kinetic-words { position: absolute; inset: 0; overflow: hidden; background: ${t.colors.bg}; color: ${t.colors.fg}; font-family: ${t.fonts.display}; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 100px 90px; }
    #${id} .kw-photo { position: absolute; inset: -8%; background-size: cover; filter: blur(2px) brightness(0.5) saturate(1.1); will-change: transform; }
    #${id} .kw-photo-placeholder { background: radial-gradient(circle at 50% 50%, ${t.colors.accent}1f 0%, transparent 60%), ${t.colors.bg}; }
    #${id} .kw-tint { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.55) 100%); pointer-events: none; }
    #${id} .kw-grain { position: absolute; inset: 0; background-image: radial-gradient(circle at 30% 30%, rgba(255,255,255,0.06) 0.6px, transparent 1px), radial-gradient(circle at 70% 70%, rgba(255,255,255,0.04) 0.6px, transparent 1px); background-size: 4px 4px, 4px 4px; pointer-events: none; mix-blend-mode: screen; opacity: 0.55; }
    #${id} .kw-eyebrow { font-family: ${t.fonts.mono}; font-size: 13px; letter-spacing: 0.32em; text-transform: uppercase; color: ${t.colors.accent2}; margin-bottom: 28px; opacity: 0; transform: translateY(8px); position: relative; }
    #${id} .kw-line { position: relative; max-width: 92%; text-align: center; font-size: clamp(72px, 8.5vw, 132px); font-weight: 500; line-height: 1.04; letter-spacing: -0.015em; color: rgba(255,255,255,0.96); }
    #${id} .kw-word { display: inline-block; opacity: 0; transform: translateY(18px); will-change: opacity, transform; padding: 0 0.06em; }
    /* Emphasis: heavier, italic, larger, with chromatic drop shadow. The closing word is the payoff. */
    #${id} .kw-word.kw-emph-italic-heavy { font-weight: 900; font-style: italic; font-size: 1.14em; color: #ffffff; text-shadow: -2px 0 0 ${t.colors.accent}cc, 2px 0 0 #1ad6ffcc, 0 6px 24px rgba(0,0,0,0.6); padding-left: 0.12em; }
    #${id} .kw-word.kw-emph-outline { font-weight: 900; font-style: italic; font-size: 1.14em; -webkit-text-stroke: 2px ${t.colors.fg}; color: transparent; }
    #${id} .kw-word.kw-emph-underline { font-weight: 800; font-size: 1.06em; background-image: linear-gradient(${t.colors.accent}, ${t.colors.accent}); background-repeat: no-repeat; background-position: 0 88%; background-size: 100% 14%; }
    /* Defense-in-depth: animate every word to visible by scene end. */
    #${id} .kw-word { animation: kw-reveal-${id} 0.001s linear ${Math.max(0.01, ctx.durationSeconds - 0.05).toFixed(2)}s forwards; }
    @keyframes kw-reveal-${id} { to { opacity: 1; transform: translateY(0); } }
  </style>
  ${bgLayer}
  <div class="kw-tint"></div>
  <div class="kw-grain"></div>
  ${eyebrow ? `<div class="kw-eyebrow">${escapeHtml(eyebrow)}</div>` : ""}
  <div class="kw-line">${wordHtml}</div>
  <script>
    (function(){
      var s = document.getElementById('${id}');
      if (!window.gsap || !s) return;
      var ${tlVar} = window.gsap.timeline({ paused: true });
      var photoEl = s.querySelector('.kw-photo');
      // Photo: zoom-burst entry (1.18 → 1.04) for cinematic push-in feel,
      // then continuous slow drift across the rest of the scene.
      if (photoEl) {
        ${tlVar}.fromTo(photoEl,
          { scale: 1.18, x: -16, filter: 'blur(8px) brightness(0.3) saturate(1.2)' },
          { scale: 1.06, x: -4, filter: 'blur(2px) brightness(0.5) saturate(1.1)', duration: 0.6, ease: 'power3.out' }, 0);
        ${tlVar}.to(photoEl, { x: 8, scale: 1.04, duration: Math.max(0.4, ${dur} - 0.6), ease: 'none' }, 0.6);
      }
      var ebEl = s.querySelector('.kw-eyebrow');
      if (ebEl) ${tlVar}.fromTo(ebEl, { opacity: 0, y: 8 }, { opacity: 0.95, y: 0, duration: 0.4, ease: 'power2.out' }, 0.05);
      // Reveal each word at its own slot. We use fromTo so seek-from-end still resolves.
      // Non-emphasis words: clean fade + small lift.
      // Emphasis word: scale-impact (0.7 → 1.0 with overshoot) + chromatic shake.
      var wordEls = s.querySelectorAll('.kw-word');
      var timings = ${JSON.stringify(wordTimings)};
      var emphEl = null;
      var emphTime = 0;
      for (var i = 0; i < wordEls.length; i++) {
        var t = timings[i] != null ? timings[i] : 0.15 + i * 0.22;
        var isEmph = wordEls[i].classList.contains('kw-emph');
        ${tlVar}.fromTo(wordEls[i],
          { opacity: 0, y: isEmph ? 0 : 18, scale: isEmph ? 0.7 : 1, rotateZ: isEmph ? -2 : 0 },
          { opacity: 1, y: 0, scale: 1, rotateZ: 0, duration: isEmph ? 0.42 : 0.32, ease: isEmph ? 'back.out(2.4)' : 'power3.out' },
          t);
        if (isEmph) { emphEl = wordEls[i]; emphTime = t; }
      }
      ${
        shake
          ? `// Camera shake on the emphasis word's entry — three fast jitters,
      // staged on a wrapper so we don't fight the per-word transform.
      if (emphEl) {
        var line = s.querySelector('.kw-line');
        if (line) {
          ${tlVar}.fromTo(line,
            { x: 0 },
            { x: 8, duration: 0.04, ease: 'power1.inOut' }, emphTime + 0.08);
          ${tlVar}.to(line, { x: -6, duration: 0.04, ease: 'power1.inOut' }, emphTime + 0.12);
          ${tlVar}.to(line, { x: 4, duration: 0.04, ease: 'power1.inOut' }, emphTime + 0.16);
          ${tlVar}.to(line, { x: 0, duration: 0.04, ease: 'power1.out' }, emphTime + 0.20);
        }
      }`
          : ""
      }
      // Final-state guarantee.
      ${tlVar}.set(wordEls, { opacity: 1, y: 0, scale: 1, rotateZ: 0, clearProps: 'transform' }, Math.min(${ctx.durationSeconds.toFixed(
        2,
      )} - 0.05, ${(0.15 + words.length * (cascadeWindow / Math.max(1, words.length))).toFixed(2)}));
      window.__timelines = window.__timelines || {};
      window.__timelines['${id}'] = ${tlVar};
    })();
  </script>
</div>`.trim();
}

// ── EDITORIAL_SERIF ──────────────────────────────────────────────────────────

export const EDITORIAL_SERIF_TEMPLATE: Template = {
  id: "editorial-serif",
  description:
    "Pure-typography breath scene: hairline rule with dot terminator + script-italic phrase. " +
    "Light, airy, no photo. Use between dense scenes so the eye gets a break.",
  whenToUse: [
    "Section dividers between dense narration",
    "Single-claim transitions ('chase trends', 'or build something')",
    "Light/airy moments — a pause before a heavy reveal",
  ],
  durationRange: { min: 1.5, max: 4 },
  propsSchema: {
    type: "object",
    properties: {
      phrase: {
        type: "string",
        description:
          "Two-to-four-word italic phrase. e.g. 'chase trends', 'or build instead'. Lowercase reads best.",
      },
      orientation: {
        type: "string",
        enum: ["light", "dark"],
        description: "Background palette. light: cream/white. dark: deep navy. Default light.",
      },
      eyebrow: { type: "string", description: "Optional tiny mono tag above the phrase." },
    },
    required: ["phrase"],
  },
  render(props, ctx) {
    return renderEditorialSerif(props, ctx);
  },
};

function renderEditorialSerif(props: Record<string, unknown>, ctx: TemplateRenderContext): string {
  const t = ctx.tokens;
  const dur = formatSec(ctx.durationSeconds);
  const id = ctx.sceneId;
  const tlVar = `tl_${id.replace(/-/g, "_")}`;
  const phrase = asString(props.phrase) || "let it breathe";
  const orientationRaw = asString(props.orientation) || "light";
  const orientation = orientationRaw === "dark" ? "dark" : "light";
  const eyebrow = asString(props.eyebrow);

  const bg =
    orientation === "dark"
      ? `linear-gradient(180deg, #0a0e16 0%, #141a26 100%)`
      : `linear-gradient(180deg, #f5f1eb 0%, #e8e3da 100%)`;
  const fg = orientation === "dark" ? "#f5f1eb" : "#141a26";
  const ruleColor = orientation === "dark" ? "rgba(245,241,235,0.8)" : "rgba(20,26,38,0.78)";

  return `
<div class="scene scene-editorial-serif" id="${id}" data-composition-id="${id}" data-start="0" data-duration="${dur}">
  <style>
    #${id}.scene-editorial-serif { position: absolute; inset: 0; overflow: hidden; background: ${bg}; color: ${fg}; font-family: ${t.fonts.display}; display: flex; align-items: center; justify-content: center; padding: 80px; }
    #${id} .es-stage { display: flex; align-items: center; gap: 32px; max-width: 92%; }
    #${id} .es-rule { display: flex; align-items: center; flex: 0 1 28%; min-width: 80px; opacity: 0; }
    #${id} .es-rule .es-line { flex: 1; height: 1px; background: ${ruleColor}; transform: scaleX(0); transform-origin: left; }
    #${id} .es-rule .es-dot { width: 6px; height: 6px; border-radius: 50%; background: ${ruleColor}; flex-shrink: 0; margin-left: 4px; transform: scale(0); }
    #${id} .es-phrase { font-family: ${t.fonts.display}; font-style: italic; font-weight: 500; font-size: clamp(56px, 6.5vw, 110px); letter-spacing: 0.005em; line-height: 1.04; color: ${fg}; opacity: 0; transform: translateY(14px); white-space: nowrap; }
    #${id} .es-eyebrow { position: absolute; left: 50%; top: 12%; transform: translateX(-50%); font-family: ${t.fonts.mono}; font-size: 12px; letter-spacing: 0.32em; text-transform: uppercase; color: ${ruleColor}; opacity: 0; }
    /* Defense-in-depth: by scene end the phrase + rule are visible no matter what. */
    #${id} .es-phrase { animation: es-phrase-${id} 0.001s linear ${Math.max(0.01, ctx.durationSeconds - 0.05).toFixed(2)}s forwards; }
    #${id} .es-rule { animation: es-rule-${id} 0.001s linear ${Math.max(0.01, ctx.durationSeconds - 0.05).toFixed(2)}s forwards; }
    #${id} .es-rule .es-line { animation: es-line-${id} 0.001s linear ${Math.max(0.01, ctx.durationSeconds - 0.05).toFixed(2)}s forwards; }
    #${id} .es-rule .es-dot { animation: es-dot-${id} 0.001s linear ${Math.max(0.01, ctx.durationSeconds - 0.05).toFixed(2)}s forwards; }
    @keyframes es-phrase-${id} { to { opacity: 1; transform: translateY(0); } }
    @keyframes es-rule-${id} { to { opacity: 1; } }
    @keyframes es-line-${id} { to { transform: scaleX(1); } }
    @keyframes es-dot-${id} { to { transform: scale(1); } }
  </style>
  ${eyebrow ? `<div class="es-eyebrow">${escapeHtml(eyebrow)}</div>` : ""}
  <div class="es-stage">
    <div class="es-rule"><div class="es-line"></div><div class="es-dot"></div></div>
    <div class="es-phrase">${escapeHtml(phrase)}</div>
  </div>
  <script>
    (function(){
      var s = document.getElementById('${id}');
      if (!window.gsap || !s) return;
      var ${tlVar} = window.gsap.timeline({ paused: true });
      var ebEl = s.querySelector('.es-eyebrow');
      if (ebEl) ${tlVar}.fromTo(ebEl, { opacity: 0 }, { opacity: 0.85, duration: 0.4, ease: 'power2.out' }, 0.05);
      ${tlVar}.fromTo('#${id} .es-rule', { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'power2.out' }, 0.1);
      ${tlVar}.fromTo('#${id} .es-rule .es-line', { scaleX: 0 }, { scaleX: 1, duration: 0.55, ease: 'expo.out' }, 0.12);
      ${tlVar}.fromTo('#${id} .es-rule .es-dot', { scale: 0 }, { scale: 1, duration: 0.32, ease: 'back.out(2.4)' }, 0.6);
      ${tlVar}.fromTo('#${id} .es-phrase', { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' }, 0.32);
      ${tlVar}.set('#${id} .es-phrase', { opacity: 1, y: 0, clearProps: 'transform' }, Math.min(${ctx.durationSeconds.toFixed(
        2,
      )} - 0.05, 1.0));
      window.__timelines = window.__timelines || {};
      window.__timelines['${id}'] = ${tlVar};
    })();
  </script>
</div>`.trim();
}
