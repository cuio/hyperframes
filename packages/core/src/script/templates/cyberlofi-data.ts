/**
 * Cyberlofi data-glitch templates — the chart/data-vis family that
 * pairs with the existing cyber-* typography templates. Built to
 * address the gap surfaced when rendering data-heavy scripts (Snap, Dead
 * Internet, etc.) at the cyberlofi theme: the typography templates are
 * great for hooks/stats but you need actual chart and stream visuals
 * for retention through the middle of the video.
 *
 * Four templates ship in this module:
 *
 *   GLITCH_BAR_CHART     — Bar chart with RGB-shifted edges, scanline
 *                           scroll across the chart area, axis labels
 *                           reveal character-by-character. The
 *                           cyberlofi replacement for chart-scene.
 *   CYBER_COUNTER_BURST  — Counter that rises with mid-rise glitch
 *                           interrupts: RGB pulse, pixel-cut bar flicker,
 *                           scanline burst at key thresholds. The
 *                           cyberlofi replacement for hook-statreveal.
 *   DATA_STREAM_REVEAL   — Streaming data ticker (lat/long, IDs, dollar
 *                           values) that scrolls continuously with mid-
 *                           stream glitch breaks. Solves the "single
 *                           static word holds for 4s" problem on
 *                           accent-heavy scenes.
 *   CYBER_COMPARISON     — Split-screen pixelated comparison with
 *                           pixel-grid bars filling on each side. The
 *                           cyberlofi replacement for comparison.
 *
 * Design principles for this family:
 *
 *  1. **Continuous motion** — every template runs at least one
 *     constantly-evolving background element (scanline scroll, pixel
 *     ticker, RGB pulse). The Gemini review flagged static-hold as the
 *     biggest retention killer on the typography templates; data-vis
 *     templates avoid this from the start.
 *  2. **Pure CSS + GSAP** — same contract as the rest of the cyberlofi
 *     family. No extra runtime deps; all motion is keyframe-driven.
 *  3. **Scoped selectors** — every CSS rule starts with
 *     `#${ctx.sceneId}` so the templates compose cleanly without
 *     leaking styles between scenes.
 *  4. **Theme tokens only** — colors come from `ctx.tokens.colors.*`.
 *     The user picks the theme; the template never hardcodes hex.
 *  5. **GSAP timeline named `tl_<sceneId>`** registered as
 *     `window.__timelines[sceneId]`. Master timeline + scrubbing work
 *     out of the box.
 */

import type { Template, TemplateRenderContext } from "./types.js";
import { escapeHtml, asString, formatSec } from "./util.js";

// ── GLITCH_BAR_CHART ───────────────────────────────────────────────────────

export const GLITCH_BAR_CHART_TEMPLATE: Template = {
  id: "glitch-bar-chart",
  description:
    "Bar chart with RGB-shifted edges, continuous scanline scroll across the chart area, " +
    "and character-by-character axis label reveals. Bars grow staggered with subtle glitch " +
    "jitter at the end of each rise. Cyberlofi replacement for chart-scene.",
  whenToUse: [
    "Time-series data that fits 3-6 bars (year-over-year, quarterly, comparative)",
    "Cyberlofi / glitch-art aesthetic videos with data emphasis",
    "Scenes where a counter alone won't tell the story — multiple values matter",
  ],
  durationRange: { min: 3, max: 8 },
  propsSchema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Chart heading. Mono uppercase. ≤6 words.",
      },
      eyebrow: {
        type: "string",
        description: "Tiny label above the chart. Mono uppercase. e.g. 'BOT TRAFFIC SHARE'.",
      },
      bars: {
        type: "array",
        minItems: 2,
        maxItems: 8,
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "X-axis label. ≤6 chars (year, quarter, etc.)" },
            value: { type: "number", description: "Bar value, 0-100 expected." },
            valueLabel: {
              type: "string",
              description: "Label printed above the bar. e.g. '49.6%' or '$4B'. Free-form.",
            },
            highlight: {
              type: "boolean",
              description:
                "When true the bar uses accent color + heavier glitch. Use for the climax bar.",
            },
          },
          required: ["label", "value"],
        },
      },
      sourceTag: {
        type: "string",
        description: "Tiny corner tag. Often a citation. e.g. 'Imperva Bad Bot Report 2024'.",
      },
    },
    required: ["title", "bars"],
  },
  render(props, ctx) {
    return renderGlitchBarChart(props, ctx);
  },
};

interface BarSpec {
  label: string;
  value: number;
  valueLabel?: string;
  highlight?: boolean;
}

function renderGlitchBarChart(props: Record<string, unknown>, ctx: TemplateRenderContext): string {
  const t = ctx.tokens;
  const id = ctx.sceneId;
  const tlVar = `tl_${id.replace(/-/g, "_")}`;
  const dur = formatSec(ctx.durationSeconds);
  const title = asString(props.title) || "DATA";
  const eyebrow = asString(props.eyebrow);
  const sourceTag = asString(props.sourceTag);
  const rawBars = Array.isArray(props.bars) ? props.bars : [];
  const bars = rawBars
    .filter((b): b is BarSpec => Boolean(b) && typeof b === "object" && "label" in (b as object))
    .slice(0, 8)
    .map((b) => ({
      label: asString((b as BarSpec).label).slice(0, 6),
      value: typeof (b as BarSpec).value === "number" ? (b as BarSpec).value : 0,
      valueLabel: asString((b as BarSpec).valueLabel) || "",
      highlight: Boolean((b as BarSpec).highlight),
    }));
  const maxValue = Math.max(...bars.map((b) => b.value), 1);

  const barRows = bars
    .map((b, i) => {
      const heightPct = (b.value / maxValue) * 100;
      const cls = b.highlight ? "gbc-bar gbc-bar-hi" : "gbc-bar";
      const valueLbl = b.valueLabel || `${b.value}`;
      return `
      <div class="gbc-col" style="--i:${i}">
        <div class="gbc-bar-value">${escapeHtml(valueLbl)}</div>
        <div class="${cls}" data-target-h="${heightPct.toFixed(2)}">
          <div class="gbc-bar-fill"></div>
          <div class="gbc-bar-r"></div>
          <div class="gbc-bar-g"></div>
        </div>
        <div class="gbc-bar-label">${escapeHtml(b.label)}</div>
      </div>`;
    })
    .join("");

  return `
<style>
  #${id}.scene-glitch-bar-chart {
    background: ${t.colors.bg};
    color: ${t.colors.fg};
    font-family: ${t.fonts.mono};
    position: absolute; inset: 0; overflow: hidden;
  }
  /* Continuous scanline scroll — drives motion the entire scene. */
  #${id} .gbc-scanlines {
    position: absolute; inset: 0; pointer-events: none; z-index: 3;
    background-image: repeating-linear-gradient(
      to bottom,
      ${t.colors.fg}10 0,
      ${t.colors.fg}10 1px,
      transparent 1px,
      transparent 4px
    );
    mix-blend-mode: screen;
    opacity: 0.55;
    will-change: transform;
    animation: gbc-scan-${id} 6s linear infinite;
  }
  @keyframes gbc-scan-${id} {
    from { transform: translateY(0); }
    to   { transform: translateY(8px); }
  }
  /* Pixel grid backdrop, very subtle */
  #${id} .gbc-grid {
    position: absolute; inset: 0; pointer-events: none; z-index: 0;
    background-image:
      linear-gradient(${t.colors.fg}06 1px, transparent 1px),
      linear-gradient(90deg, ${t.colors.fg}06 1px, transparent 1px);
    background-size: 64px 64px;
    opacity: 0;
    will-change: opacity;
  }
  /* Title block — top-left */
  #${id} .gbc-eyebrow {
    position: absolute; left: 6%; top: 8%;
    font-size: 11px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: ${t.colors.accent2};
    opacity: 0;
    will-change: opacity;
    z-index: 2;
  }
  #${id} .gbc-title {
    position: absolute; left: 6%; top: calc(8% + 24px);
    font-family: ${t.fonts.display};
    font-size: clamp(48px, 5.5vw, 88px);
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    line-height: 0.95;
    color: ${t.colors.fg};
    opacity: 0;
    transform: translateY(8px);
    will-change: transform, opacity;
    z-index: 2;
    max-width: 70%;
  }
  /* Source tag */
  #${id} .gbc-source {
    position: absolute; right: 6%; bottom: 4%;
    font-size: 9px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: ${t.colors.muted};
    opacity: 0;
    z-index: 2;
  }
  /* Chart — bottom 60%, anchored to right side */
  #${id} .gbc-chart {
    position: absolute;
    left: 8%; right: 8%;
    bottom: 14%;
    top: 42%;
    display: flex;
    align-items: flex-end;
    justify-content: space-around;
    gap: 1.5%;
    z-index: 1;
  }
  #${id} .gbc-col {
    flex: 1 1 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    height: 100%;
    position: relative;
  }
  #${id} .gbc-bar-value {
    font-size: 14px;
    font-weight: 700;
    color: ${t.colors.fg};
    margin-bottom: 6px;
    opacity: 0;
    will-change: opacity;
    text-align: center;
  }
  #${id} .gbc-bar {
    position: relative;
    width: 70%;
    height: 0;
    background: ${t.colors.fg};
    margin-top: auto;
    will-change: height, transform;
  }
  #${id} .gbc-bar-hi { background: ${t.colors.accent}; }
  /* RGB shadow layers behind the bar — chromatic split */
  #${id} .gbc-bar-r,
  #${id} .gbc-bar-g {
    position: absolute; inset: 0;
    will-change: transform, opacity;
  }
  #${id} .gbc-bar-r { background: ${t.colors.accent2}; mix-blend-mode: screen; transform: translateX(-3px); opacity: 0.5; }
  #${id} .gbc-bar-g { background: ${t.colors.accent}; mix-blend-mode: screen; transform: translateX(3px); opacity: 0.4; }
  #${id} .gbc-bar-label {
    margin-top: 8px;
    font-size: 12px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: ${t.colors.muted};
    opacity: 0;
    will-change: opacity;
  }
  /* Cross-rule — pixel green line that sweeps from left to right */
  #${id} .gbc-sweep {
    position: absolute;
    left: 8%; right: 8%;
    top: 42%;
    height: 1px;
    background: ${t.colors.accent};
    transform: scaleX(0);
    transform-origin: left;
    will-change: transform;
    z-index: 2;
  }
</style>
<div id="${id}" class="scene-glitch-bar-chart" data-composition-id="${id}" data-scene-id="${id}" data-duration="${dur}">
  <div class="gbc-grid"></div>
  ${eyebrow ? `<div class="gbc-eyebrow">${escapeHtml(eyebrow)}</div>` : ""}
  <div class="gbc-title">${escapeHtml(title)}</div>
  <div class="gbc-sweep"></div>
  <div class="gbc-chart">${barRows}</div>
  ${sourceTag ? `<div class="gbc-source">${escapeHtml(sourceTag)}</div>` : ""}
  <div class="gbc-scanlines"></div>
</div>
<script>
  (function(){
    const ${tlVar} = gsap.timeline({ paused: true });
    ${tlVar}.to('#${id} .gbc-grid', { opacity: 1, duration: 0.3, ease: 'power2.out' }, 0);
    ${tlVar}.to('#${id} .gbc-eyebrow', { opacity: 1, duration: 0.3 }, 0.05);
    ${tlVar}.to('#${id} .gbc-title', { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' }, 0.1);
    ${tlVar}.to('#${id} .gbc-sweep', { scaleX: 1, duration: 0.6, ease: 'power3.out' }, 0.3);
    // Bars rise sequentially. Faster + tighter than v1 / v2 — Gemini
     // flagged the previous timing as "too slow vs voiceover pace" on
     // s03 and s08. Per-bar duration 0.45s → 0.32s, stagger 0.10s →
     // 0.06s. Whole chart now lands in <1s vs ~1.5s before.
    const bars = document.querySelectorAll('#${id} .gbc-bar');
    bars.forEach((bar, i) => {
      const targetH = parseFloat(bar.getAttribute('data-target-h')) + '%';
      const startTime = 0.4 + i * 0.06;
      ${tlVar}.to(bar, { height: targetH, duration: 0.32, ease: 'power3.out' }, startTime);
      ${tlVar}.to('#${id} .gbc-col[style*="--i:' + i + '"] .gbc-bar-value', { opacity: 1, duration: 0.20 }, startTime + 0.22);
      ${tlVar}.to('#${id} .gbc-col[style*="--i:' + i + '"] .gbc-bar-label', { opacity: 1, duration: 0.20 }, startTime + 0.06);
    });
    // Source tag late
    ${tlVar}.to('#${id} .gbc-source', { opacity: 1, duration: 0.3 }, 1.2);
    window.__timelines = window.__timelines || {};
    window.__timelines['${id}'] = ${tlVar};
  })();
</script>
`.trim();
}

// ── CYBER_COUNTER_BURST ────────────────────────────────────────────────────

export const CYBER_COUNTER_BURST_TEMPLATE: Template = {
  id: "cyber-counter-burst",
  description:
    "Counter rises with mid-rise glitch interrupts: RGB pulse, pixel-cut bar flicker, " +
    "and scanline burst at key thresholds. Strongest single-stat reveal in the cyberlofi " +
    "family — replaces hook-statreveal for cyberlofi-themed projects.",
  whenToUse: [
    "Hero stat scenes where the number IS the story",
    "Cyberlofi videos that need a counter without it feeling clean / corporate",
    "Hook scenes following a glitch-word opener",
  ],
  durationRange: { min: 2, max: 5 },
  propsSchema: {
    type: "object",
    properties: {
      stat: {
        type: "number",
        description: "Numeric value the counter rises to. Required.",
      },
      statSuffix: {
        type: "string",
        description: "Suffix glyph(s) — '%', 'B', 'M', '+'. Renders in accent color.",
      },
      eyebrow: {
        type: "string",
        description: "Tiny label above the counter. ≤24 chars uppercase.",
      },
      undertext: {
        type: "string",
        description: "Caption below the counter. ≤80 chars.",
      },
      sourceTag: {
        type: "string",
        description: "Tiny corner tag. Often a citation.",
      },
    },
    required: ["stat"],
  },
  render(props, ctx) {
    return renderCyberCounterBurst(props, ctx);
  },
};

function renderCyberCounterBurst(
  props: Record<string, unknown>,
  ctx: TemplateRenderContext,
): string {
  const t = ctx.tokens;
  const id = ctx.sceneId;
  const tlVar = `tl_${id.replace(/-/g, "_")}`;
  const dur = formatSec(ctx.durationSeconds);
  const stat = typeof props.stat === "number" ? props.stat : 0;
  const statSuffix = asString(props.statSuffix);
  const eyebrow = asString(props.eyebrow);
  const undertext = asString(props.undertext);
  const sourceTag = asString(props.sourceTag);
  const startVal = 0;
  const endVal = stat;
  // Format helper for the rolling counter — preserves common decimal patterns.
  const formatJs = stat % 1 === 0 ? "Math.round(v)" : "v.toFixed(1)";

  return `
<style>
  #${id}.scene-cyber-counter-burst {
    background: ${t.colors.bg};
    color: ${t.colors.fg};
    font-family: ${t.fonts.mono};
    position: absolute; inset: 0; overflow: hidden;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
  }
  #${id} .ccb-scanlines {
    position: absolute; inset: 0; pointer-events: none; z-index: 4;
    background-image: repeating-linear-gradient(
      to bottom,
      ${t.colors.fg}12 0,
      ${t.colors.fg}12 1px,
      transparent 1px,
      transparent 3px
    );
    mix-blend-mode: screen;
    opacity: 0;
    will-change: opacity, transform;
    animation: ccb-scan-${id} 4.5s linear infinite;
  }
  @keyframes ccb-scan-${id} {
    from { transform: translateY(0); }
    to   { transform: translateY(6px); }
  }
  #${id} .ccb-grid {
    position: absolute; inset: 0; pointer-events: none; z-index: 0;
    background-image:
      linear-gradient(${t.colors.fg}07 1px, transparent 1px),
      linear-gradient(90deg, ${t.colors.fg}07 1px, transparent 1px);
    background-size: 56px 56px;
    opacity: 0;
    will-change: opacity;
  }
  #${id} .ccb-eyebrow {
    font-size: 13px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: ${t.colors.accent2};
    margin-bottom: 24px;
    opacity: 0;
    z-index: 2;
  }
  /* Counter — three stacked layers for chromatic shift */
  #${id} .ccb-counter-stack {
    position: relative; z-index: 2;
    display: inline-block;
    text-align: center;
  }
  #${id} .ccb-counter,
  #${id} .ccb-counter-r,
  #${id} .ccb-counter-g {
    font-family: ${t.fonts.display};
    font-weight: 800;
    font-size: clamp(180px, 16vw, 320px);
    line-height: 0.9;
    letter-spacing: 0;
    color: ${t.colors.accent};
  }
  #${id} .ccb-counter-r,
  #${id} .ccb-counter-g {
    position: absolute; top: 0; left: 0;
    will-change: transform, opacity;
    mix-blend-mode: screen;
  }
  #${id} .ccb-counter-r { color: ${t.colors.accent2}; transform: translate(-4px, 0); opacity: 0.5; }
  #${id} .ccb-counter-g { color: ${t.colors.accent}; transform: translate(4px, 0); opacity: 0.5; }
  /* Continuous chromatic drift on the R / G layers — keeps the counter
     alive after the GSAP rise lands. Tiny ±3px amplitude so it reads as
     ambient digital decay, not a new beat. v1 / v2 of this template
     scored 7/6/10 because Gemini flagged "static after reveal." Same
     pattern that fixed cyber-glitch-word on the dead-internet v2 render. */
  #${id} .ccb-counter-r,
  #${id} .ccb-counter-g {
    animation: ccb-rgb-drift-${id} 3.2s ease-in-out infinite;
  }
  #${id} .ccb-counter-g { animation-delay: 0.6s; }
  @keyframes ccb-rgb-drift-${id} {
    0%, 100% { transform: translate(-4px, 0); }
    25%      { transform: translate(-7px, -1px); }
    50%      { transform: translate(-2px, 1px); }
    75%      { transform: translate(-5px, 0); }
  }
  /* Continuous burst pulse on the pixel-cut bars — every ~1.6s a single
     bar flickers briefly. Adds a beat through the hold phase. */
  #${id} .ccb-cut.a { animation: ccb-cut-pulse-${id} 3.2s steps(40) infinite; }
  #${id} .ccb-cut.b { animation: ccb-cut-pulse-${id} 3.2s steps(40) infinite; animation-delay: 1.6s; }
  @keyframes ccb-cut-pulse-${id} {
    0%, 96%  { opacity: 0; }
    97%, 99% { opacity: 0.8; }
    100%     { opacity: 0; }
  }
  #${id} .ccb-suffix {
    font-size: clamp(80px, 7vw, 130px);
    color: ${t.colors.fg};
    margin-left: 6px;
  }
  #${id} .ccb-undertext {
    font-size: 16px;
    color: ${t.colors.muted};
    letter-spacing: 0.06em;
    margin-top: 24px;
    text-align: center;
    max-width: 60%;
    opacity: 0;
    z-index: 2;
  }
  #${id} .ccb-source {
    position: absolute; right: 6%; bottom: 4%;
    font-size: 9px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: ${t.colors.muted};
    opacity: 0;
    z-index: 2;
  }
  /* Pixel-cut bars that flicker at glitch beats */
  #${id} .ccb-cut {
    position: absolute;
    left: 0; right: 0;
    height: 5px;
    background: ${t.colors.fg};
    mix-blend-mode: difference;
    opacity: 0;
    z-index: 3;
  }
  #${id} .ccb-cut.a { top: 42%; }
  #${id} .ccb-cut.b { top: 56%; }
</style>
<div id="${id}" class="scene-cyber-counter-burst" data-composition-id="${id}" data-scene-id="${id}" data-duration="${dur}">
  <div class="ccb-grid"></div>
  ${eyebrow ? `<div class="ccb-eyebrow">${escapeHtml(eyebrow)}</div>` : ""}
  <div class="ccb-counter-stack">
    <span class="ccb-counter" data-cnt="0">0</span><span class="ccb-suffix">${escapeHtml(statSuffix)}</span>
    <span class="ccb-counter-r" data-cnt-r="0">0</span>
    <span class="ccb-counter-g" data-cnt-g="0">0</span>
  </div>
  ${undertext ? `<div class="ccb-undertext">${escapeHtml(undertext)}</div>` : ""}
  <div class="ccb-cut a"></div>
  <div class="ccb-cut b"></div>
  <div class="ccb-scanlines"></div>
  ${sourceTag ? `<div class="ccb-source">${escapeHtml(sourceTag)}</div>` : ""}
</div>
<script>
  (function(){
    const ${tlVar} = gsap.timeline({ paused: true });
    ${tlVar}.to('#${id} .ccb-grid', { opacity: 1, duration: 0.2 }, 0);
    ${tlVar}.to('#${id} .ccb-scanlines', { opacity: 0.7, duration: 0.2 }, 0);
    ${tlVar}.to('#${id} .ccb-eyebrow', { opacity: 1, duration: 0.25 }, 0.1);
    // Counter rises — animate a numeric value object and write the
    // formatted result into all three layers (main + R + G) on each tick.
    const counter = { v: ${startVal} };
    ${tlVar}.to(counter, {
      v: ${endVal},
      duration: 1.0,
      ease: 'power2.out',
      onUpdate() {
        const v = counter.v;
        const txt = ${formatJs}.toString();
        const main = document.querySelector('#${id} .ccb-counter');
        const r = document.querySelector('#${id} .ccb-counter-r');
        const g = document.querySelector('#${id} .ccb-counter-g');
        if (main) main.textContent = txt;
        if (r) r.textContent = txt;
        if (g) g.textContent = txt;
      },
    }, 0.2);
    // Mid-rise glitch burst: pixel cuts flicker, RGB layers jump apart
    ${tlVar}.to('#${id} .ccb-cut.a', { opacity: 1, duration: 0.04, repeat: 3, yoyo: true }, 0.6);
    ${tlVar}.to('#${id} .ccb-cut.b', { opacity: 1, duration: 0.04, repeat: 3, yoyo: true }, 0.7);
    ${tlVar}.to('#${id} .ccb-counter-r', { x: -10, duration: 0.06, repeat: 2, yoyo: true }, 0.65);
    ${tlVar}.to('#${id} .ccb-counter-g', { x: 10, duration: 0.06, repeat: 2, yoyo: true }, 0.65);
    // Settle the undertext after the glitch
    ${tlVar}.to('#${id} .ccb-undertext', { opacity: 1, duration: 0.4 }, 1.2);
    ${tlVar}.to('#${id} .ccb-source', { opacity: 1, duration: 0.3 }, 1.4);
    window.__timelines = window.__timelines || {};
    window.__timelines['${id}'] = ${tlVar};
  })();
</script>
`.trim();
}

// ── DATA_STREAM_REVEAL ─────────────────────────────────────────────────────

export const DATA_STREAM_REVEAL_TEMPLATE: Template = {
  id: "data-stream-reveal",
  description:
    "Streaming data ticker on a black canvas. Lines scroll continuously upward like a " +
    "live log feed; mid-stream glitch breaks (RGB shift + scanline burst) punctuate the " +
    "reveal. A single accent word floats over the ticker with corner-pinned tags. " +
    "Cyberlofi solution to the 'static word holds 4s' problem.",
  whenToUse: [
    "Narrative beats where the data IS the visual but you need motion through the whole scene",
    "Pre-CTA pattern interrupts that need density without losing readability",
    "Scenes where the cyber-data-cluster's static log feels too quiet",
  ],
  durationRange: { min: 3, max: 7 },
  propsSchema: {
    type: "object",
    properties: {
      accentWord: {
        type: "string",
        description: "Single accent word floating top-left. Uppercase preferred. ≤14 chars.",
      },
      streamLines: {
        type: "array",
        items: { type: "string" },
        minItems: 8,
        maxItems: 40,
        description:
          "20-40 short data-style lines (lat/long, ISO timestamps, IDs, short claims). They " +
          "scroll continuously upward like a terminal feed. ≤80 chars per line.",
      },
      undertext: {
        type: "string",
        description: "Optional caption below the ticker. ≤80 chars.",
      },
      cornerTag: {
        type: "string",
        description: "Tiny mono tag top-right. ≤24 chars uppercase.",
      },
    },
    required: ["accentWord", "streamLines"],
  },
  render(props, ctx) {
    return renderDataStreamReveal(props, ctx);
  },
};

function renderDataStreamReveal(
  props: Record<string, unknown>,
  ctx: TemplateRenderContext,
): string {
  const t = ctx.tokens;
  const id = ctx.sceneId;
  const tlVar = `tl_${id.replace(/-/g, "_")}`;
  const dur = formatSec(ctx.durationSeconds);
  const accent = asString(props.accentWord).toUpperCase().slice(0, 14) || "—";
  const undertext = asString(props.undertext);
  const cornerTag = asString(props.cornerTag);
  const streamRaw = Array.isArray(props.streamLines) ? props.streamLines : [];
  const stream = streamRaw.filter((line): line is string => typeof line === "string").slice(0, 40);
  // Duplicate the stream so the loop is seamless when it wraps.
  const lines = [...stream, ...stream];
  const lineHtml = lines
    .map((line) => `<div class="dsr-line">${escapeHtml(line.slice(0, 80))}</div>`)
    .join("");

  return `
<style>
  #${id}.scene-data-stream-reveal {
    background: ${t.colors.bg};
    color: ${t.colors.fg};
    font-family: ${t.fonts.mono};
    position: absolute; inset: 0; overflow: hidden;
  }
  #${id} .dsr-grid {
    position: absolute; inset: 0; pointer-events: none; z-index: 0;
    background-image:
      linear-gradient(${t.colors.fg}06 1px, transparent 1px),
      linear-gradient(90deg, ${t.colors.fg}06 1px, transparent 1px);
    background-size: 56px 56px;
    opacity: 0;
    will-change: opacity;
  }
  /* Stream column — pinned bottom-right, scrolls up SLOWLY so each
     line is readable (≥1s of dwell). v1 of this template scrolled at
     14s linear which Gemini flagged on s04 / s07 / s13 as too dense
     to read. Doubled the period + bumped line-height + bigger font
     so individual lines have presence. Active-line highlight pulses
     the row currently centered in the visible band. */
  #${id} .dsr-stream {
    position: absolute;
    right: 6%; bottom: 10%;
    width: 42%;
    height: 64%;
    overflow: hidden;
    z-index: 1;
    -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 22%, black 78%, transparent 100%);
            mask-image: linear-gradient(to bottom, transparent 0%, black 22%, black 78%, transparent 100%);
    /* Scanline behind the data — gives the band the "live feed" texture
       even when the user can't read every line. */
    background-image: repeating-linear-gradient(
      to bottom,
      ${t.colors.fg}05 0,
      ${t.colors.fg}05 1px,
      transparent 1px,
      transparent 4px
    );
  }
  #${id} .dsr-stream-inner {
    position: absolute; bottom: -100%; left: 0; right: 0;
    will-change: transform;
    /* 14s → 28s; halves the read pressure. */
    animation: dsr-scroll-${id} 28s linear infinite;
  }
  #${id} .dsr-line {
    font-size: 14px;
    line-height: 2.0;
    color: ${t.colors.muted};
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    letter-spacing: 0.02em;
    padding: 0 4px;
  }
  /* Center-band highlight — a small horizontal bar locked to the
     middle of the visible window. Lines passing through it light up
     to white (vs muted) so the eye has a clear "now reading" target.
     Uses CSS animation alone — no GSAP — so it runs continuously. */
  #${id} .dsr-stream::before {
    content: ""; position: absolute;
    left: 0; right: 0;
    top: 50%;
    height: 36px;
    transform: translateY(-50%);
    background: linear-gradient(to right, ${t.colors.fg}04 0%, ${t.colors.fg}10 50%, ${t.colors.fg}04 100%);
    border-top: 1px solid ${t.colors.accent}40;
    border-bottom: 1px solid ${t.colors.accent}40;
    pointer-events: none;
    z-index: 2;
  }
  /* Each line gets a brief brighten/blink as it crosses the highlight
     band. Synced to the scroll period so a "tick" lands ~every line. */
  #${id} .dsr-line {
    animation: dsr-row-pulse-${id} 1.4s ease-in-out infinite;
  }
  @keyframes dsr-scroll-${id} {
    from { transform: translateY(0); }
    to   { transform: translateY(-50%); }
  }
  @keyframes dsr-row-pulse-${id} {
    0%, 100% { color: ${t.colors.muted}; }
    48%, 52% { color: ${t.colors.fg}; }
  }
  /* Accent word — three-layer chromatic stack, top-left */
  #${id} .dsr-accent-stack {
    position: absolute;
    left: 6%; top: 30%;
    z-index: 2;
  }
  #${id} .dsr-accent,
  #${id} .dsr-accent-r,
  #${id} .dsr-accent-g {
    font-family: ${t.fonts.display};
    font-size: clamp(90px, 9vw, 160px);
    font-weight: 800;
    line-height: 0.95;
    letter-spacing: 0.02em;
    color: ${t.colors.fg};
    text-transform: uppercase;
    will-change: transform, opacity;
  }
  #${id} .dsr-accent-r,
  #${id} .dsr-accent-g {
    position: absolute; top: 0; left: 0;
    mix-blend-mode: screen;
  }
  #${id} .dsr-accent-r { color: ${t.colors.accent2}; transform: translate(-3px, 1px); opacity: 0.55; }
  #${id} .dsr-accent-g { color: ${t.colors.accent}; transform: translate(3px, -1px); opacity: 0.55; }
  /* Corner tag, undertext */
  #${id} .dsr-tag {
    position: absolute;
    right: 6%; top: 6%;
    font-size: 9px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: ${t.colors.muted};
    opacity: 0;
    z-index: 2;
  }
  #${id} .dsr-undertext {
    position: absolute;
    left: 6%; bottom: 8%;
    width: 38%;
    font-size: 16px;
    color: ${t.colors.muted};
    letter-spacing: 0.04em;
    line-height: 1.45;
    opacity: 0;
    z-index: 2;
  }
  /* Continuous scanline + occasional pulse */
  #${id} .dsr-scanlines {
    position: absolute; inset: 0; pointer-events: none; z-index: 3;
    background-image: repeating-linear-gradient(
      to bottom,
      ${t.colors.fg}10 0,
      ${t.colors.fg}10 1px,
      transparent 1px,
      transparent 4px
    );
    mix-blend-mode: screen;
    opacity: 0.5;
    animation: dsr-flicker-${id} 5.5s steps(8) infinite;
  }
  @keyframes dsr-flicker-${id} {
    0%, 92% { opacity: 0.5; }
    93%, 95% { opacity: 0.85; }
    100%    { opacity: 0.5; }
  }
</style>
<div id="${id}" class="scene-data-stream-reveal" data-composition-id="${id}" data-scene-id="${id}" data-duration="${dur}">
  <div class="dsr-grid"></div>
  <div class="dsr-stream">
    <div class="dsr-stream-inner">${lineHtml}</div>
  </div>
  <div class="dsr-accent-stack">
    <div class="dsr-accent">${escapeHtml(accent)}</div>
    <div class="dsr-accent-r">${escapeHtml(accent)}</div>
    <div class="dsr-accent-g">${escapeHtml(accent)}</div>
  </div>
  ${cornerTag ? `<div class="dsr-tag">${escapeHtml(cornerTag)}</div>` : ""}
  ${undertext ? `<div class="dsr-undertext">${escapeHtml(undertext)}</div>` : ""}
  <div class="dsr-scanlines"></div>
</div>
<script>
  (function(){
    const ${tlVar} = gsap.timeline({ paused: true });
    ${tlVar}.to('#${id} .dsr-grid', { opacity: 1, duration: 0.3 }, 0);
    ${tlVar}.from('#${id} .dsr-accent, #${id} .dsr-accent-r, #${id} .dsr-accent-g', {
      opacity: 0, y: 12, duration: 0.4, ease: 'power3.out', stagger: 0.02
    }, 0.05);
    ${tlVar}.to('#${id} .dsr-tag', { opacity: 1, duration: 0.3 }, 0.2);
    ${tlVar}.from('#${id} .dsr-stream', { opacity: 0, duration: 0.4 }, 0.3);
    // Periodic glitch jumps on the chromatic stack — every ~1.5s
    ${tlVar}.to('#${id} .dsr-accent-r', { x: -10, duration: 0.06, repeat: 1, yoyo: true }, 1.0);
    ${tlVar}.to('#${id} .dsr-accent-g', { x: 10, duration: 0.06, repeat: 1, yoyo: true }, 1.05);
    ${tlVar}.to('#${id} .dsr-undertext', { opacity: 1, duration: 0.4 }, 0.6);
    window.__timelines = window.__timelines || {};
    window.__timelines['${id}'] = ${tlVar};
  })();
</script>
`.trim();
}

// ── CYBER_COMPARISON ──────────────────────────────────────────────────────

export const CYBER_COMPARISON_TEMPLATE: Template = {
  id: "cyber-comparison",
  description:
    "Split-screen pixelated comparison with pixel-grid bars filling on each side. " +
    "Left and right show contrasting numbers / labels with growing fill bars. " +
    "Cyberlofi replacement for the comparison template.",
  whenToUse: [
    "Before/after, then/now, us/them comparisons",
    "Cyberlofi videos that need to contrast two values without smooth gradients",
  ],
  durationRange: { min: 2.5, max: 6 },
  propsSchema: {
    type: "object",
    properties: {
      heading: {
        type: "string",
        description: "Top-line heading. ≤6 words.",
      },
      left: {
        type: "object",
        description: "Left side — usually the 'past' or 'old' state.",
        properties: {
          label: { type: "string", description: "Label for this side. ≤24 chars." },
          value: { type: "string", description: "Headline value. ≤16 chars." },
          fill: { type: "number", description: "Pixel-bar fill 0-100." },
        },
        required: ["label", "value"],
      },
      right: {
        type: "object",
        description: "Right side — usually the 'present' or 'new' state.",
        properties: {
          label: { type: "string", description: "Label for this side. ≤24 chars." },
          value: { type: "string", description: "Headline value. ≤16 chars." },
          fill: { type: "number", description: "Pixel-bar fill 0-100." },
        },
        required: ["label", "value"],
      },
      footnote: {
        type: "string",
        description: "Tiny line at the bottom, often a citation. ≤80 chars.",
      },
    },
    required: ["heading", "left", "right"],
  },
  render(props, ctx) {
    return renderCyberComparison(props, ctx);
  },
};

interface CompSide {
  label: string;
  value: string;
  fill?: number;
}

function renderCyberComparison(props: Record<string, unknown>, ctx: TemplateRenderContext): string {
  const t = ctx.tokens;
  const id = ctx.sceneId;
  const tlVar = `tl_${id.replace(/-/g, "_")}`;
  const dur = formatSec(ctx.durationSeconds);
  const heading = asString(props.heading);
  const footnote = asString(props.footnote);
  const leftRaw = (props.left ?? {}) as Partial<CompSide>;
  const rightRaw = (props.right ?? {}) as Partial<CompSide>;
  const left: CompSide = {
    label: asString(leftRaw.label).slice(0, 24),
    value: asString(leftRaw.value).slice(0, 16),
    fill: typeof leftRaw.fill === "number" ? Math.max(0, Math.min(100, leftRaw.fill)) : 50,
  };
  const right: CompSide = {
    label: asString(rightRaw.label).slice(0, 24),
    value: asString(rightRaw.value).slice(0, 16),
    fill: typeof rightRaw.fill === "number" ? Math.max(0, Math.min(100, rightRaw.fill)) : 50,
  };

  return `
<style>
  #${id}.scene-cyber-comparison {
    background: ${t.colors.bg};
    color: ${t.colors.fg};
    font-family: ${t.fonts.mono};
    position: absolute; inset: 0; overflow: hidden;
  }
  #${id} .ccm-grid {
    position: absolute; inset: 0; pointer-events: none; z-index: 0;
    background-image:
      linear-gradient(${t.colors.fg}07 1px, transparent 1px),
      linear-gradient(90deg, ${t.colors.fg}07 1px, transparent 1px);
    background-size: 56px 56px;
    opacity: 0;
    will-change: opacity;
  }
  #${id} .ccm-heading {
    position: absolute; left: 50%; top: 10%; transform: translateX(-50%);
    font-family: ${t.fonts.display};
    font-size: clamp(36px, 4vw, 64px);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: ${t.colors.fg};
    opacity: 0;
    z-index: 2;
    text-align: center;
    max-width: 70%;
  }
  /* Two side panels */
  #${id} .ccm-side {
    position: absolute;
    top: 28%;
    width: 38%;
    height: 56%;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    border: 1px solid ${t.colors.fg}26;
    padding: 32px;
    box-sizing: border-box;
    opacity: 0;
    will-change: opacity;
  }
  #${id} .ccm-side.left { left: 6%; }
  #${id} .ccm-side.right { right: 6%; border-color: ${t.colors.accent}66; }
  #${id} .ccm-label {
    font-size: 11px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: ${t.colors.muted};
    margin-bottom: 16px;
  }
  #${id} .ccm-value {
    font-family: ${t.fonts.display};
    font-size: clamp(72px, 7vw, 130px);
    font-weight: 800;
    line-height: 0.95;
    color: ${t.colors.fg};
    margin-bottom: 24px;
  }
  #${id} .ccm-side.right .ccm-value { color: ${t.colors.accent}; }
  /* Pixel-bar fill */
  #${id} .ccm-bar-track {
    width: 100%;
    height: 18px;
    background: ${t.colors.fg}10;
    position: relative;
    margin-top: auto;
    overflow: hidden;
  }
  #${id} .ccm-bar-fill {
    position: absolute;
    left: 0; top: 0; bottom: 0;
    width: 0%;
    background: ${t.colors.fg};
    will-change: width;
    background-image: repeating-linear-gradient(
      to right,
      ${t.colors.fg} 0,
      ${t.colors.fg} 4px,
      ${t.colors.bg}80 4px,
      ${t.colors.bg}80 6px
    );
  }
  #${id} .ccm-side.right .ccm-bar-fill {
    background: ${t.colors.accent};
    background-image: repeating-linear-gradient(
      to right,
      ${t.colors.accent} 0,
      ${t.colors.accent} 4px,
      ${t.colors.bg}80 4px,
      ${t.colors.bg}80 6px
    );
  }
  /* Divider rule between the two panels */
  #${id} .ccm-divider {
    position: absolute; left: 50%; top: 30%; bottom: 18%;
    width: 1px;
    background: ${t.colors.fg}33;
    transform: translateX(-50%);
    transform-origin: top;
    will-change: transform;
  }
  #${id} .ccm-footnote {
    position: absolute; left: 50%; bottom: 6%; transform: translateX(-50%);
    font-size: 10px;
    color: ${t.colors.muted};
    letter-spacing: 0.16em;
    text-transform: uppercase;
    text-align: center;
    opacity: 0;
    z-index: 2;
    max-width: 60%;
  }
  /* Continuous scanline */
  #${id} .ccm-scanlines {
    position: absolute; inset: 0; pointer-events: none; z-index: 3;
    background-image: repeating-linear-gradient(
      to bottom,
      ${t.colors.fg}10 0,
      ${t.colors.fg}10 1px,
      transparent 1px,
      transparent 4px
    );
    mix-blend-mode: screen;
    opacity: 0.5;
    animation: ccm-flicker-${id} 5s steps(6) infinite;
  }
  @keyframes ccm-flicker-${id} {
    0%, 92% { opacity: 0.5; }
    93%, 95% { opacity: 0.85; }
    100%    { opacity: 0.5; }
  }
</style>
<div id="${id}" class="scene-cyber-comparison" data-composition-id="${id}" data-scene-id="${id}" data-duration="${dur}">
  <div class="ccm-grid"></div>
  <div class="ccm-heading">${escapeHtml(heading)}</div>
  <div class="ccm-divider"></div>
  <div class="ccm-side left">
    <div class="ccm-label">${escapeHtml(left.label)}</div>
    <div class="ccm-value">${escapeHtml(left.value)}</div>
    <div class="ccm-bar-track"><div class="ccm-bar-fill" data-target="${left.fill ?? 50}"></div></div>
  </div>
  <div class="ccm-side right">
    <div class="ccm-label">${escapeHtml(right.label)}</div>
    <div class="ccm-value">${escapeHtml(right.value)}</div>
    <div class="ccm-bar-track"><div class="ccm-bar-fill" data-target="${right.fill ?? 50}"></div></div>
  </div>
  ${footnote ? `<div class="ccm-footnote">${escapeHtml(footnote)}</div>` : ""}
  <div class="ccm-scanlines"></div>
</div>
<script>
  (function(){
    const ${tlVar} = gsap.timeline({ paused: true });
    ${tlVar}.to('#${id} .ccm-grid', { opacity: 1, duration: 0.3 }, 0);
    ${tlVar}.to('#${id} .ccm-heading', { opacity: 1, duration: 0.4, ease: 'power3.out' }, 0.05);
    ${tlVar}.from('#${id} .ccm-divider', { scaleY: 0, duration: 0.4, ease: 'power3.out' }, 0.2);
    ${tlVar}.to('#${id} .ccm-side.left', { opacity: 1, duration: 0.35 }, 0.35);
    ${tlVar}.to('#${id} .ccm-side.right', { opacity: 1, duration: 0.35 }, 0.5);
    // Bars fill — left first (older state), then right with bigger glitch
    document.querySelectorAll('#${id} .ccm-bar-fill').forEach((el, i) => {
      const target = parseFloat(el.getAttribute('data-target')) || 50;
      ${tlVar}.to(el, { width: target + '%', duration: 0.65, ease: 'power3.out' }, 0.7 + i * 0.15);
    });
    ${tlVar}.to('#${id} .ccm-footnote', { opacity: 1, duration: 0.3 }, 1.6);
    window.__timelines = window.__timelines || {};
    window.__timelines['${id}'] = ${tlVar};
  })();
</script>
`.trim();
}

/**
 * Convenience export. Mirrors the existing CYBERLOFI_TEMPLATES pattern so
 * builtin.ts can spread both arrays into BUILTIN_TEMPLATES.
 */
export const CYBERLOFI_DATA_TEMPLATES: ReadonlyArray<Template> = [
  GLITCH_BAR_CHART_TEMPLATE,
  CYBER_COUNTER_BURST_TEMPLATE,
  DATA_STREAM_REVEAL_TEMPLATE,
  CYBER_COMPARISON_TEMPLATE,
];
