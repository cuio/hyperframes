import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { BUILTIN_TEMPLATES, DEFAULT_TOKENS, type DesignTokens } from "./templates/index.js";
import type { ImageRef, Template } from "./templates/types.js";
import { defaultAtmosphereForTemplate, renderAtmosphere } from "./atmosphere/index.js";
import { TRANSITION_DURATIONS, defaultTransitionForTemplate } from "./transitions/index.js";
import { getLoadedThemeByName } from "./themes/index.js";
import type { PlannedScene, PlannedScript, SceneTransition } from "./types.js";
import type { ImageEntry, ImageManifest } from "../images/index.js";
import type { VisualDirectionPlan } from "./visualDirector.js";
import { readSfxManifest, resolveSfxStartForScene, type SfxEntry } from "./sfx/manifest.js";
import { readMusicManifest, resolveMusicSpan, type SceneSpan } from "./music/manifest.js";
import { getCoreVersion } from "./coreVersion.js";

/**
 * Stamp constants. Studio-side staleness detection looks for these exact
 * <meta> names — keep them in lockstep with `assembleStaleness.ts`.
 */
export const ASSEMBLED_AT_META = "hyperframes:assembled-at";
export const CORE_VERSION_META = "hyperframes:core-version";

export interface AssembleOptions {
  projectDir: string;
  /** Path relative to projectDir for the master HTML. Default: index.html. */
  outFile?: string;
  /** Override the design tokens (Phase 4 will swap in real designs). */
  tokens?: DesignTokens;
  /** Width × height of the canvas. Default 1920×1080. */
  width?: number;
  height?: number;
  /** Optional custom GSAP CDN URL. */
  gsapUrl?: string;
  /**
   * Full template registry used for scene rendering. Defaults to
   * BUILTIN_TEMPLATES; the studio API passes the union of built-ins +
   * active-theme templates so theme-shipped templates render alongside
   * built-ins. Templates here must include any id the planned script
   * references — unknown ids are silently skipped.
   */
  templates?: readonly Template[];
  /**
   * Optional images manifest. When supplied alongside a directionPlan,
   * the assembler resolves each scene's directorial imageId, builds an
   * ImageRef, and passes it as ctx.image to the template. Scenes whose
   * planned template is image-scene also pull their imageId from props.
   */
  imagesManifest?: ImageManifest;
  /**
   * Per-scene visual direction (image + treatment) emitted by
   * planVisualDirection. When present, scenes with imageId+treatment are
   * routed through the `image-scene` template even if the original
   * planner picked a different template — the director gets the final
   * say on visual presentation while the planner still decides scene
   * text and structural placement. Scenes with imageId: null fall
   * through to the planner's original template.
   */
  directionPlan?: VisualDirectionPlan;
}

export interface AssembleResult {
  outFile: string;
  totalDurationSeconds: number;
  sceneCount: number;
}

const DEFAULT_GSAP = "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js";

/**
 * Assemble a master index.html from a planned (audio-resolved) script.
 *
 * The master timeline is built `paused` and is *not* auto-played — the
 * hyperframes runtime / studio player drives playback and scrubbing via
 * `window.__timelines.main`. Per-scene sub-timelines are embedded with
 * `master.add(sceneTl, start)` so they scrub correctly in both directions.
 * Audio elements are kept in sync via the master's onUpdate callback so
 * forward, backward, and seek all play the right slice.
 */
export function assembleMaster(planned: PlannedScript, opts: AssembleOptions): AssembleResult {
  const tokens = opts.tokens ?? DEFAULT_TOKENS;
  const width = opts.width ?? 1920;
  const height = opts.height ?? 1080;
  const outFile = opts.outFile ?? "index.html";
  const absOut = join(opts.projectDir, outFile);

  let cursor = 0;
  const sceneFragments: string[] = [];
  const audioTags: string[] = [];

  // SFX manifest: read once, group entries by sceneId so each scene's loop
  // iteration can emit them at the right cursor position. The manifest is
  // optional — projects without it just skip the SFX lane.
  const sfxManifest = readSfxManifest(opts.projectDir);
  const sfxBySceneId = new Map<string, SfxEntry[]>();
  for (const entry of sfxManifest.entries) {
    const list = sfxBySceneId.get(entry.sceneId) ?? [];
    list.push(entry);
    sfxBySceneId.set(entry.sceneId, list);
  }

  // Music manifest: read here, emit AFTER the scene loop so we know each
  // scene's absolute cursor position. Music tracks span multiple scenes so
  // they need the full scene-span table to compute start + declared duration.
  const musicManifest = readMusicManifest(opts.projectDir);
  const sceneSpansForMusic: SceneSpan[] = [];
  const sceneVisibility: Array<{
    id: string;
    start: number;
    duration: number;
    text: string;
    audioStart: number;
    audioDuration: number;
    transitionIn: SceneTransition;
    transitionInMs: number;
  }> = [];

  const templates = opts.templates ?? BUILTIN_TEMPLATES;
  // Build a quick directionPlan lookup by sceneId.
  const directionByScene = new Map((opts.directionPlan?.scenes ?? []).map((d) => [d.sceneId, d]));
  for (const scene of planned.scenes) {
    const direction = directionByScene.get(scene.id);
    const sceneTotal = sceneTotalDuration(scene);
    const audioStartOffset = scene.audio?.leadInSeconds ?? 0;
    const audioDur = scene.audio?.durationSeconds ?? 0;

    // Per-scene theme override: if scene.props.theme names a registered
    // theme, use ITS tokens for this one scene. Lets the planner mix
    // concepts (e.g. a Dreamspace hook in a HackerNoon-themed video) by
    // setting one prop, no global config change.
    const requestedSceneTheme =
      typeof scene.props?.theme === "string" ? scene.props.theme : undefined;
    const sceneTokens = requestedSceneTheme
      ? (getLoadedThemeByName(requestedSceneTheme)?.tokens ?? tokens)
      : tokens;

    // Decide which template + props to render. Three paths:
    //   1. Director assigned an imageId+treatment → route through image-scene
    //      with director-derived props (headline = first sentence of scene text,
    //      eyebrow = original eyebrow, etc.).
    //   2. Planner already picked image-scene and props.imageId is set → resolve
    //      the image from the manifest and pass it through as-is.
    //   3. Default: planner's chosen template + props with no image context.
    let renderTemplateId = scene.template;
    let renderProps: Record<string, unknown> = scene.props;
    let resolvedImage: ImageRef | undefined;

    if (direction && direction.imageId && direction.treatment && opts.imagesManifest) {
      // Director picked an image-scene treatment — fully override the planner's
      // template choice and route through image-scene with director-derived props.
      const entry = opts.imagesManifest.images.find((i) => i.id === direction.imageId);
      if (entry) {
        renderTemplateId = "image-scene";
        renderProps = directorPropsFor(scene, direction.treatment);
        resolvedImage = toImageRef(entry, direction.focalOverride);
      }
    } else if (direction && direction.imageId && !direction.treatment && opts.imagesManifest) {
      // Director assigned an image but left the planner's template in place. This
      // is the path for self-imaging templates like hook-vhs-rip and kinetic-words
      // that paint their own photo treatment — we just resolve ctx.image so the
      // template can render the photo, no template override.
      const entry = opts.imagesManifest.images.find((i) => i.id === direction.imageId);
      if (entry) {
        resolvedImage = toImageRef(entry, direction.focalOverride);
      }
    } else if (typeof scene.props.imageId === "string" && opts.imagesManifest) {
      // Planner put imageId directly in props (image-scene path or pre-director
      // imageId persistence). Resolve and pass through ctx.image.
      const entry = opts.imagesManifest.images.find((i) => i.id === scene.props.imageId);
      if (entry) {
        resolvedImage = toImageRef(entry);
      }
    }

    const tpl = templates.find((t) => t.id === renderTemplateId);
    if (!tpl) continue;

    const fragment = tpl.render(renderProps, {
      sceneId: scene.id,
      audioSrc: scene.audio?.path,
      durationSeconds: sceneTotal,
      isHook: scene.hook === true,
      tokens: sceneTokens,
      ...(resolvedImage ? { image: resolvedImage } : {}),
    });
    const positioned = fragment.replace(`data-start="0"`, `data-start="${cursor.toFixed(2)}"`);
    // Inject the per-scene atmosphere as the first child of the scene div.
    // The planner can override the default by setting props.background to one
    // of the registered preset ids (aurora, gradient-mesh, particle-field,
    // noise-grain, studio-flat).
    const requestedAtmo =
      typeof scene.props?.background === "string" ? scene.props.background : undefined;
    const atmoId = requestedAtmo ?? defaultAtmosphereForTemplate(scene.template);
    const atmoHtml = renderAtmosphere(atmoId, {
      sceneId: scene.id,
      tokens: sceneTokens,
      isHook: scene.hook === true,
    });
    const withAtmo = atmoHtml
      ? positioned.replace(/(<div class="scene[^>]*>)/, `$1\n  ${atmoHtml}`)
      : positioned;
    sceneFragments.push(withAtmo);

    if (scene.audio) {
      // Audio starts AFTER the lead-in, so the visual lands first. Audio
      // lasts only its actual duration — never bleeds into next scene.
      // data-track-index="1" + data-timeline-group="voiceover" merges every
      // scene's voiceover onto a single Premiere-style "Voiceover" lane.
      const audioStart = cursor + audioStartOffset;
      audioTags.push(
        `  <audio id="hf-vo-${scene.id}" src="${escapeAttr(scene.audio.path)}" data-start="${audioStart.toFixed(2)}" data-duration="${audioDur.toFixed(2)}" data-track-index="1" data-timeline-group="voiceover" data-timeline-label="Voiceover" preload="auto"></audio>`,
      );
    }

    // SFX entries land on track 3 with the same audio timing rules as the
    // voiceover. Each entry's start time is computed from its anchor (scene-
    // start / accent-word / scene-end) — see resolveSfxStartForScene for
    // the math. Volume scales the runtime mixer when supplied; the producer
    // package consumes data-volume-db at render time.
    const sceneSfx = sfxBySceneId.get(scene.id) ?? [];
    for (const entry of sceneSfx) {
      const start = resolveSfxStartForScene(entry, scene, cursor, sceneTotal);
      const volumeAttr =
        typeof entry.volumeDb === "number" ? ` data-volume-db="${entry.volumeDb.toFixed(1)}"` : "";
      const labelAttr = entry.label ? ` data-timeline-label="${escapeAttr(entry.label)}"` : "";
      audioTags.push(
        `  <audio id="hf-sfx-${scene.id}-${entry.id}" src="${escapeAttr(entry.path)}" data-start="${start.toFixed(2)}" data-duration="${entry.durationSeconds.toFixed(2)}" data-track-index="3" data-timeline-group="sfx"${labelAttr}${volumeAttr} preload="auto"></audio>`,
      );
    }
    const transitionIn: SceneTransition =
      scene.transition ?? defaultTransitionForTemplate(scene.template);
    const transitionInMs = (TRANSITION_DURATIONS[transitionIn] ?? 0) * 1000;
    sceneVisibility.push({
      id: scene.id,
      start: cursor,
      duration: sceneTotal,
      text: scene.text,
      audioStart: cursor + audioStartOffset,
      audioDuration: audioDur,
      transitionIn,
      transitionInMs,
    });
    sceneSpansForMusic.push({ id: scene.id, start: cursor, duration: sceneTotal });
    cursor += sceneTotal;
  }

  const total = cursor;

  // Music tracks land on track 2. Each track's window comes from
  // resolveMusicSpan (start = first covered scene, duration = audio length
  // capped to covered span). Volume + duck attributes go to the producer's
  // audio mixer at render time.
  for (const entry of musicManifest.entries) {
    const span = resolveMusicSpan(entry, sceneSpansForMusic, total);
    if (span.declaredDuration <= 0) continue;
    const labelAttr = entry.label ? ` data-timeline-label="${escapeAttr(entry.label)}"` : "";
    const volumeAttr =
      typeof entry.volumeDb === "number" ? ` data-volume-db="${entry.volumeDb.toFixed(1)}"` : "";
    const duckAttr =
      typeof entry.duckDb === "number" ? ` data-music-duck-db="${entry.duckDb.toFixed(1)}"` : "";
    audioTags.push(
      `  <audio id="hf-music-${entry.id}" src="${escapeAttr(entry.path)}" data-start="${span.start.toFixed(2)}" data-duration="${span.declaredDuration.toFixed(2)}" data-track-index="2" data-timeline-group="music"${labelAttr}${volumeAttr}${duckAttr} preload="auto"></audio>`,
    );
  }
  const title = planned.meta.title ? escapeText(planned.meta.title) : "HyperFrames Video";

  // The hyperframes runtime composes its own master from elements with
  // [data-composition-id] + window.__timelines[sceneId] + audio[data-start].
  // We do not write our own master timeline JS — the runtime + studio player
  // drive playback, scrubbing, and audio sync. Per-scene timelines are
  // registered by each template's inline <script>.
  // Staleness stamp: assembled-at + the @hyperframes/core version that
  // produced the HTML. Studio reads these with a tiny meta-tag scan to
  // know whether index.html predates a new feature/bug-fix and surfaces a
  // "Regenerate" CTA. Strings only — never trust them on the consumer
  // side, but they are sufficient to flag drift accurately.
  const assembledAtIso = new Date().toISOString();
  const coreVersion = getCoreVersion();

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <meta name="${ASSEMBLED_AT_META}" content="${assembledAtIso}" />
    <meta name="${CORE_VERSION_META}" content="${escapeAttr(coreVersion)}" />
    <title>${title}</title>
    <script src="${opts.gsapUrl ?? DEFAULT_GSAP}"></script>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Space+Grotesk:wght@300;400;500;600;700&family=JetBrains+Mono:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body {
        width: 100vw;
        height: 100vh;
        overflow: hidden;
        background: ${tokens.colors.bg};
        color: ${tokens.colors.fg};
        font-family: ${tokens.fonts.body};
        display: flex;
        align-items: center;
        justify-content: center;
      }
      /* The stage keeps its native pixel size (so per-scene layouts stay
         pixel-perfect for the renderer). When the viewport is smaller than
         the canvas — preview embeds, narrow browser windows — CSS transform
         scales the rendered output to fit while preserving layout. The
         producer launches Puppeteer at viewport === canvas so scale is
         exactly 1 during real renders and this is a no-op there. */
      .hf-stage {
        position: relative;
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
        flex-shrink: 0;
        transform-origin: center center;
        /* Both operands must be lengths so calc() yields a unitless number;
           scale() rejects raw lengths. length / length = number. */
        transform: scale(min(calc(100vw / ${width}px), calc(100vh / ${height}px)));
      }
      .scene {
        position: absolute;
        inset: 0;
        width: ${width}px;
        height: ${height}px;
        opacity: 0;
        pointer-events: none;
      }

      /* ── Ambient atmosphere layer (always behind every scene) ───────── */
      .hf-atmosphere {
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 0;
        overflow: hidden;
      }
      .hf-atmosphere::before {
        /* Subtle film-grain texture via tiny SVG noise */
        content: "";
        position: absolute;
        inset: -100px;
        opacity: 0.04;
        background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.65'/></svg>");
        mix-blend-mode: ${tokens.colors.bg === "#F2E8D5" ? "multiply" : "screen"};
      }
      .hf-glow-orb {
        position: absolute;
        width: 1400px;
        height: 1400px;
        border-radius: 50%;
        filter: blur(140px);
        opacity: 0.45;
        will-change: transform, opacity;
      }
      .hf-glow-orb.a {
        background: radial-gradient(circle, ${tokens.colors.accent}55 0%, transparent 60%);
        top: -300px;
        left: -200px;
      }
      .hf-glow-orb.b {
        background: radial-gradient(circle, ${tokens.colors.accent2}44 0%, transparent 60%);
        bottom: -300px;
        right: -200px;
      }
      .hf-grid-bg {
        position: absolute;
        inset: 0;
        background-image:
          linear-gradient(${tokens.colors.subtle}1a 1px, transparent 1px),
          linear-gradient(90deg, ${tokens.colors.subtle}1a 1px, transparent 1px);
        background-size: 80px 80px;
        opacity: 0.5;
      }

      /* ── Side decorations (always visible, persistent overlay) ─────── */
      .hf-deco {
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 50;
        font-family: ${tokens.fonts.mono};
        color: ${tokens.colors.muted};
      }
      .hf-deco .hf-rail {
        position: absolute;
        background: ${tokens.colors.accent};
        opacity: 0.85;
      }
      .hf-deco .hf-rail.top { top: 0; left: 0; height: 6px; width: 0; }
      .hf-deco .hf-rail.left { top: 0; left: 0; width: 4px; height: 0; }
      .hf-deco .hf-corner {
        position: absolute;
        font-size: 18px;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        opacity: 0;
      }
      .hf-deco .hf-corner.tl { top: 36px; left: 36px; }
      .hf-deco .hf-corner.tr { top: 36px; right: 36px; text-align: right; }
      .hf-deco .hf-corner.bl { bottom: 36px; left: 36px; }
      .hf-deco .hf-corner.br { bottom: 36px; right: 36px; text-align: right; }
      .hf-deco .hf-corner .hf-tick { color: ${tokens.colors.accent}; font-weight: 700; }
      .hf-deco .hf-ticks {
        position: absolute;
        right: 36px;
        top: 50%;
        transform: translateY(-50%);
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .hf-deco .hf-tick-mark {
        width: 18px;
        height: 1.5px;
        background: ${tokens.colors.subtle};
        opacity: 0.6;
      }
      .hf-deco .hf-tick-mark.active {
        background: ${tokens.colors.accent};
        opacity: 1;
        width: 28px;
      }

      /* ── Captions: persistent track at bottom showing the active scene's
         narration. Synced via forceSync(). Fades in/out per scene. ─────── */
      .hf-captions {
        position: absolute;
        left: 50%;
        bottom: 110px;
        transform: translateX(-50%);
        max-width: ${Math.min(width - 320, 1500)}px;
        text-align: center;
        z-index: 60;
        pointer-events: none;
      }
      .hf-captions .hf-cap-bubble {
        display: inline-block;
        padding: 18px 32px;
        background: ${tokens.colors.bg === "#F2E8D5" ? "rgba(26,26,26,0.86)" : "rgba(0,0,0,0.55)"};
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        border-radius: 14px;
        border: 1px solid ${
          tokens.colors.bg === "#F2E8D5" ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.10)"
        };
        font-family: ${tokens.fonts.body};
        font-size: 30px;
        font-weight: 500;
        line-height: 1.32;
        letter-spacing: -0.005em;
        color: ${tokens.colors.bg === "#F2E8D5" ? "#FAFAFA" : tokens.colors.fg};
        opacity: 0;
        transition: opacity 0.2s ease;
        max-height: 200px;
        overflow: hidden;
      }
      .hf-captions.visible .hf-cap-bubble { opacity: 1; }
      .hf-captions.hidden { display: none !important; }
      .hf-captions .hf-cap-text { display: block; }
    </style>
  </head>
  <body>
    <div class="hf-stage" id="hf-root" data-composition-id="hf-root" data-root="true" data-start="0" data-duration="${total.toFixed(2)}" data-width="${width}" data-height="${height}">
      <!-- Persistent atmosphere layer behind every scene -->
      <div class="hf-atmosphere" aria-hidden="true">
        <div class="hf-grid-bg"></div>
        <div class="hf-glow-orb a" id="hf-orb-a"></div>
        <div class="hf-glow-orb b" id="hf-orb-b"></div>
      </div>
${sceneFragments.join("\n")}
${audioTags.join("\n")}
      <!-- Timeline lane placeholders: empty Music + SFX rows so the studio
           timeline always shows Premiere-style lanes, ready to receive
           authored audio without rebuilding the layout. The runtime picks
           these up via data-timeline-role="persistent-overlay". -->
      <div id="hf-track-music" data-track-index="2" data-timeline-role="persistent-overlay" data-timeline-group="music" data-timeline-label="Music" data-start="0" data-duration="${total.toFixed(2)}" aria-hidden="true" style="position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none;"></div>
      <div id="hf-track-sfx" data-track-index="3" data-timeline-role="persistent-overlay" data-timeline-group="sfx" data-timeline-label="SFX" data-start="0" data-duration="${total.toFixed(2)}" aria-hidden="true" style="position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none;"></div>
      <!-- Captions track: shown for the active scene only -->
      <div class="hf-captions" id="hf-captions" aria-live="polite">
        <div class="hf-cap-bubble"><span class="hf-cap-text" id="hf-cap-text"></span></div>
      </div>

      <!-- Persistent corner decorations + side ticks -->
      <div class="hf-deco" aria-hidden="true">
        <div class="hf-rail top" id="hf-rail-top"></div>
        <div class="hf-rail left" id="hf-rail-left"></div>
        <div class="hf-corner tl" id="hf-corner-tl">${escapeText(title)}</div>
        <div class="hf-corner tr" id="hf-corner-tr"><span class="hf-tick" id="hf-scene-id">s01</span> · <span id="hf-time-code">0:00</span></div>
        <div class="hf-corner bl" id="hf-corner-bl"><span id="hf-frame-counter">0001</span></div>
        <div class="hf-corner br" id="hf-corner-br"><span class="hf-tick">●</span> REC</div>
        <div class="hf-ticks" id="hf-ticks">
${planned.scenes.map((_, i) => `          <div class="hf-tick-mark" data-scene-index="${i}"></div>`).join("\n")}
        </div>
      </div>
    </div>
    <script>
      // Root timeline drives master duration AND scene visibility. The
      // hyperframes runtime composes each child scene's __timelines[sceneId]
      // onto this root at its data-start position. We add visibility tweens
      // here so only the active scene is shown — scrubbable in both directions
      // via fromTo/to with duration 0 + immediateRender:false.
      (function(){
        if (!window.gsap) return;
        var SCENES = ${JSON.stringify(sceneVisibility)};
        var TOTAL = ${total.toFixed(2)};
        var root = window.gsap.timeline({ paused: true });
        // Spacer establishes the master duration.
        root.to({}, { duration: TOTAL }, 0);

        // ── Atmosphere: orbs drift slowly across the full duration so the
        // background always feels alive. Repeat counts are FINITE — the
        // hyperframes capture engine seeks to exact frame times and would
        // hang on infinite tweens. Each orb gets enough yoyo cycles to
        // cover the whole composition.
        var orbA = document.getElementById('hf-orb-a');
        var orbB = document.getElementById('hf-orb-b');
        var cycleA = Math.max(20, TOTAL / 4);
        var cycleB = Math.max(24, TOTAL / 4);
        if (orbA) {
          window.gsap.to(orbA, {
            x: 600, y: 200, duration: cycleA,
            yoyo: true,
            repeat: Math.max(1, Math.ceil(TOTAL / cycleA) - 1),
            ease: 'sine.inOut',
          });
        }
        if (orbB) {
          window.gsap.to(orbB, {
            x: -500, y: -250, duration: cycleB,
            yoyo: true,
            repeat: Math.max(1, Math.ceil(TOTAL / cycleB) - 1),
            ease: 'sine.inOut', delay: 1.2,
          });
        }
        // Persistent decorations: rails draw in once at start.
        window.gsap.to('#hf-rail-top', { width: '100%', duration: 1.2, ease: 'expo.out', delay: 0.2 });
        window.gsap.to('#hf-rail-left', { height: '100%', duration: 1.4, ease: 'expo.out', delay: 0.35 });
        window.gsap.to('.hf-corner', { opacity: 0.9, duration: 0.5, ease: 'power3.out', stagger: 0.08, delay: 0.6 });

        // Cross-frame caption visibility toggle. Two delivery paths:
        //   1. BroadcastChannel('hf-captions') — preferred; reaches every
        //      same-origin window without the host needing to enumerate iframes.
        //   2. window.postMessage({ source: 'hf-host', type: 'captions', ... })
        //      — back-compat path for hosts that don't broadcast.
        // localStorage acts as the persistence layer so a freshly-mounted
        // iframe picks up the latest state without any message at all.
        // URL hash captions=off forces hidden regardless of stored state.
        function applyCaptionVisibility(visible) {
          var cap = document.getElementById('hf-captions');
          if (!cap) return;
          if (visible) cap.classList.remove('hidden');
          else cap.classList.add('hidden');
        }
        function persistCaptionVisibility(visible) {
          try { localStorage.setItem('hf-captions-visible', visible ? '1' : '0'); } catch (e) {}
        }
        if (window.location.hash.indexOf('captions=off') !== -1) applyCaptionVisibility(false);
        try {
          var stored = localStorage.getItem('hf-captions-visible');
          if (stored === '0') applyCaptionVisibility(false);
        } catch (e) {}
        window.addEventListener('message', function(ev) {
          var d = ev.data;
          if (!d || d.source !== 'hf-host' || d.type !== 'captions') return;
          var visible = d.visible !== false;
          applyCaptionVisibility(visible);
          persistCaptionVisibility(visible);
        });
        try {
          var capCh = new BroadcastChannel('hf-captions');
          capCh.onmessage = function(ev) {
            var d = ev.data;
            if (!d || d.type !== 'captions' || typeof d.visible !== 'boolean') return;
            applyCaptionVisibility(d.visible);
            persistCaptionVisibility(d.visible);
          };
        } catch (e) {}

        // Imperative visibility, polled on every frame via gsap.ticker.
        // We avoid the timeline's onUpdate because the studio runtime can
        // re-wire eventCallbacks when it adopts our root timeline. The
        // ticker runs unconditionally each frame regardless of who owns play.
        var current = null;
        function syncScenes(t) {
          var active = null;
          for (var i = 0; i < SCENES.length; i++) {
            var s = SCENES[i];
            if (t >= s.start && t < s.start + s.duration) { active = s.id; break; }
          }
          if (active === current) return;
          current = active;
          for (var j = 0; j < SCENES.length; j++) {
            var sj = SCENES[j];
            var el = document.getElementById(sj.id);
            if (!el) continue;
            if (sj.id === active) {
              el.style.opacity = "1";
              el.style.visibility = "visible";
            } else {
              el.style.opacity = "0";
              el.style.visibility = "hidden";
            }
          }
        }
        // The runtime sets its own visibility on scrub/seek. We must keep
        // re-asserting ours every frame, otherwise paused-scrub or runtime
        // composition adapters can wipe scene visibility back to hidden.
        // syncScenes() is no-op when active scene is unchanged AND already
        // applied, so this is cheap. We force-apply even when "current" is
        // unchanged because external code may have flipped style.visibility.
        // Apply transition state to one scene element. Called per-frame for
        // every scene. role is hidden/active/entering/exiting; p is the
        // entrance progress 0-1 of the active scene transition. Drives
        // opacity + transform + clipPath only - pure CSS, no GSAP, so it
        // cannot fight the runtime ticker.
        function applyTransition(el, role, type, p) {
          if (role === "hidden") {
            if (el.style.opacity !== "0") el.style.opacity = "0";
            if (el.style.transform) el.style.transform = "";
            if (el.style.clipPath) el.style.clipPath = "";
            if (el.style.visibility === "hidden") el.style.visibility = "";
            return;
          }
          if (role === "active") {
            if (el.style.opacity !== "1") el.style.opacity = "1";
            if (el.style.transform) el.style.transform = "";
            if (el.style.clipPath) el.style.clipPath = "";
            if (el.style.visibility === "hidden") el.style.visibility = "";
            return;
          }
          // entering or exiting — apply per type
          var entering = role === "entering";
          var op = "1", tr = "", cp = "";
          switch (type) {
            case "cut":
              op = entering ? "1" : "0";
              break;
            case "fade":
              op = entering ? String(p) : String(1 - p);
              break;
            case "wipe-left":
              cp = entering
                ? "inset(0 " + ((1 - p) * 100).toFixed(2) + "% 0 0)"
                : "inset(0 0 0 " + (p * 100).toFixed(2) + "%)";
              break;
            case "wipe-right":
              cp = entering
                ? "inset(0 0 0 " + ((1 - p) * 100).toFixed(2) + "%)"
                : "inset(0 " + (p * 100).toFixed(2) + "% 0 0)";
              break;
            case "zoom-in":
              op = entering ? String(p) : String(1 - p);
              tr = entering
                ? "scale(" + (0.92 + 0.08 * p).toFixed(3) + ")"
                : "scale(" + (1 + 0.08 * p).toFixed(3) + ")";
              break;
            case "zoom-out":
              op = entering ? String(p) : String(1 - p);
              tr = entering
                ? "scale(" + (1.12 - 0.12 * p).toFixed(3) + ")"
                : "scale(" + (1 - 0.08 * p).toFixed(3) + ")";
              break;
            case "whip-pan":
              op = entering ? String(Math.min(1, p * 1.4)) : String(1 - p);
              tr = entering
                ? "translateX(" + ((1 - p) * 220).toFixed(1) + "px)"
                : "translateX(" + (-p * 220).toFixed(1) + "px)";
              break;
            default:
              op = entering ? "1" : "0";
          }
          if (el.style.opacity !== op) el.style.opacity = op;
          if (el.style.transform !== tr) el.style.transform = tr;
          if (el.style.clipPath !== cp) el.style.clipPath = cp;
          if (el.style.visibility === "hidden") el.style.visibility = "";
        }

        function forceSync(t) {
          var activeIdx = -1;
          for (var i = 0; i < SCENES.length; i++) {
            var s = SCENES[i];
            if (t >= s.start && t < s.start + s.duration) { activeIdx = i; break; }
          }
          var active = activeIdx >= 0 ? SCENES[activeIdx].id : null;
          // Compute entrance progress + transition type for the active scene.
          // The entrance window is the first transitionInMs of the scene; the
          // previous scene cross-exits during the same window so audio and
          // visuals stay locked to the scene boundary.
          var transType = "cut";
          var transP = 1;
          if (activeIdx >= 0) {
            var sa = SCENES[activeIdx];
            transType = sa.transitionIn || "cut";
            if (sa.transitionInMs > 0) {
              var elapsed = (t - sa.start) * 1000;
              transP = Math.max(0, Math.min(1, elapsed / sa.transitionInMs));
            }
          }
          for (var j = 0; j < SCENES.length; j++) {
            var sj = SCENES[j];
            var el = document.getElementById(sj.id);
            if (!el) continue;
            var role;
            if (j === activeIdx) role = transP < 1 ? "entering" : "active";
            else if (j === activeIdx - 1 && transP < 1) role = "exiting";
            else role = "hidden";
            applyTransition(el, role, transType, transP);
          }
          // Persistent corner overlays: time code, scene id, active tick.
          var tc = document.getElementById('hf-time-code');
          if (tc) {
            var mins = Math.floor(t / 60);
            var secs = Math.floor(t % 60);
            tc.textContent = mins + ':' + (secs < 10 ? '0' : '') + secs;
          }
          var sid = document.getElementById('hf-scene-id');
          if (sid && active) sid.textContent = active;
          var fc = document.getElementById('hf-frame-counter');
          if (fc) {
            var frame = Math.floor(t * 30);
            fc.textContent = ('0000' + frame).slice(-4);
          }
          var ticks = document.querySelectorAll('.hf-tick-mark');
          for (var k = 0; k < ticks.length; k++) {
            var isActive = parseInt(ticks[k].getAttribute('data-scene-index'), 10) === activeIdx;
            if (isActive && !ticks[k].classList.contains('active')) ticks[k].classList.add('active');
            else if (!isActive && ticks[k].classList.contains('active')) ticks[k].classList.remove('active');
          }
          // Captions: visible only during the active scene's audio window.
          // The bubble text always reflects the active scene's narration so
          // scrubbing reveals what's being said at any frame.
          var capWrap = document.getElementById('hf-captions');
          var capText = document.getElementById('hf-cap-text');
          if (capWrap && capText) {
            if (activeIdx >= 0) {
              var s = SCENES[activeIdx];
              if (s.text && capText.textContent !== s.text) capText.textContent = s.text;
              var inAudio = s.audioDuration > 0 && t >= s.audioStart - 0.05 && t <= s.audioStart + s.audioDuration + 0.1;
              var shouldShow = !!s.text && (inAudio || s.audioDuration === 0);
              if (shouldShow && !capWrap.classList.contains('visible')) capWrap.classList.add('visible');
              else if (!shouldShow && capWrap.classList.contains('visible')) capWrap.classList.remove('visible');
            } else if (capWrap.classList.contains('visible')) {
              capWrap.classList.remove('visible');
            }
          }
        }
        // Drive caption + scene-visibility sync via GSAP's ticker — see
        // packages/core/src/script/assemble.ts source comments for why.
        // tldr: avoids the producer's screenshot-mode fallback (~5x
        // render speedup) and stays virtual-time-aware during render.
        gsap.ticker.add(function(){ forceSync(root.time()); });
        // setInterval keeps a fallback heartbeat (still throttled in
        // background tabs, but to ~1 Hz, which is enough to repaint).
        setInterval(function(){ forceSync(root.time()); }, 100);
        // MutationObserver reverses any external style.visibility=hidden the
        // moment it lands, before paint.
        if (typeof MutationObserver !== "undefined") {
          var observer = new MutationObserver(function(){ forceSync(root.time()); });
          for (var k = 0; k < SCENES.length; k++) {
            var observed = document.getElementById(SCENES[k].id);
            if (observed) observer.observe(observed, { attributes: true, attributeFilter: ["style"] });
          }
        }

        // Patch the player's seek so paused scrubs apply immediately (rAF
        // can be throttled in background iframes).
        function attachPlayer() {
          var p = window.__player;
          if (!p || !p.seek) return false;
          var origSeek = p.seek.bind(p);
          p.seek = function(t){ var r = origSeek(t); forceSync(root.time()); return r; };
          return true;
        }
        if (!attachPlayer()) {
          var attempts = 0;
          var iv = setInterval(function(){
            attempts++;
            if (attachPlayer() || attempts > 40) clearInterval(iv);
          }, 50);
        }
        // First-frame fallback so the opener is painted before anything else.
        forceSync(0);

        window.__timelines = window.__timelines || {};
        window.__timelines['hf-root'] = root;
      })();
    </script>
  </body>
</html>
`;

  mkdirSync(dirname(absOut), { recursive: true });
  writeFileSync(absOut, html);
  return { outFile, totalDurationSeconds: total, sceneCount: planned.scenes.length };
}

function sceneTotalDuration(scene: PlannedScene): number {
  if (typeof scene.totalDurationSeconds === "number" && scene.totalDurationSeconds > 0) {
    return scene.totalDurationSeconds;
  }
  if (scene.audio?.durationSeconds && scene.audio.durationSeconds > 0) {
    return (
      scene.audio.durationSeconds +
      (scene.audio.leadInSeconds ?? 0) +
      (scene.audio.tailPadSeconds ?? 0)
    );
  }
  if (typeof scene.durationHint === "number" && scene.durationHint > 0) return scene.durationHint;
  return 3;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function escapeText(value: string): string {
  return value.replace(/[<>&]/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * When the visual director chose an image+treatment but the scene's
 * original template was something else (chart-scene / aroll-text / ...),
 * we route the scene through image-scene with props derived from the
 * planner's text. The first sentence of the narration becomes the
 * headline; remaining text becomes the subhead. Original eyebrow / title
 * are preserved when they exist.
 */
function directorPropsFor(scene: PlannedScene, treatment: string): Record<string, unknown> {
  const props = scene.props ?? {};
  const originalEyebrow = typeof props.eyebrow === "string" ? props.eyebrow : undefined;
  const originalTitle = typeof props.title === "string" ? props.title : undefined;
  const originalSubtext = typeof props.subtext === "string" ? props.subtext : undefined;
  const accentBlock = typeof props.accentBlock === "string" ? props.accentBlock : undefined;
  const accentWord = typeof props.accentWord === "string" ? props.accentWord : undefined;

  // Split scene text into first sentence + rest. Treat any of `.`, `!`, `?`
  // as a terminator. If the planner already gave us a title, prefer that.
  const text = (scene.text ?? "").trim();
  let headline = originalTitle;
  let subhead = originalSubtext;
  if (!headline) {
    const match = text.match(/^([^.!?]+[.!?])\s*(.*)$/s);
    if (match) {
      headline = match[1]?.trim();
      if (!subhead) subhead = match[2]?.trim() || undefined;
    } else {
      headline = text || "Untitled";
    }
  } else if (!subhead) {
    subhead = text || undefined;
  }

  return {
    imageId: undefined, // assembler injects via ctx.image, not props
    treatment,
    headline,
    ...(subhead ? { subhead } : {}),
    ...(originalEyebrow ? { eyebrow: originalEyebrow } : {}),
    ...(accentBlock ? { accentBlock } : {}),
    ...(accentWord ? { accentWord } : {}),
  };
}

/** Convert an ImageEntry to the leaner ImageRef the templates consume. */
function toImageRef(entry: ImageEntry, focalOverride?: { x: number; y: number }): ImageRef {
  return {
    id: entry.id,
    src: entry.src,
    width: entry.width,
    height: entry.height,
    aspect: entry.aspect,
    dominantColor: entry.dominantColor,
    palette: entry.palette,
    description: entry.description,
    focalPoint: focalOverride ?? entry.focalPoint,
    role: entry.role,
  };
}
