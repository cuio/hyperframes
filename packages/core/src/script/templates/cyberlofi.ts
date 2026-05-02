/**
 * Cyberlofi templates — pure-black canvas, single-word reveals, dense data
 * blocks, halftone-dithered imagery. Modeled after the iglooghost / Pixflow
 * after-effects aesthetic the user pinned in their reference profile:
 *
 *   - Pure black background; massive negative space (≥60% of frame)
 *   - JetBrains Mono / Space Mono throughout (no display serifs)
 *   - Asymmetric corner-pinned composition; never centered
 *   - Pixel-green / glitch-pink accents on black + white core
 *   - Single-word headlines (CONSIDER, INTERNET) OR dense data blocks
 *   - Halftone / dither overlay on photographic content
 *   - Glitch transitions: RGB shift, scanlines, hard pixel cuts
 *
 * Three flagship templates ship in this module — the Reels equivalent of
 * `image-scene`'s editorial-bleed / duotone-bg / type-mask-fill trio. The
 * planner picks them when the active theme is `cyberlofi` or when the
 * reference profile recommends them. Each is fully self-contained: HTML +
 * scoped CSS + a paused per-scene GSAP timeline registered as
 * window.__timelines[id], same contract as every other builtin template.
 *
 * Three templates:
 *   CYBER_DATA_CLUSTER  — Dense data text block pinned to one corner +
 *                          single accent word in another quadrant. Used
 *                          for stat reveals where the "data" itself is the
 *                          visual (lat/long / coordinates / log lines).
 *   CYBER_GLITCH_WORD   — Single big word with chromatic RGB-shift
 *                          letter-by-letter reveal + scanline overlay.
 *                          The big-impact moment.
 *   CYBER_PIXEL_STILL   — Halftone-dithered image (CSS pattern overlay)
 *                          with grid-overlay frame + small caption block.
 *                          Falls back to abstract dither when no image
 *                          attached.
 */

import type { Template, TemplateRenderContext, ImageRef } from "./types.js";
import { escapeHtml, asString, formatSec } from "./util.js";

// ── CYBER_DATA_CLUSTER ─────────────────────────────────────────────────────

export const CYBER_DATA_CLUSTER_TEMPLATE: Template = {
  id: "cyber-data-cluster",
  description:
    "Cyberlofi data scene: pure-black canvas with a dense monospaced data block " +
    "pinned to one corner and a single accent word floating in another quadrant. " +
    "Massive negative space — feels like a terminal log inside a black void.",
  whenToUse: [
    "Stat reveals where the raw data IS the visual (coords, log lines, IDs)",
    "Cyberlofi / glitch / data-art aesthetic projects",
    "Scenes that need a single accent word + supporting context, no headline",
  ],
  durationRange: { min: 2.5, max: 7 },
  propsSchema: {
    type: "object",
    properties: {
      accentWord: {
        type: "string",
        description:
          "ONE word, uppercase, displayed large in the upper-left quadrant. The whole scene " +
          "hangs on this word. e.g. 'CONSIDER', 'INTERNET', '$4B', '1,000'.",
      },
      dataLines: {
        type: "array",
        items: { type: "string" },
        description:
          "8-30 lines of dense monospaced data text rendered in the bottom-right quadrant " +
          "in 9-11px JetBrains Mono. Use real-feeling formats: lat/long, ISO timestamps, " +
          "performance numbers, ID strings. The aesthetic is 'this is real telemetry' — " +
          "viewers don't need to read it, they need to feel its density.",
      },
      cornerTag: {
        type: "string",
        description:
          "Optional tiny tag at top-right (≤30 chars). Mono uppercase. e.g. 'CHANNEL 03 / 99' " +
          "or '[ FRAME 042 / SECTOR 7 ]'.",
      },
      footerTag: {
        type: "string",
        description: "Optional tiny tag at bottom-left. Mono uppercase. e.g. 'STAGE 02 ▸ 05'.",
      },
    },
    required: ["accentWord", "dataLines"],
  },
  render(props, ctx) {
    return renderCyberDataCluster(props, ctx);
  },
};

function renderCyberDataCluster(
  props: Record<string, unknown>,
  ctx: TemplateRenderContext,
): string {
  const t = ctx.tokens;
  const id = ctx.sceneId;
  const tlVar = `tl_${id.replace(/-/g, "_")}`;
  const dur = formatSec(ctx.durationSeconds);
  const accent = asString(props.accentWord) || "—";
  const lines = (Array.isArray(props.dataLines) ? props.dataLines : [])
    .filter((line): line is string => typeof line === "string")
    .slice(0, 30);
  const cornerTag = asString(props.cornerTag);
  const footerTag = asString(props.footerTag);

  const dataHtml = lines
    .map((line, i) => `<div class="cdc-line" style="--i:${i}">${escapeHtml(line)}</div>`)
    .join("");

  return `
<style>
  #${id}.scene-cyber-data-cluster {
    background: ${t.colors.bg};
    color: ${t.colors.fg};
    font-family: ${t.fonts.mono};
    position: absolute; inset: 0; overflow: hidden;
  }
  /* Subtle scanline overlay — faint horizontal lines every 4px. */
  #${id} .cdc-scanlines {
    position: absolute; inset: 0; pointer-events: none; z-index: 2;
    background-image: repeating-linear-gradient(
      to bottom,
      ${t.colors.fg}06 0,
      ${t.colors.fg}06 1px,
      transparent 1px,
      transparent 4px
    );
    mix-blend-mode: lighten;
    opacity: 0.5;
  }
  /* Accent word — big, uppercase, pinned to upper-left ~30% of frame. */
  #${id} .cdc-accent {
    position: absolute;
    left: 8%; top: 22%;
    font-family: ${t.fonts.display};
    font-weight: 800;
    font-size: clamp(120px, 14vw, 240px);
    letter-spacing: 0.04em;
    line-height: 0.9;
    color: ${t.colors.fg};
    text-transform: uppercase;
    opacity: 0;
    transform: translateY(20px);
    will-change: transform, opacity;
  }
  #${id} .cdc-accent-glow {
    position: absolute; inset: -10px;
    color: ${t.colors.accent};
    filter: blur(24px);
    opacity: 0;
    z-index: -1;
  }
  /* Data block — pinned to bottom-right ~40% of frame. */
  #${id} .cdc-data {
    position: absolute;
    right: 6%; bottom: 8%;
    width: 38%;
    max-height: 70%;
    overflow: hidden;
    font-size: 11px;
    line-height: 1.45;
    color: ${t.colors.muted};
    column-count: 1;
    text-align: left;
    letter-spacing: 0;
  }
  #${id} .cdc-line {
    opacity: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    will-change: opacity;
  }
  /* Sparse halftone dither texture — anchors the bottom-left for visual weight */
  #${id} .cdc-dither {
    position: absolute;
    left: 6%; bottom: 14%;
    width: 80px; height: 80px;
    opacity: 0;
    background-image: radial-gradient(circle, ${t.colors.fg}aa 1px, transparent 1.5px);
    background-size: 6px 6px;
    filter: contrast(1.2);
    will-change: opacity;
  }
  /* Corner + footer micro-tags */
  #${id} .cdc-tag {
    position: absolute;
    font-size: 9px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: ${t.colors.muted};
    opacity: 0;
    will-change: opacity;
  }
  #${id} .cdc-tag.corner { right: 6%; top: 6%; }
  #${id} .cdc-tag.footer { left: 6%; bottom: 4%; }
  /* Crosshair on accent word — pixel-art frame anchor */
  #${id} .cdc-crosshair {
    position: absolute;
    left: 8%; top: 22%;
    width: 12px; height: 12px;
    border-left: 1px solid ${t.colors.accent};
    border-top: 1px solid ${t.colors.accent};
    transform: translate(-20px, -20px);
    opacity: 0;
  }
</style>
<div id="${id}" class="scene-cyber-data-cluster" data-composition-id="${id}" data-scene-id="${id}" data-duration="${dur}">
  <div class="cdc-scanlines"></div>
  <div class="cdc-crosshair"></div>
  <div class="cdc-accent">
    <div class="cdc-accent-glow">${escapeHtml(accent)}</div>
    ${escapeHtml(accent)}
  </div>
  <div class="cdc-dither"></div>
  ${cornerTag ? `<div class="cdc-tag corner">${escapeHtml(cornerTag)}</div>` : ""}
  ${footerTag ? `<div class="cdc-tag footer">${escapeHtml(footerTag)}</div>` : ""}
  <div class="cdc-data">${dataHtml}</div>
</div>
<script>
  (function(){
    const ${tlVar} = gsap.timeline({ paused: true });
    ${tlVar}.to('#${id} .cdc-crosshair', { opacity: 1, duration: 0.2, ease: 'power2.out' }, 0);
    ${tlVar}.to('#${id} .cdc-accent', { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' }, 0.05);
    ${tlVar}.to('#${id} .cdc-accent-glow', { opacity: 0.7, duration: 0.4, ease: 'power2.out' }, 0.1);
    ${tlVar}.to('#${id} .cdc-tag', { opacity: 1, duration: 0.3, stagger: 0.05, ease: 'power2.out' }, 0.2);
    ${tlVar}.to('#${id} .cdc-line', {
      opacity: 1,
      stagger: { each: 0.04, from: 'start' },
      duration: 0.15,
      ease: 'none',
    }, 0.3);
    ${tlVar}.to('#${id} .cdc-dither', { opacity: 0.7, duration: 0.4, ease: 'power2.out' }, 0.7);
    window.__timelines = window.__timelines || {};
    window.__timelines['${id}'] = ${tlVar};
  })();
</script>
`.trim();
}

// ── CYBER_GLITCH_WORD ──────────────────────────────────────────────────────

export const CYBER_GLITCH_WORD_TEMPLATE: Template = {
  id: "cyber-glitch-word",
  description:
    "Single uppercase word reveal with chromatic RGB-shift, scanline jitter, " +
    "and pixel-cut glitch. Pure-black void around it. Reserve for the most " +
    "impactful single-word moments in cyberlofi videos — too much glitch is noise.",
  whenToUse: [
    "Single-word climaxes that NEED to land hard",
    "Act-break or pre-CTA pattern interrupts",
    "Scenes where the narration is one short declarative sentence",
  ],
  durationRange: { min: 1.5, max: 4 },
  propsSchema: {
    type: "object",
    properties: {
      word: {
        type: "string",
        description:
          "ONE word. Uppercase. ≤14 chars. e.g. 'TEMPLATE', 'FOLLOW', 'STOP', 'CONSIDER'. " +
          "Anything longer breaks the chromatic-split layout.",
      },
      undertext: {
        type: "string",
        description:
          "Optional small mono caption below the word. ≤40 chars, lowercase preferred. " +
          "e.g. 'a structural shift, not a layoff'.",
      },
      cornerTag: {
        type: "string",
        description: "Optional tiny mono tag in the top-left corner. ≤24 chars uppercase.",
      },
    },
    required: ["word"],
  },
  render(props, ctx) {
    return renderCyberGlitchWord(props, ctx);
  },
};

function renderCyberGlitchWord(props: Record<string, unknown>, ctx: TemplateRenderContext): string {
  const t = ctx.tokens;
  const id = ctx.sceneId;
  const tlVar = `tl_${id.replace(/-/g, "_")}`;
  const dur = formatSec(ctx.durationSeconds);
  const word = asString(props.word).toUpperCase().slice(0, 14) || "—";
  const undertext = asString(props.undertext);
  const cornerTag = asString(props.cornerTag);

  return `
<style>
  #${id}.scene-cyber-glitch-word {
    background: ${t.colors.bg};
    color: ${t.colors.fg};
    font-family: ${t.fonts.display};
    position: absolute; inset: 0; overflow: hidden;
    display: flex; align-items: center; justify-content: center;
  }
  /* Scanline overlay — heavier than data-cluster's, this is a glitch moment.
     Continuous scroll keyframe runs the entire scene so the screen never
     sits truly static after the word reveal lands. */
  #${id} .cgw-scanlines {
    position: absolute; inset: 0; pointer-events: none; z-index: 5;
    background-image: repeating-linear-gradient(
      to bottom,
      ${t.colors.fg}10 0,
      ${t.colors.fg}10 1px,
      transparent 1px,
      transparent 3px
    );
    opacity: 0;
    will-change: opacity, transform;
    mix-blend-mode: screen;
    animation: cgw-scan-scroll-${id} 5s linear infinite, cgw-scan-flicker-${id} 4s steps(8) infinite;
  }
  @keyframes cgw-scan-scroll-${id} {
    from { transform: translateY(0); }
    to   { transform: translateY(6px); }
  }
  @keyframes cgw-scan-flicker-${id} {
    0%, 90% { opacity: 0.7; }
    91%, 93% { opacity: 0.95; }
    100%    { opacity: 0.7; }
  }
  /* Continuous RGB-pulse on the chromatic stack — keeps the scene alive
     after the GSAP entrance lands. Tiny amplitude (≤3px) so it reads as
     ambient digital decay, not a new beat. */
  #${id} .cgw-word.r,
  #${id} .cgw-word.g,
  #${id} .cgw-word.b {
    animation: cgw-rgb-drift-${id} 3.5s ease-in-out infinite;
  }
  #${id} .cgw-word.g { animation-delay: 0.5s; }
  #${id} .cgw-word.b { animation-delay: 1.0s; }
  @keyframes cgw-rgb-drift-${id} {
    0%, 100% { filter: none; }
    20%      { filter: hue-rotate(6deg); transform: translateX(-1px); }
    50%      { transform: translateX(2px); }
    75%      { filter: hue-rotate(-4deg); transform: translateX(-2px); }
  }
  /* Pixel grid backdrop — barely visible, anchors the void */
  #${id} .cgw-grid {
    position: absolute; inset: 0; pointer-events: none; z-index: 0;
    background-image:
      linear-gradient(${t.colors.fg}07 1px, transparent 1px),
      linear-gradient(90deg, ${t.colors.fg}07 1px, transparent 1px);
    background-size: 56px 56px;
    opacity: 0;
    will-change: opacity;
  }
  /* The word itself — three stacked layers for chromatic RGB shift */
  #${id} .cgw-stack {
    position: relative;
    z-index: 2;
    display: inline-block;
    text-align: center;
  }
  #${id} .cgw-word {
    font-weight: 800;
    font-size: clamp(160px, 18vw, 320px);
    line-height: 0.9;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: ${t.colors.fg};
    opacity: 0;
    transform: scale(0.94);
    will-change: transform, opacity, filter;
  }
  #${id} .cgw-word.r { position: absolute; top: 0; left: 0; color: ${t.colors.accent2}; mix-blend-mode: screen; transform: translate(-6px, -2px) scale(0.94); }
  #${id} .cgw-word.g { position: absolute; top: 0; left: 0; color: ${t.colors.accent}; mix-blend-mode: screen; transform: translate(2px, 0) scale(0.94); }
  #${id} .cgw-word.b { position: absolute; top: 0; left: 0; color: ${t.colors.accent2}; mix-blend-mode: screen; transform: translate(6px, 3px) scale(0.94); opacity: 0.6; }
  /* Pixel-cut bars — narrow horizontal strips that flash white during glitch */
  #${id} .cgw-cut {
    position: absolute;
    left: 0; right: 0;
    height: 6px;
    background: ${t.colors.fg};
    mix-blend-mode: difference;
    opacity: 0;
    z-index: 4;
    will-change: opacity, transform;
  }
  #${id} .cgw-cut.a { top: 38%; }
  #${id} .cgw-cut.b { top: 52%; }
  #${id} .cgw-cut.c { top: 64%; }
  /* Undertext + corner */
  #${id} .cgw-undertext {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    bottom: 18%;
    font-family: ${t.fonts.mono};
    font-size: 16px;
    color: ${t.colors.muted};
    letter-spacing: 0.08em;
    text-transform: lowercase;
    opacity: 0;
    will-change: opacity;
    z-index: 3;
  }
  #${id} .cgw-tag {
    position: absolute;
    left: 6%; top: 6%;
    font-family: ${t.fonts.mono};
    font-size: 9px;
    color: ${t.colors.muted};
    letter-spacing: 0.18em;
    text-transform: uppercase;
    opacity: 0;
    z-index: 3;
  }
</style>
<div id="${id}" class="scene-cyber-glitch-word" data-composition-id="${id}" data-scene-id="${id}" data-duration="${dur}">
  <div class="cgw-grid"></div>
  <div class="cgw-stack">
    <div class="cgw-word">${escapeHtml(word)}</div>
    <div class="cgw-word r">${escapeHtml(word)}</div>
    <div class="cgw-word g">${escapeHtml(word)}</div>
    <div class="cgw-word b">${escapeHtml(word)}</div>
  </div>
  <div class="cgw-cut a"></div>
  <div class="cgw-cut b"></div>
  <div class="cgw-cut c"></div>
  <div class="cgw-scanlines"></div>
  ${cornerTag ? `<div class="cgw-tag">${escapeHtml(cornerTag)}</div>` : ""}
  ${undertext ? `<div class="cgw-undertext">${escapeHtml(undertext)}</div>` : ""}
</div>
<script>
  (function(){
    const ${tlVar} = gsap.timeline({ paused: true });
    // Grid + scanlines fade in instantly to anchor the void
    ${tlVar}.to('#${id} .cgw-grid', { opacity: 1, duration: 0.15, ease: 'power2.out' }, 0);
    ${tlVar}.to('#${id} .cgw-scanlines', { opacity: 0.7, duration: 0.2, ease: 'power2.out' }, 0);
    // Word stack scales up + fades in with chromatic split visible
    ${tlVar}.to('#${id} .cgw-word', { opacity: 1, scale: 1, duration: 0.35, ease: 'power3.out', stagger: 0.02 }, 0.05);
    ${tlVar}.to('#${id} .cgw-tag', { opacity: 1, duration: 0.2 }, 0.2);
    // Mid-scene glitch burst: pixel cuts flicker, RGB layers separate further
    ${tlVar}.to('#${id} .cgw-cut.a', { opacity: 1, duration: 0.04, repeat: 2, yoyo: true }, 0.6);
    ${tlVar}.to('#${id} .cgw-cut.b', { opacity: 1, duration: 0.04, repeat: 2, yoyo: true }, 0.65);
    ${tlVar}.to('#${id} .cgw-cut.c', { opacity: 1, duration: 0.04, repeat: 2, yoyo: true }, 0.7);
    ${tlVar}.to('#${id} .cgw-word.r', { x: -12, duration: 0.06, repeat: 2, yoyo: true }, 0.6);
    ${tlVar}.to('#${id} .cgw-word.b', { x: 12, duration: 0.06, repeat: 2, yoyo: true }, 0.6);
    // Undertext settles in after the glitch
    ${tlVar}.to('#${id} .cgw-undertext', { opacity: 1, duration: 0.4, ease: 'power2.out' }, 0.9);
    window.__timelines = window.__timelines || {};
    window.__timelines['${id}'] = ${tlVar};
  })();
</script>
`.trim();
}

// ── CYBER_PIXEL_STILL ──────────────────────────────────────────────────────

export const CYBER_PIXEL_STILL_TEMPLATE: Template = {
  id: "cyber-pixel-still",
  description:
    "Halftone-dithered image with pixel-grid overlay and small mono caption. " +
    "Falls back to a procedural dither swatch when no imageId is supplied — that " +
    "keeps the cyberlofi aesthetic intact even on text-only projects.",
  whenToUse: [
    "Mid-narrative beat scenes that need a 'real-world referent' visual",
    "Cyberlofi videos that have a single hero photo to dither",
    "Outro cards with subtle visual texture (uses the no-image fallback)",
  ],
  durationRange: { min: 2, max: 6 },
  propsSchema: {
    type: "object",
    properties: {
      caption: {
        type: "string",
        description:
          "Mono caption ≤80 chars. Renders below the dithered tile, top-aligned. " +
          "Use to anchor the visual to the narration.",
      },
      cornerLabel: {
        type: "string",
        description: "Tiny corner label, ≤24 chars uppercase. e.g. 'OBSERVATION 03'.",
      },
      imageId: {
        type: "string",
        description:
          "Optional image manifest id. When present, the image is rendered with a CSS halftone " +
          "filter (dither + grid + mix-blend). When absent, a procedural dither swatch fills the slot.",
      },
    },
    required: ["caption"],
  },
  render(props, ctx) {
    return renderCyberPixelStill(props, ctx, ctx.image ?? null);
  },
};

function renderCyberPixelStill(
  props: Record<string, unknown>,
  ctx: TemplateRenderContext,
  image: ImageRef | null,
): string {
  const t = ctx.tokens;
  const id = ctx.sceneId;
  const tlVar = `tl_${id.replace(/-/g, "_")}`;
  const dur = formatSec(ctx.durationSeconds);
  const caption = asString(props.caption);
  const cornerLabel = asString(props.cornerLabel);
  const imgSrc = image ? image.src.replace(/\\/g, "/") : null;

  // Halftone effect built from a layered SVG dot pattern + mix-blend on the
  // image. The dot density gives the photo a printed-paper / pixel-art feel
  // without needing a pre-process pass through sharp.
  const halftoneSvg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='6' height='6' viewBox='0 0 6 6'>` +
    `<circle cx='3' cy='3' r='1.6' fill='%23000000'/>` +
    `</svg>`;

  return `
<style>
  #${id}.scene-cyber-pixel-still {
    background: ${t.colors.bg};
    color: ${t.colors.fg};
    font-family: ${t.fonts.mono};
    position: absolute; inset: 0; overflow: hidden;
  }
  /* Page grid backdrop — barely visible. */
  #${id} .cps-grid {
    position: absolute; inset: 0; pointer-events: none; z-index: 0;
    background-image:
      linear-gradient(${t.colors.fg}06 1px, transparent 1px),
      linear-gradient(90deg, ${t.colors.fg}06 1px, transparent 1px);
    background-size: 64px 64px;
    opacity: 0;
    will-change: opacity;
  }
  /* The dithered tile — pinned to the right side, ~38% wide */
  #${id} .cps-tile {
    position: absolute;
    right: 8%; top: 50%;
    transform: translateY(-50%);
    width: 38%;
    aspect-ratio: 4 / 3;
    background: ${t.colors.surface};
    overflow: hidden;
    opacity: 0;
    border: 1px solid ${t.colors.fg}33;
    will-change: opacity, transform;
  }
  /* Image fill (when imageId is supplied) */
  #${id} .cps-tile-image {
    position: absolute; inset: 0;
    background-size: cover;
    background-position: center;
    filter: grayscale(1) contrast(1.4) brightness(0.9);
  }
  /* Halftone dot pattern — overlays everything inside the tile.
     Subtle continuous shift on the dot grid so the still frame breathes
     after the entrance. Without this the scene scored 4/4/7 in Gemini's
     review (worst single scene in the previous render). */
  #${id} .cps-tile-halftone {
    position: absolute; inset: 0;
    background-image: url("data:image/svg+xml;utf8,${halftoneSvg}");
    background-size: 6px 6px;
    mix-blend-mode: difference;
    opacity: 0.85;
    will-change: background-position;
    animation: cps-halftone-drift-${id} 3.5s linear infinite;
  }
  @keyframes cps-halftone-drift-${id} {
    from { background-position: 0 0; }
    to   { background-position: 6px 6px; }
  }
  /* Continuous scanline scroll across the whole scene — same trick as
     the other cyberlofi templates so the rendered video never goes
     static after a beat lands. */
  #${id} .cps-scanlines {
    position: absolute; inset: 0; pointer-events: none; z-index: 4;
    background-image: repeating-linear-gradient(
      to bottom,
      ${t.colors.fg}10 0,
      ${t.colors.fg}10 1px,
      transparent 1px,
      transparent 4px
    );
    mix-blend-mode: screen;
    opacity: 0.4;
    will-change: transform, opacity;
    animation: cps-scan-${id} 5.5s linear infinite, cps-flicker-${id} 4.5s steps(7) infinite;
  }
  @keyframes cps-scan-${id} {
    from { transform: translateY(0); }
    to   { transform: translateY(8px); }
  }
  @keyframes cps-flicker-${id} {
    0%, 92% { opacity: 0.4; }
    93%, 95% { opacity: 0.75; }
    100%    { opacity: 0.4; }
  }
  /* Pixel grid INSIDE the tile — 16px squares, very subtle white */
  #${id} .cps-tile-grid {
    position: absolute; inset: 0;
    background-image:
      linear-gradient(${t.colors.fg}30 1px, transparent 1px),
      linear-gradient(90deg, ${t.colors.fg}30 1px, transparent 1px);
    background-size: 16px 16px;
    pointer-events: none;
  }
  /* No-image fallback: procedural dither swatch */
  #${id} .cps-tile.no-image {
    background:
      radial-gradient(circle at 30% 30%, ${t.colors.fg}aa, transparent 50%),
      radial-gradient(circle at 70% 70%, ${t.colors.muted}aa, transparent 60%),
      ${t.colors.surface};
  }
  /* Caption — left side, half-width, tucked top with breathing room */
  #${id} .cps-caption {
    position: absolute;
    left: 8%; top: 30%;
    width: 38%;
    font-size: 16px;
    line-height: 1.45;
    color: ${t.colors.muted};
    letter-spacing: 0.02em;
    opacity: 0;
    will-change: opacity;
  }
  #${id} .cps-corner {
    position: absolute;
    right: 8%; top: 6%;
    font-size: 9px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: ${t.colors.muted};
    opacity: 0;
    will-change: opacity;
  }
  /* L-bracket on the tile's top-left — pixel-art frame anchor */
  #${id} .cps-bracket {
    position: absolute;
    right: calc(8% + 38% - 8px);
    top: calc(50% - 38% * 3 / 8 - 8px);
    width: 16px; height: 16px;
    border-left: 1px solid ${t.colors.accent};
    border-top: 1px solid ${t.colors.accent};
    opacity: 0;
    will-change: opacity;
  }
</style>
<div id="${id}" class="scene-cyber-pixel-still" data-composition-id="${id}" data-scene-id="${id}" data-duration="${dur}">
  <div class="cps-grid"></div>
  <div class="cps-tile ${imgSrc ? "" : "no-image"}">
    ${imgSrc ? `<div class="cps-tile-image" style="background-image: url('${escapeHtml(imgSrc)}');"></div>` : ""}
    <div class="cps-tile-halftone"></div>
    <div class="cps-tile-grid"></div>
  </div>
  <div class="cps-bracket"></div>
  <div class="cps-caption">${escapeHtml(caption)}</div>
  ${cornerLabel ? `<div class="cps-corner">${escapeHtml(cornerLabel)}</div>` : ""}
  <div class="cps-scanlines"></div>
</div>
<script>
  (function(){
    const ${tlVar} = gsap.timeline({ paused: true });
    ${tlVar}.to('#${id} .cps-grid', { opacity: 1, duration: 0.3, ease: 'power2.out' }, 0);
    ${tlVar}.to('#${id} .cps-tile', { opacity: 1, duration: 0.4, ease: 'power3.out' }, 0.1);
    ${tlVar}.to('#${id} .cps-bracket', { opacity: 1, duration: 0.2, ease: 'power2.out' }, 0.3);
    ${tlVar}.to('#${id} .cps-corner', { opacity: 1, duration: 0.25, ease: 'power2.out' }, 0.35);
    ${tlVar}.to('#${id} .cps-caption', { opacity: 1, duration: 0.5, ease: 'power2.out' }, 0.45);
    window.__timelines = window.__timelines || {};
    window.__timelines['${id}'] = ${tlVar};
  })();
</script>
`.trim();
}

/**
 * Convenience export — every cyberlofi template in one array. The builtin
 * registry composes with this so the planner sees them automatically.
 */
export const CYBERLOFI_TEMPLATES: ReadonlyArray<Template> = [
  CYBER_DATA_CLUSTER_TEMPLATE,
  CYBER_GLITCH_WORD_TEMPLATE,
  CYBER_PIXEL_STILL_TEMPLATE,
];
