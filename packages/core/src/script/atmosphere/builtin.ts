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

export const BUILTIN_ATMOSPHERES: readonly AtmospherePreset[] = [
  STUDIO_FLAT,
  AURORA,
  GRADIENT_MESH,
  PARTICLE_FIELD,
  NOISE_GRAIN,
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
