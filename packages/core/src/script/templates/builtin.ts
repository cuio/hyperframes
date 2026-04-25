import type { Template } from "./types.js";
import { escapeHtml, asString, asStringArray, formatSec } from "./util.js";
import { BUILTIN_CHARTS } from "../charts/index.js";

/**
 * Premium template set. Each renders an HTML fragment with self-contained
 * styles + a paused per-scene GSAP timeline registered as window.__timelines[id].
 * The hyperframes runtime composes these onto the master timeline.
 *
 * Design principles (Palantir / data-journalism aesthetic):
 *  - Numbers in monospaced display, accent-colored, large
 *  - Labels in uppercase mono, cyan accent2, letter-spaced
 *  - Headlines in display font, 800–900 weight
 *  - Subtle ambient glow halo behind hero elements
 *  - Motion: power3.out, 0.4–0.7s, staggered 0.15–0.20s
 */

const HOOK_BIGTEXT: Template = {
  id: "hook-bigtext",
  description:
    "Single bold declarative statement, kinetic typography. Best for openers and strong claims.",
  whenToUse: [
    "Opening scene of a video",
    "Single declarative claim or statement",
    "Provocative one-liner the audience needs to land",
  ],
  durationRange: { min: 2, max: 6 },
  hookOnly: false,
  propsSchema: {
    type: "object",
    properties: {
      eyebrow: { type: "string", description: "Small label above the title (optional)" },
      title: { type: "string", description: "The headline text — keep under 12 words" },
      accentWord: {
        type: "string",
        description: "One word from the title to highlight in the accent color (optional)",
      },
    },
    required: ["title"],
  },
  render(props, ctx) {
    const title = asString(props.title) || "Untitled";
    const eyebrow = asString(props.eyebrow);
    const accentWord = asString(props.accentWord);
    const t = ctx.tokens;
    const dur = formatSec(ctx.durationSeconds);
    // Split the title into words → letters for kinetic per-letter reveal.
    // We render each letter as a span; spaces become spacer spans so word
    // wrapping still works.
    const words = title.split(/(\s+)/);
    const letterHtml = words
      .map((word) => {
        if (/^\s+$/.test(word)) return `<span class="hb-space">&nbsp;</span>`;
        const isAccent =
          accentWord && word.toLowerCase().replace(/[^a-z0-9]/g, "") === accentWord.toLowerCase();
        const wordCls = isAccent ? "hb-word hb-accent" : "hb-word";
        const letters = Array.from(word)
          .map((c) => `<span class="hb-letter">${escapeHtml(c)}</span>`)
          .join("");
        return `<span class="${wordCls}">${letters}</span>`;
      })
      .join("");
    return `
<div class="scene scene-hook-bigtext" id="${ctx.sceneId}" data-composition-id="${ctx.sceneId}" data-start="0" data-duration="${dur}">
  <style>
    #${ctx.sceneId}.scene-hook-bigtext { background: transparent; color: ${t.colors.fg}; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; padding: 130px 180px; gap: 36px; position: absolute; inset: 0; }
    #${ctx.sceneId} .hb-side-glow { position: absolute; width: 600px; height: 1080px; right: -120px; top: 0; background: linear-gradient(90deg, transparent 0%, ${t.colors.accent}22 60%, ${t.colors.accent}55 100%); filter: blur(40px); pointer-events: none; opacity: 0; transform: translateX(80px); }
    #${ctx.sceneId} .hb-rule { position: absolute; left: 180px; top: 110px; height: 4px; width: 0; background: ${t.colors.accent}; opacity: 0.95; }
    #${ctx.sceneId} .hb-eyebrow { font-size: 20px; font-weight: 600; letter-spacing: 0.28em; text-transform: uppercase; color: ${t.colors.accent2}; font-family: ${t.fonts.mono}; opacity: 0; position: relative; padding-left: 40px; }
    #${ctx.sceneId} .hb-eyebrow::before { content: ""; position: absolute; left: 0; top: 50%; width: 28px; height: 1.5px; background: ${t.colors.accent2}; transform: translateY(-50%) scaleX(0); transform-origin: left; }
    #${ctx.sceneId} .hb-title { font-size: 128px; font-weight: 800; line-height: 1.0; max-width: 1500px; font-family: ${t.fonts.display}; position: relative; letter-spacing: -0.025em; }
    #${ctx.sceneId} .hb-word { display: inline-block; }
    #${ctx.sceneId} .hb-word.hb-accent { color: ${t.colors.accent}; font-style: italic; }
    #${ctx.sceneId} .hb-letter { display: inline-block; opacity: 0; transform: translateY(60px) rotateX(-90deg); transform-origin: 50% 100%; will-change: transform, opacity; }
    #${ctx.sceneId} .hb-space { display: inline-block; width: 0.32em; }
    #${ctx.sceneId} .hb-meta { display: flex; gap: 24px; align-items: center; font-family: ${t.fonts.mono}; font-size: 16px; letter-spacing: 0.18em; text-transform: uppercase; color: ${t.colors.muted}; opacity: 0; }
    #${ctx.sceneId} .hb-meta .hb-meta-dot { width: 6px; height: 6px; border-radius: 50%; background: ${t.colors.accent}; }
  </style>
  <div class="hb-side-glow"></div>
  <div class="hb-rule"></div>
  ${eyebrow ? `<div class="hb-eyebrow">${escapeHtml(eyebrow)}</div>` : ""}
  <div class="hb-title">${letterHtml}</div>
  <div class="hb-meta"><span class="hb-meta-dot"></span><span>OPEN</span></div>
  <script>
    (function(){
      var s = document.getElementById('${ctx.sceneId}');
      if (!window.gsap || !s) return;
      var tl = window.gsap.timeline({ paused: true });
      // Side glow swoops in from the right, behind the type.
      tl.to(s.querySelector('.hb-side-glow'), { opacity: 1, x: 0, duration: 0.9, ease: 'power3.out' }, 0);
      // Accent rule wipes across.
      tl.to(s.querySelector('.hb-rule'), { width: 180, duration: 0.55, ease: 'expo.out' }, 0.05);
      // Eyebrow underline + text.
      var eb = s.querySelector('.hb-eyebrow');
      if (eb) {
        tl.to(eb, { opacity: 1, duration: 0.4, ease: 'power3.out' }, 0.15);
        tl.to(eb, { '--scale': 1, duration: 0.5, ease: 'expo.out' }, 0.15);
        var ebBefore = eb;
        tl.set(ebBefore, { '--placeholder': 0 }, 0); // satisfy linter
      }
      // Letter cascade — the kinetic typography moment.
      var letters = s.querySelectorAll('.hb-letter');
      tl.to(letters, {
        opacity: 1,
        y: 0,
        rotateX: 0,
        duration: 0.55,
        ease: 'expo.out',
        stagger: { each: 0.025, from: 'start' },
      }, 0.25);
      // Meta line settles in last.
      tl.to(s.querySelector('.hb-meta'), { opacity: 1, duration: 0.4, ease: 'power3.out' }, 0.85);
      window.__timelines = window.__timelines || {};
      window.__timelines['${ctx.sceneId}'] = tl;
    })();
  </script>
</div>`.trim();
  },
};

const HOOK_STATREVEAL: Template = {
  id: "hook-statreveal",
  description:
    "Big counting number with caption. Best when a single statistic is the point of the scene.",
  whenToUse: [
    "Scene's whole point is a striking number, percentage, or money amount",
    "Statistic is the hook of the video",
  ],
  durationRange: { min: 3, max: 6 },
  hookOnly: false,
  propsSchema: {
    type: "object",
    properties: {
      eyebrow: { type: "string", description: "Optional context label above the number" },
      value: { type: "string", description: "The number to display, e.g. '900', '42%', '$3.2T'" },
      prefix: {
        type: "string",
        description: "Optional prefix like '$' or '+' (omit if already in value)",
      },
      suffix: {
        type: "string",
        description: "Optional suffix like '%', 'B', 'M', 'K' (omit if already in value)",
      },
      label: { type: "string", description: "Caption beneath the number" },
      countFrom: {
        type: "number",
        description:
          "If set, animate the number from this start (only when value parses as a number)",
      },
    },
    required: ["value", "label"],
  },
  render(props, ctx) {
    const value = asString(props.value) || "0";
    const label = asString(props.label) || "";
    const eyebrow = asString(props.eyebrow);
    const prefix = asString(props.prefix);
    const suffix = asString(props.suffix);
    const t = ctx.tokens;
    const dur = formatSec(ctx.durationSeconds);
    const numericValue = parseFloat(value.replace(/[^0-9.-]/g, ""));
    const countFromRaw = props.countFrom;
    const countFrom =
      typeof countFromRaw === "number" && Number.isFinite(countFromRaw) ? countFromRaw : 0;
    const canCount = Number.isFinite(numericValue);
    return `
<div class="scene scene-statreveal" id="${ctx.sceneId}" data-composition-id="${ctx.sceneId}" data-start="0" data-duration="${dur}">
  <style>
    #${ctx.sceneId}.scene-statreveal { background: transparent; color: ${t.colors.fg}; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 100px; gap: 40px; position: absolute; inset: 0; }
    #${ctx.sceneId} .sr-ring { position: absolute; left: 50%; top: 50%; width: 0; height: 0; border-radius: 50%; border: 2px solid ${t.colors.accent}; opacity: 0; transform: translate(-50%, -50%); pointer-events: none; }
    #${ctx.sceneId} .sr-ring.r2 { border-color: ${t.colors.accent2}; opacity: 0; }
    #${ctx.sceneId} .sr-eyebrow { font-size: 20px; font-weight: 600; letter-spacing: 0.28em; text-transform: uppercase; color: ${t.colors.accent2}; font-family: ${t.fonts.mono}; opacity: 0; position: relative; padding: 0 28px; display: flex; align-items: center; gap: 12px; }
    #${ctx.sceneId} .sr-eyebrow::before, #${ctx.sceneId} .sr-eyebrow::after { content: ""; width: 24px; height: 1.5px; background: ${t.colors.accent2}; transform: scaleX(0); }
    #${ctx.sceneId} .sr-eyebrow::before { transform-origin: right; }
    #${ctx.sceneId} .sr-eyebrow::after { transform-origin: left; }
    #${ctx.sceneId} .sr-num { font-size: 320px; font-weight: 900; line-height: 1; font-family: ${t.fonts.mono}; color: ${t.colors.accent}; opacity: 0; position: relative; letter-spacing: -0.05em; text-shadow: 0 0 120px ${t.colors.accent}66; transform: scale(0.9); }
    #${ctx.sceneId} .sr-prefix, #${ctx.sceneId} .sr-suffix { font-size: 0.55em; vertical-align: top; line-height: 1; color: ${t.colors.accent3}; opacity: 0; }
    #${ctx.sceneId} .sr-label { font-size: 40px; font-weight: 400; font-style: italic; max-width: 1400px; text-align: center; opacity: 0; color: ${t.colors.muted}; position: relative; letter-spacing: -0.005em; }
    #${ctx.sceneId} .sr-particle { position: absolute; width: 6px; height: 6px; border-radius: 50%; background: ${t.colors.accent}; opacity: 0; pointer-events: none; }
  </style>
  ${Array.from({ length: 12 })
    .map((_, i) => `<div class="sr-particle p-${i}"></div>`)
    .join("\n  ")}
  <div class="sr-ring"></div>
  <div class="sr-ring r2"></div>
  ${eyebrow ? `<div class="sr-eyebrow"><span>${escapeHtml(eyebrow)}</span></div>` : ""}
  <div class="sr-num"><span class="sr-prefix">${escapeHtml(prefix)}</span><span class="sr-val">${escapeHtml(canCount ? String(countFrom) : value)}</span><span class="sr-suffix">${escapeHtml(suffix)}</span></div>
  <div class="sr-label">${escapeHtml(label)}</div>
  <script>
    (function(){
      var s = document.getElementById('${ctx.sceneId}');
      if (!window.gsap || !s) return;
      var tl = window.gsap.timeline({ paused: true });
      // Ring expansion behind the number — anchors the eye.
      var ring = s.querySelector('.sr-ring');
      var ring2 = s.querySelector('.sr-ring.r2');
      tl.to(ring, { width: 600, height: 600, opacity: 0.6, duration: 1.2, ease: 'expo.out' }, 0);
      tl.to(ring, { opacity: 0.18, duration: 0.6, ease: 'power2.inOut' }, 1.0);
      if (ring2) {
        tl.to(ring2, { width: 900, height: 900, opacity: 0.35, duration: 1.4, ease: 'expo.out' }, 0.15);
        tl.to(ring2, { opacity: 0.08, duration: 0.6, ease: 'power2.inOut' }, 1.2);
      }
      // Eyebrow with side rules sliding in from both directions.
      var eb = s.querySelector('.sr-eyebrow');
      if (eb) tl.to(eb, { opacity: 1, duration: 0.5, ease: 'power3.out' }, 0.2);
      // Big number scales up + fades in like a stamp.
      tl.to(s.querySelector('.sr-num'), { opacity: 1, scale: 1, duration: 0.6, ease: 'back.out(1.6)' }, 0.35);
      tl.to(s.querySelector('.sr-prefix'), { opacity: 1, duration: 0.3 }, 0.55);
      tl.to(s.querySelector('.sr-suffix'), { opacity: 1, duration: 0.3 }, 0.55);
      // Particle burst radiates outward when the number lands.
      var particles = s.querySelectorAll('.sr-particle');
      var w = 1920, h = 1080, cx = w / 2, cy = h / 2;
      particles.forEach(function(p, i) {
        var angle = (i / particles.length) * Math.PI * 2;
        var radius = 240 + (i % 3) * 60;
        window.gsap.set(p, { x: cx, y: cy });
        tl.to(p, {
          x: cx + Math.cos(angle) * radius,
          y: cy + Math.sin(angle) * radius,
          opacity: 0,
          duration: 1.0,
          ease: 'expo.out',
          onStart: function(){ window.gsap.set(p, { opacity: 0.9 }); },
        }, 0.7);
      });
      // Caption fades in last.
      tl.to(s.querySelector('.sr-label'), { opacity: 1, duration: 0.5, ease: 'power3.out' }, 1.0);
      ${
        canCount
          ? `var counter = { v: ${countFrom} };
      tl.to(counter, { v: ${numericValue}, duration: ${Math.min(1.4, ctx.durationSeconds * 0.45).toFixed(2)}, ease: 'expo.out', onUpdate: function() { var el = s.querySelector('.sr-val'); if (el) el.textContent = (Math.round(counter.v * 10) / 10).toLocaleString(); } }, 0.45);`
          : ""
      }
      window.__timelines = window.__timelines || {};
      window.__timelines['${ctx.sceneId}'] = tl;
    })();
  </script>
</div>`.trim();
  },
};

const AROLL_TEXT: Template = {
  id: "aroll-text",
  description:
    "Narrator-driven text panel. Title plus optional supporting paragraph. Default workhorse template.",
  whenToUse: [
    "Standard narration scene with a clear point",
    "When no specific visual structure (chart, list, comparison) fits",
    "Mid-video explanation",
  ],
  durationRange: { min: 3, max: 9 },
  propsSchema: {
    type: "object",
    properties: {
      eyebrow: { type: "string", description: "Optional small label above the title" },
      title: { type: "string", description: "Short title, under 10 words" },
      body: { type: "string", description: "Optional supporting paragraph, 1-2 sentences" },
      accentWord: { type: "string", description: "Optional word in title to highlight" },
    },
    required: ["title"],
  },
  render(props, ctx) {
    const title = asString(props.title) || "";
    const body = asString(props.body);
    const eyebrow = asString(props.eyebrow);
    const accentWord = asString(props.accentWord);
    const t = ctx.tokens;
    const dur = formatSec(ctx.durationSeconds);
    // Kinetic typography: split title into word spans for per-word stagger.
    // Each word becomes its own animated unit so the title reads like it's
    // being typed, not pasted.
    const titleWords = title.split(/(\s+)/);
    const titleHtml = titleWords
      .map((w) => {
        if (/^\s+$/.test(w)) return `<span class="at-space">&nbsp;</span>`;
        const isAccent =
          accentWord && w.toLowerCase().replace(/[^a-z0-9]/g, "") === accentWord.toLowerCase();
        const cls = isAccent ? "at-word at-accent" : "at-word";
        return `<span class="${cls}"><span class="at-word-inner">${escapeHtml(w)}</span></span>`;
      })
      .join("");
    const bodyWords = body.split(/(\s+)/);
    const bodyHtml = body
      ? bodyWords
          .map((w) =>
            /^\s+$/.test(w)
              ? `<span class="at-space">&nbsp;</span>`
              : `<span class="at-bword">${escapeHtml(w)}</span>`,
          )
          .join("")
      : "";
    return `
<div class="scene scene-aroll-text" id="${ctx.sceneId}" data-composition-id="${ctx.sceneId}" data-start="0" data-duration="${dur}">
  <style>
    #${ctx.sceneId}.scene-aroll-text { background: ${t.colors.bg}; color: ${t.colors.fg}; display: flex; flex-direction: column; justify-content: center; padding: 110px 160px; gap: 28px; position: absolute; inset: 0; }
    #${ctx.sceneId} .at-eyebrow { font-size: 16px; font-weight: 600; letter-spacing: 0.22em; text-transform: uppercase; color: ${t.colors.accent2}; font-family: ${t.fonts.mono}; opacity: 0; position: relative; padding-left: 36px; }
    #${ctx.sceneId} .at-eyebrow::before { content: ""; position: absolute; left: 0; top: 50%; width: 26px; height: 1.5px; background: ${t.colors.accent2}; transform: translateY(-50%) scaleX(0); transform-origin: left; }
    #${ctx.sceneId} .at-title { font-size: 78px; font-weight: 800; line-height: 1.06; max-width: 1500px; font-family: ${t.fonts.display}; position: relative; letter-spacing: -0.02em; }
    #${ctx.sceneId} .at-title .at-word { display: inline-block; overflow: hidden; vertical-align: bottom; }
    #${ctx.sceneId} .at-title .at-word-inner { display: inline-block; transform: translateY(110%); will-change: transform; }
    #${ctx.sceneId} .at-title .at-accent .at-word-inner { color: ${t.colors.accent}; }
    #${ctx.sceneId} .at-title .at-space { display: inline-block; width: 0.32em; }
    #${ctx.sceneId} .at-rule { position: absolute; height: 4px; width: 0; background: ${t.colors.accent}; left: 160px; top: 110px; opacity: 0.95; }
    #${ctx.sceneId} .at-body { font-size: 32px; font-weight: 400; line-height: 1.42; max-width: 1300px; color: ${t.colors.muted}; position: relative; }
    #${ctx.sceneId} .at-body .at-bword { display: inline-block; opacity: 0; transform: translateY(8px); will-change: transform, opacity; }
    #${ctx.sceneId} .at-body .at-space { display: inline-block; width: 0.28em; }
  </style>
  <div class="at-rule"></div>
  ${eyebrow ? `<div class="at-eyebrow">${escapeHtml(eyebrow)}</div>` : ""}
  <div class="at-title">${titleHtml}</div>
  ${body ? `<div class="at-body">${bodyHtml}</div>` : ""}
  <script>
    (function(){
      var s = document.getElementById('${ctx.sceneId}');
      if (!window.gsap || !s) return;
      var tl = window.gsap.timeline({ paused: true });
      tl.to(s.querySelector('.at-rule'), { width: 140, duration: 0.55, ease: 'expo.out' }, 0);
      var eb = s.querySelector('.at-eyebrow');
      if (eb) {
        tl.to(eb, { opacity: 1, duration: 0.4, ease: '${t.motion.ease}' }, 0.1);
        var ebBefore = eb.querySelector ? null : null;
        tl.to(eb, { '--placeholder': 1, duration: 0.5, ease: 'expo.out' }, 0.1);
      }
      // Per-word kinetic title reveal — each word slides up from below its
      // own clip mask, giving a crisp newsroom feel without per-letter cost.
      var titleWords = s.querySelectorAll('.at-title .at-word-inner');
      tl.to(titleWords, {
        y: 0,
        duration: 0.55,
        ease: 'expo.out',
        stagger: { each: 0.06, from: 'start' },
      }, ${eyebrow ? 0.2 : 0.05});
      // Body — faster per-word fade with light upward slide.
      var bodyWords = s.querySelectorAll('.at-body .at-bword');
      if (bodyWords.length) {
        tl.to(bodyWords, {
          opacity: 1,
          y: 0,
          duration: 0.4,
          ease: 'power3.out',
          stagger: { each: 0.025, from: 'start' },
        }, ${0.35 + (eyebrow ? 0.15 : 0)});
      }
      window.__timelines = window.__timelines || {};
      window.__timelines['${ctx.sceneId}'] = tl;
    })();
  </script>
</div>`.trim();
  },
};

const CONCEPT_CALLOUT: Template = {
  id: "concept-callout",
  description: "Sequential reveal of bullet items. Best for short lists, steps, or principles.",
  whenToUse: [
    "Scene narrates 2–5 discrete points or steps",
    "List of features, benefits, or principles",
    "When pacing benefits from sequential reveal",
  ],
  durationRange: { min: 4, max: 10 },
  propsSchema: {
    type: "object",
    properties: {
      eyebrow: { type: "string", description: "Optional small label above the title" },
      title: { type: "string", description: "Short title for the list" },
      items: {
        type: "array",
        items: { type: "string" },
        description: "Bullet items, 2 to 5 entries, each under 8 words",
      },
    },
    required: ["title", "items"],
  },
  render(props, ctx) {
    const title = asString(props.title) || "";
    const eyebrow = asString(props.eyebrow);
    const items = asStringArray(props.items).slice(0, 5);
    const t = ctx.tokens;
    const dur = formatSec(ctx.durationSeconds);
    // Per-item stagger spaced so the last badge lands well before the scene
    // ends, leaving a beat for the audio to catch up.
    const stagger =
      items.length > 0 ? Math.min(0.55, ctx.durationSeconds / (items.length + 3)) : 0.4;
    const itemsHtml = items
      .map((item, i) => {
        // Per-word reveal inside each item label.
        const words = item
          .split(/(\s+)/)
          .map((w) =>
            /^\s+$/.test(w)
              ? `<span class="co-space">&nbsp;</span>`
              : `<span class="co-iword">${escapeHtml(w)}</span>`,
          )
          .join("");
        return `<div class="co-item" data-idx="${i}"><span class="co-badge">${String(i + 1).padStart(2, "0")}</span><span class="co-label">${words}</span></div>`;
      })
      .join("\n    ");
    return `
<div class="scene scene-callout" id="${ctx.sceneId}" data-composition-id="${ctx.sceneId}" data-start="0" data-duration="${dur}">
  <style>
    #${ctx.sceneId}.scene-callout { background: ${t.colors.bg}; color: ${t.colors.fg}; display: flex; flex-direction: column; justify-content: center; padding: 110px 160px; gap: 36px; position: absolute; inset: 0; }
    #${ctx.sceneId} .co-eyebrow { font-size: 16px; font-weight: 600; letter-spacing: 0.22em; text-transform: uppercase; color: ${t.colors.accent2}; font-family: ${t.fonts.mono}; opacity: 0; position: relative; padding-left: 36px; }
    #${ctx.sceneId} .co-eyebrow::before { content: ""; position: absolute; left: 0; top: 50%; width: 26px; height: 1.5px; background: ${t.colors.accent2}; transform: translateY(-50%) scaleX(0); transform-origin: left; }
    #${ctx.sceneId} .co-title { font-size: 64px; font-weight: 800; font-family: ${t.fonts.display}; opacity: 0; transform: translateY(14px); position: relative; letter-spacing: -0.02em; }
    #${ctx.sceneId} .co-list { display: flex; flex-direction: column; gap: 26px; max-width: 1500px; position: relative; padding-left: 16px; }
    /* Vertical spine connecting all badges — draws in once, then anchors the list. */
    #${ctx.sceneId} .co-spine { position: absolute; left: 38px; top: 36px; bottom: 36px; width: 2px; background: ${t.colors.accent}; transform-origin: top; transform: scaleY(0); will-change: transform; }
    #${ctx.sceneId} .co-item { font-size: 38px; font-weight: 500; display: flex; gap: 32px; align-items: center; position: relative; }
    #${ctx.sceneId} .co-badge { display: inline-flex; align-items: center; justify-content: center; width: 64px; height: 64px; min-width: 64px; border-radius: 50%; background: ${t.colors.accent}; color: ${t.colors.bg}; font-family: ${t.fonts.mono}; font-weight: 800; font-size: 22px; letter-spacing: 0.04em; opacity: 0; transform: scale(0.4) rotate(-90deg); will-change: transform, opacity; box-shadow: 0 0 0 6px ${t.colors.accent}1a; }
    #${ctx.sceneId} .co-label { display: inline-block; line-height: 1.18; }
    #${ctx.sceneId} .co-label .co-iword { display: inline-block; opacity: 0; transform: translateY(10px); will-change: transform, opacity; }
    #${ctx.sceneId} .co-label .co-space { display: inline-block; width: 0.28em; }
  </style>
  ${eyebrow ? `<div class="co-eyebrow">${escapeHtml(eyebrow)}</div>` : ""}
  <div class="co-title">${escapeHtml(title)}</div>
  <div class="co-list">
    <div class="co-spine"></div>
    ${itemsHtml}
  </div>
  <script>
    (function(){
      var s = document.getElementById('${ctx.sceneId}');
      if (!window.gsap || !s) return;
      var tl = window.gsap.timeline({ paused: true });
      var eb = s.querySelector('.co-eyebrow');
      if (eb) tl.to(eb, { opacity: 1, duration: 0.4, ease: '${t.motion.ease}' }, 0);
      tl.to(s.querySelector('.co-title'), { opacity: 1, y: 0, duration: 0.5, ease: '${t.motion.ease}' }, ${eyebrow ? 0.15 : 0});
      // Spine grows downward as the badges drop in — gives the list a sense
      // of structure assembling, not just text appearing.
      var spineStart = ${0.35 + (eyebrow ? 0.15 : 0)};
      var totalItems = ${items.length};
      var perItem = ${stagger.toFixed(3)};
      var spineDur = Math.max(0.4, perItem * totalItems);
      tl.to(s.querySelector('.co-spine'), { scaleY: 1, duration: spineDur, ease: 'power2.inOut' }, spineStart);
      // Badges stamp in with a back-overshoot, settling like coins dropping.
      var badges = s.querySelectorAll('.co-badge');
      tl.to(badges, {
        opacity: 1,
        scale: 1,
        rotate: 0,
        duration: 0.5,
        ease: 'back.out(2)',
        stagger: perItem,
      }, spineStart + 0.05);
      // Item labels — per-word reveal inside each item, staggered with badges.
      var items = s.querySelectorAll('.co-item');
      items.forEach(function(item, i) {
        var words = item.querySelectorAll('.co-iword');
        if (!words.length) return;
        tl.to(words, {
          opacity: 1,
          y: 0,
          duration: 0.4,
          ease: 'power3.out',
          stagger: 0.025,
        }, spineStart + 0.18 + i * perItem);
      });
      window.__timelines = window.__timelines || {};
      window.__timelines['${ctx.sceneId}'] = tl;
    })();
  </script>
</div>`.trim();
  },
};

const COMPARISON: Template = {
  id: "comparison",
  description: "Side-by-side compare/contrast. Best when narration weighs A against B.",
  whenToUse: [
    "Compare two things explicitly (before vs after, old vs new, A vs B)",
    "Contrast two approaches or options",
  ],
  durationRange: { min: 4, max: 8 },
  propsSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Optional context heading above the two columns" },
      left: {
        type: "object",
        properties: {
          label: { type: "string", description: "Heading for the left column" },
          value: { type: "string", description: "Big value or summary for the left side" },
        },
        required: ["label", "value"],
      },
      right: {
        type: "object",
        properties: {
          label: { type: "string", description: "Heading for the right column" },
          value: { type: "string", description: "Big value or summary for the right side" },
        },
        required: ["label", "value"],
      },
    },
    required: ["left", "right"],
  },
  render(props, ctx) {
    const left = (props.left ?? {}) as { label?: unknown; value?: unknown };
    const right = (props.right ?? {}) as { label?: unknown; value?: unknown };
    const title = asString(props.title);
    const t = ctx.tokens;
    const dur = formatSec(ctx.durationSeconds);
    return `
<div class="scene scene-compare" id="${ctx.sceneId}" data-composition-id="${ctx.sceneId}" data-start="0" data-duration="${dur}">
  <style>
    #${ctx.sceneId}.scene-compare { background: ${t.colors.bg}; color: ${t.colors.fg}; display: flex; flex-direction: column; justify-content: center; padding: 100px; gap: 50px; position: absolute; inset: 0; }
    #${ctx.sceneId} .cm-grid { position: absolute; inset: 0; background-image: linear-gradient(${t.colors.subtle}0a 1px, transparent 1px), linear-gradient(90deg, ${t.colors.subtle}0a 1px, transparent 1px); background-size: 80px 80px; pointer-events: none; }
    #${ctx.sceneId} .cm-title { font-size: 44px; font-weight: 700; text-align: center; opacity: 0; position: relative; color: ${t.colors.fg}; letter-spacing: -0.01em; }
    #${ctx.sceneId} .cm-row { display: grid; grid-template-columns: 1fr auto 1fr; gap: 60px; align-items: center; position: relative; }
    #${ctx.sceneId} .cm-col { display: flex; flex-direction: column; gap: 18px; align-items: center; opacity: 0; padding: 40px; border: 1px solid ${t.colors.subtle}33; background: ${t.colors.surface}; border-radius: 16px; }
    #${ctx.sceneId} .cm-col.left { transform: translateX(-30px); }
    #${ctx.sceneId} .cm-col.right { transform: translateX(30px); }
    #${ctx.sceneId} .cm-label { font-size: 18px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; color: ${t.colors.accent2}; font-family: ${t.fonts.mono}; }
    #${ctx.sceneId} .cm-value { font-size: 88px; font-weight: 900; line-height: 1.04; text-align: center; font-family: ${t.fonts.display}; letter-spacing: -0.02em; }
    #${ctx.sceneId} .cm-col.right .cm-value { color: ${t.colors.accent}; }
    #${ctx.sceneId} .cm-col.left .cm-value { color: ${t.colors.fg}; }
    #${ctx.sceneId} .cm-vs { font-size: 32px; font-weight: 700; color: ${t.colors.accent3}; opacity: 0; font-family: ${t.fonts.mono}; letter-spacing: 0.1em; }
  </style>
  <div class="cm-grid"></div>
  ${title ? `<div class="cm-title">${escapeHtml(title)}</div>` : ""}
  <div class="cm-row">
    <div class="cm-col left">
      <div class="cm-label">${escapeHtml(asString(left.label))}</div>
      <div class="cm-value">${escapeHtml(asString(left.value))}</div>
    </div>
    <div class="cm-vs">VS</div>
    <div class="cm-col right">
      <div class="cm-label">${escapeHtml(asString(right.label))}</div>
      <div class="cm-value">${escapeHtml(asString(right.value))}</div>
    </div>
  </div>
  <script>
    (function(){
      var s = document.getElementById('${ctx.sceneId}');
      if (!window.gsap || !s) return;
      var tl = window.gsap.timeline({ paused: true });
      var ti = s.querySelector('.cm-title'); if (ti) tl.to(ti, { opacity: 1, duration: 0.4, ease: '${t.motion.ease}' }, 0);
      tl.to(s.querySelector('.cm-col.left'), { opacity: 1, x: 0, duration: 0.55, ease: '${t.motion.ease}' }, 0.25);
      tl.to(s.querySelector('.cm-vs'), { opacity: 1, scale: 1, duration: 0.35, ease: 'back.out(2)' }, 0.45);
      tl.to(s.querySelector('.cm-col.right'), { opacity: 1, x: 0, duration: 0.55, ease: '${t.motion.ease}' }, 0.6);
      window.__timelines = window.__timelines || {};
      window.__timelines['${ctx.sceneId}'] = tl;
    })();
  </script>
</div>`.trim();
  },
};

const QUOTE: Template = {
  id: "quote",
  description:
    "Pull quote with optional attribution. Best for citations, testimonials, or punchy lines.",
  whenToUse: [
    "Direct quote from someone (cited)",
    "Testimonial or punchy line meant to land emotionally",
  ],
  durationRange: { min: 3, max: 7 },
  propsSchema: {
    type: "object",
    properties: {
      quote: { type: "string", description: "The quoted text — keep under 25 words" },
      attribution: { type: "string", description: "Optional source or speaker name" },
    },
    required: ["quote"],
  },
  render(props, ctx) {
    const quote = asString(props.quote) || "";
    const attribution = asString(props.attribution);
    const t = ctx.tokens;
    const dur = formatSec(ctx.durationSeconds);
    return `
<div class="scene scene-quote" id="${ctx.sceneId}" data-composition-id="${ctx.sceneId}" data-start="0" data-duration="${dur}">
  <style>
    #${ctx.sceneId}.scene-quote { background: ${t.colors.bg}; color: ${t.colors.fg}; display: flex; flex-direction: column; justify-content: center; padding: 130px 180px; gap: 36px; position: absolute; inset: 0; }
    #${ctx.sceneId} .q-glow { position: absolute; width: 1000px; height: 1000px; border-radius: 50%; background: radial-gradient(circle, ${t.colors.accent}1f 0%, transparent 60%); top: 50%; left: 30%; filter: blur(80px); pointer-events: none; }
    #${ctx.sceneId} .q-mark { font-size: 180px; line-height: 0.8; color: ${t.colors.accent}; font-family: serif; opacity: 0; position: relative; }
    #${ctx.sceneId} .q-text { font-size: 66px; font-weight: 600; line-height: 1.18; max-width: 1500px; font-family: ${t.fonts.display}; opacity: 0; transform: translateY(18px); position: relative; letter-spacing: -0.015em; }
    #${ctx.sceneId} .q-attr { font-size: 24px; font-weight: 600; color: ${t.colors.accent2}; letter-spacing: 0.18em; text-transform: uppercase; opacity: 0; font-family: ${t.fonts.mono}; position: relative; }
  </style>
  <div class="q-glow"></div>
  <div class="q-mark">"</div>
  <div class="q-text">${escapeHtml(quote)}</div>
  ${attribution ? `<div class="q-attr">— ${escapeHtml(attribution)}</div>` : ""}
  <script>
    (function(){
      var s = document.getElementById('${ctx.sceneId}');
      if (!window.gsap || !s) return;
      var tl = window.gsap.timeline({ paused: true });
      tl.to(s.querySelector('.q-mark'), { opacity: 1, duration: 0.5, ease: '${t.motion.ease}' }, 0);
      tl.to(s.querySelector('.q-text'), { opacity: 1, y: 0, duration: 0.7, ease: '${t.motion.ease}' }, 0.2);
      var a = s.querySelector('.q-attr'); if (a) tl.to(a, { opacity: 1, duration: 0.4, ease: '${t.motion.ease}' }, 0.65);
      window.__timelines = window.__timelines || {};
      window.__timelines['${ctx.sceneId}'] = tl;
    })();
  </script>
</div>`.trim();
  },
};

const OUTRO_CTA: Template = {
  id: "outro-cta",
  description: "Closing call-to-action card. Always use as the final scene.",
  whenToUse: ["Last scene of the video", "Wrap-up with an action for the viewer"],
  durationRange: { min: 2, max: 5 },
  propsSchema: {
    type: "object",
    properties: {
      headline: { type: "string", description: "Closing line, e.g. 'Try it yourself.'" },
      cta: { type: "string", description: "The action prompt, e.g. 'visit hyperframes.dev'" },
    },
    required: ["headline"],
  },
  render(props, ctx) {
    const headline = asString(props.headline) || "Thanks for watching.";
    const cta = asString(props.cta);
    const t = ctx.tokens;
    const dur = formatSec(ctx.durationSeconds);
    return `
<div class="scene scene-outro" id="${ctx.sceneId}" data-composition-id="${ctx.sceneId}" data-start="0" data-duration="${dur}">
  <style>
    #${ctx.sceneId}.scene-outro { background: ${t.colors.bg}; color: ${t.colors.fg}; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 100px; gap: 36px; text-align: center; position: absolute; inset: 0; }
    #${ctx.sceneId} .ou-glow { position: absolute; width: 1100px; height: 1100px; border-radius: 50%; background: radial-gradient(circle, ${t.colors.accent}26 0%, transparent 60%); top: 50%; left: 50%; transform: translate(-50%, -50%); filter: blur(80px); pointer-events: none; }
    #${ctx.sceneId} .ou-headline { font-size: 96px; font-weight: 900; line-height: 1.04; max-width: 1500px; font-family: ${t.fonts.display}; opacity: 0; transform: translateY(20px); position: relative; letter-spacing: -0.025em; background: linear-gradient(135deg, ${t.colors.fg} 30%, ${t.colors.accent} 100%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent; }
    #${ctx.sceneId} .ou-cta { font-size: 32px; font-weight: 600; color: ${t.colors.accent2}; letter-spacing: 0.18em; opacity: 0; font-family: ${t.fonts.mono}; text-transform: uppercase; position: relative; padding: 14px 32px; border: 1px solid ${t.colors.accent2}66; border-radius: 999px; }
  </style>
  <div class="ou-glow"></div>
  <div class="ou-headline">${escapeHtml(headline)}</div>
  ${cta ? `<div class="ou-cta">${escapeHtml(cta)}</div>` : ""}
  <script>
    (function(){
      var s = document.getElementById('${ctx.sceneId}');
      if (!window.gsap || !s) return;
      var tl = window.gsap.timeline({ paused: true });
      tl.to(s.querySelector('.ou-headline'), { opacity: 1, y: 0, duration: 0.7, ease: '${t.motion.ease}' }, 0);
      var c = s.querySelector('.ou-cta'); if (c) tl.to(c, { opacity: 1, duration: 0.5, ease: '${t.motion.ease}' }, 0.4);
      window.__timelines = window.__timelines || {};
      window.__timelines['${ctx.sceneId}'] = tl;
    })();
  </script>
</div>`.trim();
  },
};

/**
 * Chart-scene wraps any chart from the chart library inside a HackerNoon-style
 * frame: red top rule, bold serif title, italic subtitle, source line bottom-left,
 * watermark bottom-right. Animated chart entrances are driven by a per-scene
 * timeline registered as window.__timelines[sceneId].
 */
const CHART_SCENE: Template = {
  id: "chart-scene",
  description:
    "Editorial chart card with title, subtitle, source, and a chart from the chart catalog. Use whenever the scene is best told as data.",
  whenToUse: [
    "The scene's job is to land a comparison, ratio, trend, or magnitude",
    "Data is the visual hook — number(s), bars, lines, donut, waffle, timeline",
  ],
  durationRange: { min: 3, max: 10 },
  propsSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Bold serif title at top of the card" },
      subtitle: { type: "string", description: "Italic subtitle, e.g. data range or methodology" },
      source: { type: "string", description: "Source line, e.g. 'Sources: NIST; Bloomberg'" },
      watermark: { type: "string", description: "Author/brand watermark bottom-right" },
      chart: {
        type: "object",
        description: "Chart spec — choose from BUILTIN_CHARTS",
        properties: {
          type: {
            type: "string",
            enum: BUILTIN_CHARTS.map((c) => c.id),
            description: "Chart id from the catalog",
          },
          props: {
            type: "object",
            description: "Props for the chosen chart type — see chart catalog for each schema",
          },
        },
        required: ["type", "props"],
      },
    },
    required: ["title", "chart"],
  },
  render(props, ctx) {
    const t = ctx.tokens;
    const dur = formatSec(ctx.durationSeconds);
    const title = asString(props.title);
    const subtitle = asString(props.subtitle);
    const source = asString(props.source);
    const watermark = asString(props.watermark);
    const chartSpec = (props.chart ?? {}) as { type?: unknown; props?: unknown };
    const chartType = asString(chartSpec.type);
    const chartProps = (chartSpec.props ?? {}) as Record<string, unknown>;
    const chart = BUILTIN_CHARTS.find((c) => c.id === chartType);
    const chartId = `${ctx.sceneId}-chart`;
    const chartW = 1620;
    const chartH = 700;
    const chartSvg = chart
      ? chart.render(chartProps, { chartId, width: chartW, height: chartH, tokens: t })
      : `<div style="color:${t.colors.muted};text-align:center;">Unknown chart type "${escapeHtml(chartType)}"</div>`;
    const enterMs = t.motion.enterMs;
    return `
<div class="scene scene-chart" id="${ctx.sceneId}" data-composition-id="${ctx.sceneId}" data-start="0" data-duration="${dur}">
  <style>
    #${ctx.sceneId}.scene-chart { background: ${t.colors.bg}; color: ${t.colors.fg}; padding: 80px 110px 70px; display: flex; flex-direction: column; gap: 18px; position: absolute; inset: 0; font-family: ${t.fonts.display}; }
    #${ctx.sceneId} .cs-rule { width: 120px; height: 5px; background: ${t.colors.accent}; opacity: 0; transform-origin: left; transform: scaleX(0.4); }
    #${ctx.sceneId} .cs-title { font-size: 56px; font-weight: 700; line-height: 1.12; max-width: 1700px; opacity: 0; transform: translateY(14px); letter-spacing: -0.01em; }
    #${ctx.sceneId} .cs-subtitle { font-size: 26px; font-style: italic; color: ${t.colors.muted}; max-width: 1500px; opacity: 0; transform: translateY(10px); }
    #${ctx.sceneId} .cs-chart { flex: 1; display: flex; align-items: center; justify-content: center; padding: 20px 0 10px; opacity: 0; }
    #${ctx.sceneId} .cs-footer { display: flex; justify-content: space-between; align-items: end; font-size: 18px; color: ${t.colors.muted}; opacity: 0; }
    #${ctx.sceneId} .cs-watermark { color: ${t.colors.subtle}; font-style: italic; }
  </style>
  <div class="cs-rule"></div>
  <div class="cs-title">${escapeHtml(title)}</div>
  ${subtitle ? `<div class="cs-subtitle">${escapeHtml(subtitle)}</div>` : ""}
  <div class="cs-chart">${chartSvg}</div>
  <div class="cs-footer">
    <div>${source ? escapeHtml(source) : ""}</div>
    <div class="cs-watermark">${watermark ? escapeHtml(watermark) : ""}</div>
  </div>
  <script>
    (function(){
      var s = document.getElementById('${ctx.sceneId}');
      if (!window.gsap || !s) return;
      var tl = window.gsap.timeline({ paused: true });
      tl.to(s.querySelector('.cs-rule'), { opacity: 1, scaleX: 1, duration: 0.45, ease: '${t.motion.ease}' }, 0);
      tl.to(s.querySelector('.cs-title'), { opacity: 1, y: 0, duration: ${enterMs / 1000}, ease: '${t.motion.ease}' }, 0.1);
      var sub = s.querySelector('.cs-subtitle');
      if (sub) tl.to(sub, { opacity: 1, y: 0, duration: ${(enterMs * 0.8) / 1000}, ease: '${t.motion.ease}' }, 0.25);
      tl.to(s.querySelector('.cs-chart'), { opacity: 1, duration: 0.4, ease: '${t.motion.ease}' }, 0.4);
      // Animate every chart primitive based on data-target attributes.
      var bars = s.querySelectorAll('.hf-bar');
      bars.forEach(function(b, i) {
        var tw = b.getAttribute('data-target-w');
        var ty = b.getAttribute('data-target-y');
        var th = b.getAttribute('data-target-h');
        var vars = { duration: 0.7, ease: '${t.motion.ease}' };
        if (tw) vars.attr = { width: parseFloat(tw) };
        if (ty || th) vars.attr = Object.assign(vars.attr || {}, { y: ty ? parseFloat(ty) : undefined, height: th ? parseFloat(th) : undefined });
        tl.to(b, vars, 0.55 + i * 0.12);
      });
      var vals = s.querySelectorAll('.hf-bar-val');
      vals.forEach(function(v, i) {
        tl.to(v, { opacity: 1, duration: 0.35, ease: '${t.motion.ease}' }, 0.85 + i * 0.12);
      });
      var rise = s.querySelector('.hf-rise');
      if (rise) tl.to(rise, { strokeDashoffset: 0, duration: 0.7, ease: '${t.motion.ease}' }, 0.55);
      var crash = s.querySelector('.hf-crash');
      if (crash) tl.to(crash, { strokeDashoffset: 0, duration: 0.7, ease: '${t.motion.ease}' }, 1.1);
      var peak = s.querySelector('.hf-peak');
      if (peak) {
        var tr = peak.getAttribute('data-target-r');
        if (tr) tl.to(peak, { attr: { r: parseFloat(tr) }, duration: 0.4, ease: 'back.out(2)' }, 1.0);
      }
      var peakLabel = s.querySelector('.hf-peak-label');
      if (peakLabel) tl.to(peakLabel, { opacity: 1, duration: 0.35 }, 1.1);
      var dropBadge = s.querySelector('.hf-drop-badge');
      if (dropBadge) tl.to(dropBadge, { opacity: 1, duration: 0.35 }, 1.5);
      var ring = s.querySelector('.hf-ring');
      if (ring) {
        var off = ring.getAttribute('data-target-offset');
        if (off) tl.to(ring, { attr: { 'stroke-dashoffset': parseFloat(off) }, duration: 1.0, ease: '${t.motion.ease}' }, 0.55);
      }
      var centerVal = s.querySelector('.hf-center-value');
      if (centerVal) tl.to(centerVal, { opacity: 1, duration: 0.4 }, 0.9);
      var centerCap = s.querySelector('.hf-center-caption');
      if (centerCap) tl.to(centerCap, { opacity: 1, duration: 0.4 }, 1.1);
      var cells = s.querySelectorAll('.hf-cell');
      cells.forEach(function(cell, i) {
        var to = cell.getAttribute('data-target-opacity');
        tl.to(cell, { opacity: to ? parseFloat(to) : 1, duration: 0.18 }, 0.55 + i * 0.012);
      });
      var spine = s.querySelector('.hf-spine');
      if (spine) {
        var ty2 = spine.getAttribute('data-target-y2');
        if (ty2) tl.to(spine, { attr: { y2: parseFloat(ty2) }, duration: 0.6, ease: '${t.motion.ease}' }, 0.55);
      }
      var events = s.querySelectorAll('.hf-event');
      events.forEach(function(evt, i) {
        tl.to(evt, { opacity: 1, duration: 0.4 }, 0.9 + i * 0.18);
      });
      var layers = s.querySelectorAll('.hf-layer');
      layers.forEach(function(layer, i) {
        var tw = layer.getAttribute('data-target-w');
        if (tw) tl.to(layer, { attr: { width: parseFloat(tw) }, duration: 0.5, ease: '${t.motion.ease}' }, 0.55 + i * 0.12);
      });
      var lineA = s.querySelector('.hf-line-a');
      if (lineA) tl.to(lineA, { strokeDashoffset: 0, duration: 1.2, ease: '${t.motion.ease}' }, 0.55);
      var lineB = s.querySelector('.hf-line-b');
      if (lineB) tl.to(lineB, { strokeDashoffset: 0, duration: 1.2, ease: '${t.motion.ease}' }, 0.55);
      var fill = s.querySelector('.hf-fill');
      if (fill) {
        var fto = fill.getAttribute('data-target-opacity');
        if (fto) tl.to(fill, { opacity: parseFloat(fto), duration: 0.6 }, 1.4);
      }
      var labelA = s.querySelector('.hf-label-a');
      if (labelA) tl.to(labelA, { opacity: 1, duration: 0.35 }, 1.6);
      var labelB = s.querySelector('.hf-label-b');
      if (labelB) tl.to(labelB, { opacity: 1, duration: 0.35 }, 1.6);
      var gap = s.querySelector('.hf-gap');
      if (gap) tl.to(gap, { opacity: 1, duration: 0.3 }, 1.7);
      var gapLabel = s.querySelector('.hf-gap-label');
      if (gapLabel) tl.to(gapLabel, { opacity: 1, duration: 0.3 }, 1.85);
      tl.to(s.querySelector('.cs-footer'), { opacity: 1, duration: 0.4, ease: '${t.motion.ease}' }, 1.1);
      window.__timelines = window.__timelines || {};
      window.__timelines['${ctx.sceneId}'] = tl;
    })();
  </script>
</div>`.trim();
  },
};

export const BUILTIN_TEMPLATES: readonly Template[] = [
  HOOK_BIGTEXT,
  HOOK_STATREVEAL,
  AROLL_TEXT,
  CONCEPT_CALLOUT,
  COMPARISON,
  QUOTE,
  CHART_SCENE,
  OUTRO_CTA,
];

export function getTemplate(id: string): Template | undefined {
  return BUILTIN_TEMPLATES.find((t) => t.id === id);
}
