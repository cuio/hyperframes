import type { AtmospherePreset, AtmosphereContext } from "./types.js";

const STUDIO_FLAT: AtmospherePreset = {
  id: "studio-flat",
  description:
    "No-op. The scene's own background color is the entire backdrop. Use when the brand requires the cleanest possible flat aesthetic.",
  render() {
    return "";
  },
};

const AURORA: AtmospherePreset = {
  id: "aurora",
  description:
    "Slow color-shifting blur — two rotating gradients at different speeds. Dramatic; best for hooks, quotes, outros.",
  render(ctx) {
    const id = ctx.sceneId;
    const t = ctx.tokens;
    const isDark = isDarkColor(t.colors.bg);
    // multiply STAINS a light bg with color; screen LIGHTENS a dark bg.
    // Either way the atmosphere becomes a real visible color shift, not a
    // ghost wash.
    const blendBase = isDark ? "screen" : "multiply";
    const blendPulse = isDark ? "screen" : "overlay";
    return `
<style>
  #${id} .hf-atmo-aurora { position: absolute; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
  #${id} .hf-atmo-aurora::before {
    content: ""; position: absolute; inset: -25%;
    background: conic-gradient(from 0deg at 35% 45%,
      ${t.colors.accent}e6 0deg,
      ${t.colors.accent2}b3 90deg,
      transparent 160deg,
      ${t.colors.accent3}cc 240deg,
      ${t.colors.accent}d9 360deg);
    filter: blur(75px);
    mix-blend-mode: ${blendBase};
    will-change: transform;
    animation: hf-aurora-rot-${id} 38s linear infinite;
  }
  #${id} .hf-atmo-aurora::after {
    content: ""; position: absolute; inset: -20%;
    background:
      radial-gradient(ellipse 60% 50% at 75% 25%, ${t.colors.accent2}b3 0%, transparent 55%),
      radial-gradient(ellipse 50% 60% at 25% 80%, ${t.colors.accent}99 0%, transparent 55%);
    filter: blur(55px);
    mix-blend-mode: ${blendPulse};
    will-change: transform, opacity;
    animation: hf-aurora-pulse-${id} 22s ease-in-out infinite;
  }
  @keyframes hf-aurora-rot-${id} {
    from { transform: rotate(0deg) scale(1.2); }
    to   { transform: rotate(360deg) scale(1.2); }
  }
  @keyframes hf-aurora-pulse-${id} {
    0%, 100% { opacity: 0.85; transform: translate3d(0, 0, 0) scale(1); }
    50%      { opacity: 1;    transform: translate3d(40px, -25px, 0) scale(1.12); }
  }
</style>
<div class="hf-atmo hf-atmo-aurora"></div>`.trim();
  },
};

const GRADIENT_MESH: AtmospherePreset = {
  id: "gradient-mesh",
  description:
    "Four soft radial gradients drifting and breathing. Premium, doesn't compete with chart data while still adding clear depth. Best for chart-scene and comparison.",
  render(ctx) {
    const id = ctx.sceneId;
    const t = ctx.tokens;
    const isDark = isDarkColor(t.colors.bg);
    const blend = isDark ? "screen" : "multiply";
    return `
<style>
  #${id} .hf-atmo-mesh { position: absolute; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
  #${id} .hf-atmo-mesh::before {
    content: ""; position: absolute; inset: -10%;
    background:
      radial-gradient(circle at 18% 28%, ${t.colors.accent}80 0%, transparent 40%),
      radial-gradient(circle at 82% 18%, ${t.colors.accent2}73 0%, transparent 44%),
      radial-gradient(circle at 62% 82%, ${t.colors.accent3}66 0%, transparent 50%),
      radial-gradient(circle at 28% 88%, ${t.colors.accent}55 0%, transparent 54%);
    filter: blur(35px);
    mix-blend-mode: ${blend};
    will-change: transform;
    animation: hf-mesh-drift-${id} 26s ease-in-out infinite;
  }
  @keyframes hf-mesh-drift-${id} {
    0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
    33%      { transform: translate3d(36px, -28px, 0) scale(1.05); }
    66%      { transform: translate3d(-30px, 36px, 0) scale(0.97); }
  }
</style>
<div class="hf-atmo hf-atmo-mesh"></div>`.trim();
  },
};

/**
 * Particle field implemented as TWO tiled SVG layers translated independently
 * via @keyframes. No per-particle DOM nodes — pure GPU transform of two
 * background-image layers — so it stays cheap even with 12+ scenes alive at
 * the same time during scrubbing.
 */
const PARTICLE_FIELD: AtmospherePreset = {
  id: "particle-field",
  description:
    "Two tiled layers of soft floating dots drifting at different speeds. Adds kinetic depth without competing with text. Best for aroll-text and concept-callout.",
  render(ctx) {
    const id = ctx.sceneId;
    const t = ctx.tokens;
    const dotsLayer = (color: string, opacity: number, density: "sparse" | "dense") => {
      const dots =
        density === "dense"
          ? [
              [40, 60, 2.2],
              [120, 180, 1.6],
              [220, 90, 2.8],
              [310, 240, 1.8],
              [380, 50, 2],
              [460, 320, 1.5],
              [540, 130, 2.4],
              [80, 360, 1.7],
              [180, 420, 2.1],
              [260, 480, 1.5],
              [350, 380, 2.3],
              [430, 470, 1.6],
              [520, 410, 2],
              [60, 520, 1.8],
              [200, 560, 2.2],
              [340, 560, 1.5],
              [490, 540, 2.4],
              [150, 280, 1.8],
              [280, 320, 2],
              [420, 200, 1.7],
            ]
          : [
              [80, 100, 3],
              [240, 200, 2.4],
              [400, 80, 3.2],
              [520, 280, 2],
              [120, 380, 2.6],
              [340, 430, 3],
              [480, 480, 2.3],
              [200, 540, 2.7],
              [60, 250, 2],
              [380, 320, 2.5],
            ];
      const circles = dots.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join("");
      const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='600' height='600' viewBox='0 0 600 600'><g fill='${color}' fill-opacity='${opacity}'>${circles}</g></svg>`;
      return svg.replace(/#/g, "%23").replace(/"/g, "'");
    };
    const layerA = dotsLayer(t.colors.accent, 0.75, "dense");
    const layerB = dotsLayer(t.colors.accent2, 0.5, "sparse");
    return `
<style>
  #${id} .hf-atmo-particles { position: absolute; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
  #${id} .hf-atmo-particles::before, #${id} .hf-atmo-particles::after {
    content: ""; position: absolute; inset: -200px;
    background-repeat: repeat;
    will-change: transform, opacity;
  }
  #${id} .hf-atmo-particles::before {
    background-image: url("data:image/svg+xml;utf8,${layerA}");
    animation: hf-particles-a-${id} 64s linear infinite, hf-particles-twinkle-${id} 7s ease-in-out infinite;
  }
  #${id} .hf-atmo-particles::after {
    background-image: url("data:image/svg+xml;utf8,${layerB}");
    transform: scale(1.6);
    animation: hf-particles-b-${id} 96s linear infinite reverse;
    opacity: 0.75;
  }
  @keyframes hf-particles-a-${id} {
    from { transform: translate3d(0, 0, 0); }
    to   { transform: translate3d(-600px, -300px, 0); }
  }
  @keyframes hf-particles-b-${id} {
    from { transform: translate3d(0, 0, 0) scale(1.6); }
    to   { transform: translate3d(-300px, -600px, 0) scale(1.6); }
  }
  @keyframes hf-particles-twinkle-${id} {
    0%, 100% { opacity: 0.85; }
    50%      { opacity: 0.55; }
  }
</style>
<div class="hf-atmo hf-atmo-particles"></div>`.trim();
  },
};

/**
 * Per-scene grain — denser than the global atmosphere's grain, with slow
 * drift, plus a vignette. Adds tactile texture to text-heavy scenes without
 * adding visual noise that competes with content.
 */
const NOISE_GRAIN: AtmospherePreset = {
  id: "noise-grain",
  description:
    "Dense film-grain with slow drift + soft vignette. Tactile, editorial. Pairs well with text-heavy templates.",
  render(ctx) {
    const id = ctx.sceneId;
    const t = ctx.tokens;
    const isDarkBg = isDarkColor(t.colors.bg);
    return `
<style>
  #${id} .hf-atmo-grain { position: absolute; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
  #${id} .hf-atmo-grain::before {
    content: ""; position: absolute; inset: -200px;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='280' height='280'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.92' numOctaves='3' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.85'/></svg>");
    opacity: 0.18;
    mix-blend-mode: ${isDarkBg ? "screen" : "multiply"};
    will-change: transform;
    animation: hf-grain-drift-${id} 24s ease-in-out infinite;
  }
  #${id} .hf-atmo-grain::after {
    content: ""; position: absolute; inset: 0;
    background: radial-gradient(ellipse 90% 75% at center, transparent 55%, ${t.colors.bg} 100%);
    opacity: 0.55;
  }
  @keyframes hf-grain-drift-${id} {
    0%, 100% { transform: translate3d(0, 0, 0); }
    25%      { transform: translate3d(-30px, -22px, 0); }
    50%      { transform: translate3d(28px, -38px, 0); }
    75%      { transform: translate3d(-22px, 38px, 0); }
  }
</style>
<div class="hf-atmo hf-atmo-grain"></div>`.trim();
  },
};

/**
 * Concentric pulsing rings emanating from the canvas centre. Reads as a
 * single big-number scene that's "transmitting" — perfect under
 * hook-statreveal where the eye should anchor on the number.
 */
const RADIAL_PULSE: AtmospherePreset = {
  id: "radial-pulse",
  description:
    "Concentric ring pulses radiating from centre. Magnetises the eye to the middle of the canvas — best under hook-statreveal or any scene whose hero element sits centred.",
  render(ctx) {
    const id = ctx.sceneId;
    const t = ctx.tokens;
    const isDark = isDarkColor(t.colors.bg);
    const blend = isDark ? "screen" : "multiply";
    return `
<style>
  #${id} .hf-atmo-pulse { position: absolute; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
  #${id} .hf-atmo-pulse::before, #${id} .hf-atmo-pulse::after {
    content: ""; position: absolute; left: 50%; top: 50%; width: 200vmax; height: 200vmax;
    border-radius: 50%; transform: translate(-50%, -50%) scale(0.05);
    border: 2px solid ${t.colors.accent}; opacity: 0;
    mix-blend-mode: ${blend};
    will-change: transform, opacity;
  }
  #${id} .hf-atmo-pulse::before {
    animation: hf-pulse-${id} 5.2s cubic-bezier(0.2, 0.6, 0.2, 1) infinite;
  }
  #${id} .hf-atmo-pulse::after {
    border-color: ${t.colors.accent2};
    animation: hf-pulse-${id} 5.2s cubic-bezier(0.2, 0.6, 0.2, 1) infinite;
    animation-delay: 1.7s;
  }
  @keyframes hf-pulse-${id} {
    0%   { transform: translate(-50%, -50%) scale(0.04); opacity: 0; border-width: 4px; }
    20%  { opacity: 0.85; }
    100% { transform: translate(-50%, -50%) scale(1.0); opacity: 0; border-width: 1px; }
  }
</style>
<div class="hf-atmo hf-atmo-pulse"></div>`.trim();
  },
};

/**
 * Particle field's bigger sibling — fewer, larger, brighter dots that
 * twinkle, plus two slow-drifting "stars" with halos. Cosmic / sci-fi feel
 * for hooks and outros where you want depth without competing with text.
 */
const COSMIC_DUST: AtmospherePreset = {
  id: "cosmic-dust",
  description:
    "Sparse bright dots that twinkle, plus two large halo'd stars drifting slowly. Cosmic depth — best under hooks/outros that need a feeling of scale.",
  render(ctx) {
    const id = ctx.sceneId;
    const t = ctx.tokens;
    const isDark = isDarkColor(t.colors.bg);
    const blend = isDark ? "screen" : "multiply";
    const stars = [
      [60, 90, 4],
      [200, 220, 3],
      [400, 80, 5],
      [520, 280, 3.5],
      [120, 380, 4.5],
      [340, 430, 3],
      [480, 480, 5],
      [200, 540, 3.5],
      [60, 250, 3],
      [380, 320, 4.5],
      [110, 160, 2.5],
      [290, 110, 3],
    ];
    const circles = stars.map(([x, y, r]) => `<circle cx='${x}' cy='${y}' r='${r}'/>`).join("");
    const starSvg =
      `<svg xmlns='http://www.w3.org/2000/svg' width='600' height='600' viewBox='0 0 600 600'><g fill='${t.colors.accent}' fill-opacity='0.85'>${circles}</g></svg>`
        .replace(/#/g, "%23")
        .replace(/"/g, "'");
    return `
<style>
  #${id} .hf-atmo-cosmic { position: absolute; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
  #${id} .hf-atmo-cosmic::before {
    content: ""; position: absolute; inset: -200px;
    background-image: url("data:image/svg+xml;utf8,${starSvg}");
    background-repeat: repeat;
    mix-blend-mode: ${blend};
    will-change: transform, opacity;
    animation: hf-cosmic-drift-${id} 110s linear infinite, hf-cosmic-twinkle-${id} 4.5s ease-in-out infinite;
  }
  #${id} .hf-atmo-cosmic .hf-cosmic-halo {
    position: absolute; width: 420px; height: 420px; border-radius: 50%;
    background: radial-gradient(circle, ${t.colors.accent}66 0%, ${t.colors.accent2}44 35%, transparent 65%);
    filter: blur(40px);
    mix-blend-mode: ${blend};
    will-change: transform, opacity;
  }
  #${id} .hf-atmo-cosmic .hf-cosmic-halo.a { left: 18%; top: 22%; animation: hf-cosmic-halo-a-${id} 24s ease-in-out infinite; }
  #${id} .hf-atmo-cosmic .hf-cosmic-halo.b { right: 14%; bottom: 18%; animation: hf-cosmic-halo-b-${id} 32s ease-in-out infinite; }
  @keyframes hf-cosmic-drift-${id} {
    from { transform: translate3d(0, 0, 0); }
    to   { transform: translate3d(-600px, -600px, 0); }
  }
  @keyframes hf-cosmic-twinkle-${id} {
    0%, 100% { opacity: 0.95; }
    50%      { opacity: 0.55; }
  }
  @keyframes hf-cosmic-halo-a-${id} {
    0%, 100% { transform: translate(0, 0) scale(1);   opacity: 0.9; }
    50%      { transform: translate(60px, 30px) scale(1.18); opacity: 1; }
  }
  @keyframes hf-cosmic-halo-b-${id} {
    0%, 100% { transform: translate(0, 0) scale(1);   opacity: 0.85; }
    50%      { transform: translate(-50px, -40px) scale(1.22); opacity: 1; }
  }
</style>
<div class="hf-atmo hf-atmo-cosmic">
  <div class="hf-cosmic-halo a"></div>
  <div class="hf-cosmic-halo b"></div>
</div>`.trim();
  },
};

/**
 * Animated isometric grid — diagonal accent lines pulsing slowly. Reads
 * as "data infrastructure" — pairs well with chart-scene and comparison
 * when the brand wants a futuristic / engineering aesthetic.
 */
const GEOMETRIC_GRID: AtmospherePreset = {
  id: "geometric-grid",
  description:
    "Diagonal isometric grid lines drifting and pulsing. Engineering/infrastructure aesthetic — pairs with chart-scene, comparison.",
  render(ctx) {
    const id = ctx.sceneId;
    const t = ctx.tokens;
    const isDark = isDarkColor(t.colors.bg);
    const blend = isDark ? "screen" : "multiply";
    return `
<style>
  #${id} .hf-atmo-grid { position: absolute; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
  #${id} .hf-atmo-grid::before {
    content: ""; position: absolute; inset: -25%;
    background-image:
      repeating-linear-gradient( 30deg, transparent 0px, transparent 79px, ${t.colors.accent}55 79px, ${t.colors.accent}55 80px),
      repeating-linear-gradient(-30deg, transparent 0px, transparent 79px, ${t.colors.accent2}48 79px, ${t.colors.accent2}48 80px);
    mix-blend-mode: ${blend};
    opacity: 0.7;
    will-change: transform, opacity;
    animation: hf-grid-drift-${id} 38s linear infinite, hf-grid-pulse-${id} 6s ease-in-out infinite;
  }
  #${id} .hf-atmo-grid::after {
    content: ""; position: absolute; inset: 0;
    background: radial-gradient(ellipse 80% 70% at center, transparent 50%, ${t.colors.bg}cc 100%);
    pointer-events: none;
  }
  @keyframes hf-grid-drift-${id} {
    from { transform: translate3d(0, 0, 0); }
    to   { transform: translate3d(-160px, 92px, 0); }
  }
  @keyframes hf-grid-pulse-${id} {
    0%, 100% { opacity: 0.55; }
    50%      { opacity: 0.95; }
  }
</style>
<div class="hf-atmo hf-atmo-grid"></div>`.trim();
  },
};

/**
 * Horizontal flow lines — wavy SVG paths that slowly translate across the
 * canvas. Audio-waveform vibe; works under quote scenes (the "wavelength
 * of voice") and chart-scene when the data is time-series.
 */
const FLOW_LINES: AtmospherePreset = {
  id: "flow-lines",
  description:
    "Wavy horizontal lines slowly drifting — audio waveform feel. Best under quote scenes and time-series chart-scene.",
  render(ctx) {
    const id = ctx.sceneId;
    const t = ctx.tokens;
    const isDark = isDarkColor(t.colors.bg);
    const blend = isDark ? "screen" : "multiply";
    // Three nested SVG path variants drawn at different offsets and amplitudes.
    const wavePath = (amp: number, baseY: number) => {
      const points: string[] = [];
      for (let x = -100; x <= 1700; x += 80) {
        const y = baseY + Math.sin((x / 200) * Math.PI) * amp;
        points.push(`${x},${y.toFixed(1)}`);
      }
      return `M${points.join(" L")}`;
    };
    const svg =
      `<svg xmlns='http://www.w3.org/2000/svg' width='1600' height='400' viewBox='0 0 1600 400' fill='none'><path d='${wavePath(40, 100)}' stroke='${t.colors.accent}' stroke-width='2' stroke-opacity='0.7'/><path d='${wavePath(60, 200)}' stroke='${t.colors.accent2}' stroke-width='2' stroke-opacity='0.6'/><path d='${wavePath(50, 300)}' stroke='${t.colors.accent3}' stroke-width='2' stroke-opacity='0.55'/></svg>`
        .replace(/#/g, "%23")
        .replace(/"/g, "'");
    return `
<style>
  #${id} .hf-atmo-flow { position: absolute; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
  #${id} .hf-atmo-flow::before, #${id} .hf-atmo-flow::after {
    content: ""; position: absolute; left: -200px; right: -200px;
    background-image: url("data:image/svg+xml;utf8,${svg}");
    background-repeat: repeat;
    background-size: 1600px 400px;
    mix-blend-mode: ${blend};
    will-change: transform;
  }
  #${id} .hf-atmo-flow::before { top: 18%; height: 400px; opacity: 0.7; animation: hf-flow-a-${id} 28s linear infinite; }
  #${id} .hf-atmo-flow::after { bottom: 12%; height: 400px; opacity: 0.55; transform: scaleY(-1); animation: hf-flow-b-${id} 36s linear infinite reverse; }
  @keyframes hf-flow-a-${id} {
    from { transform: translate3d(0, 0, 0); }
    to   { transform: translate3d(-1600px, 0, 0); }
  }
  @keyframes hf-flow-b-${id} {
    from { transform: translate3d(0, 0, 0) scaleY(-1); }
    to   { transform: translate3d(-1600px, 0, 0) scaleY(-1); }
  }
</style>
<div class="hf-atmo hf-atmo-flow"></div>`.trim();
  },
};

/**
 * Cyberlofi atmosphere — scanline overlay + intermittent RGB-shift jitter
 * + faint pixel grid. Built specifically as the visual decay layer for
 * the cyber-* template family. Composes cleanly with `noise-grain` for
 * heavier texture; on its own it's clean enough to sit under
 * `cyber-data-cluster` without fighting the data block.
 */
const GLITCH_DECAY: AtmospherePreset = {
  id: "glitch-decay",
  description:
    "Scanline overlay + faint pixel grid + intermittent chromatic-aberration jitter. " +
    "Cyberlofi / digital-decay aesthetic. Pairs with cyber-* templates and the " +
    "cyberlofi theme; works as a layer in compose().",
  render(ctx) {
    const id = ctx.sceneId;
    const t = ctx.tokens;
    const isDark = isDarkColor(t.colors.bg);
    // On a dark canvas we screen the lines (lighten); on light bg we multiply.
    const blend = isDark ? "screen" : "multiply";
    return `
<style>
  #${id} .hf-atmo-glitch {
    position: absolute; inset: 0; z-index: 0; pointer-events: none; overflow: hidden;
  }
  /* Scanlines — tight 3px stride, very subtle. */
  #${id} .hf-atmo-glitch::before {
    content: ""; position: absolute; inset: 0;
    background-image: repeating-linear-gradient(
      to bottom,
      ${t.colors.fg}10 0,
      ${t.colors.fg}10 1px,
      transparent 1px,
      transparent 3px
    );
    mix-blend-mode: ${blend};
    opacity: 0.6;
    will-change: opacity, transform;
    animation: hf-glitch-jitter-${id} 4.2s steps(7) infinite;
  }
  /* Faint pixel grid — the "we're inside a terminal" anchor. */
  #${id} .hf-atmo-glitch::after {
    content: ""; position: absolute; inset: 0;
    background-image:
      linear-gradient(${t.colors.fg}07 1px, transparent 1px),
      linear-gradient(90deg, ${t.colors.fg}07 1px, transparent 1px);
    background-size: 64px 64px;
    mix-blend-mode: ${blend};
    opacity: 0.6;
  }
  /* RGB-shift highlight — magenta/cyan chromatic edge that pulses. */
  #${id} .hf-atmo-glitch .hf-glitch-rgb {
    position: absolute; inset: 0;
    box-shadow:
      inset 1px 0 0 ${t.colors.accent2}55,
      inset -1px 0 0 ${t.colors.accent}55;
    mix-blend-mode: ${blend};
    opacity: 0;
    will-change: opacity;
    animation: hf-glitch-rgb-${id} 6s ease-in-out infinite;
  }
  @keyframes hf-glitch-jitter-${id} {
    0%, 92% { transform: translate3d(0, 0, 0); opacity: 0.6; }
    93%     { transform: translate3d(-2px, 0, 0); opacity: 0.4; }
    94%     { transform: translate3d(3px, 1px, 0); opacity: 0.85; }
    95%     { transform: translate3d(-1px, -1px, 0); opacity: 0.55; }
    100%    { transform: translate3d(0, 0, 0); opacity: 0.6; }
  }
  @keyframes hf-glitch-rgb-${id} {
    0%, 88% { opacity: 0; }
    90%     { opacity: 0.7; }
    95%     { opacity: 0.4; }
    100%    { opacity: 0; }
  }
</style>
<div class="hf-atmo hf-atmo-glitch">
  <div class="hf-glitch-rgb"></div>
</div>`.trim();
  },
};

export const BUILTIN_ATMOSPHERES: readonly AtmospherePreset[] = [
  STUDIO_FLAT,
  AURORA,
  GRADIENT_MESH,
  PARTICLE_FIELD,
  NOISE_GRAIN,
  RADIAL_PULSE,
  COSMIC_DUST,
  GEOMETRIC_GRID,
  FLOW_LINES,
  GLITCH_DECAY,
];

export const ATMOSPHERE_IDS = BUILTIN_ATMOSPHERES.map((a) => a.id);

export function getAtmosphere(id: string): AtmospherePreset | undefined {
  return BUILTIN_ATMOSPHERES.find((a) => a.id === id);
}

/**
 * Picks the atmosphere a scene gets when the planner doesn't supply one.
 * Tuned to retention impact:
 *   - hooks/quotes/outros → aurora (dramatic, hook-grade motion)
 *   - text-only templates → particle-field (kinetic interest where the
 *     template itself is static)
 *   - chart/comparison → gradient-mesh (subtle, doesn't fight the data)
 */
export function defaultAtmosphereForTemplate(templateId: string): string {
  switch (templateId) {
    case "hook-bigtext":
    case "hook-statreveal":
    case "quote":
    case "outro-cta":
      return "aurora";
    case "aroll-text":
    case "concept-callout":
      return "particle-field";
    case "chart-scene":
    case "comparison":
      return "gradient-mesh";
    case "hook-vhs-rip":
    case "kinetic-words":
      // These templates already paint their own dense visual layer (photo + tint
      // + scanlines + chromatic split). An additional kinetic atmosphere on top
      // muddies the read. Stay flat.
      return "studio-flat";
    case "editorial-serif":
      // Pure-typography breath scene — keep the negative space pristine.
      return "studio-flat";
    case "cyber-data-cluster":
    case "cyber-glitch-word":
    case "cyber-pixel-still":
    case "glitch-bar-chart":
    case "cyber-counter-burst":
    case "data-stream-reveal":
    case "cyber-comparison":
      // Cyberlofi family — pair with the glitch-decay layer so the scanlines
      // + intermittent RGB shift run continuously beneath the scene's content.
      return "glitch-decay";
    default:
      return "noise-grain";
  }
}

export function renderAtmosphere(presetId: string, ctx: AtmosphereContext): string {
  const preset = getAtmosphere(presetId) ?? getAtmosphere("studio-flat");
  if (!preset) return "";
  return preset.render(ctx);
}

function isDarkColor(hex: string): boolean {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  const captured = m?.[1];
  if (!captured) return false;
  const h =
    captured.length === 3
      ? captured
          .split("")
          .map((c) => c + c)
          .join("")
      : captured;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  // Rec.601 luma — lower than 0.45 means dark.
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.45;
}
