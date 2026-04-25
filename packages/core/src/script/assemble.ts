import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { BUILTIN_TEMPLATES, DEFAULT_TOKENS, type DesignTokens } from "./templates/index.js";
import type { PlannedScene, PlannedScript } from "./types.js";

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
  const sceneVisibility: Array<{
    id: string;
    start: number;
    duration: number;
    text: string;
    audioStart: number;
    audioDuration: number;
  }> = [];

  for (const scene of planned.scenes) {
    const tpl = BUILTIN_TEMPLATES.find((t) => t.id === scene.template);
    if (!tpl) continue;
    const sceneTotal = sceneTotalDuration(scene);
    const audioStartOffset = scene.audio?.leadInSeconds ?? 0;
    const audioDur = scene.audio?.durationSeconds ?? 0;

    const fragment = tpl.render(scene.props, {
      sceneId: scene.id,
      audioSrc: scene.audio?.path,
      durationSeconds: sceneTotal,
      isHook: scene.hook === true,
      tokens,
    });
    const positioned = fragment.replace(`data-start="0"`, `data-start="${cursor.toFixed(2)}"`);
    sceneFragments.push(positioned);

    if (scene.audio) {
      // Audio starts AFTER the lead-in, so the visual lands first. Audio
      // lasts only its actual duration — never bleeds into next scene.
      const audioStart = cursor + audioStartOffset;
      audioTags.push(
        `  <audio src="${escapeAttr(scene.audio.path)}" data-start="${audioStart.toFixed(2)}" data-duration="${audioDur.toFixed(2)}" data-track-index="1" preload="auto"></audio>`,
      );
    }
    sceneVisibility.push({
      id: scene.id,
      start: cursor,
      duration: sceneTotal,
      text: scene.text,
      audioStart: cursor + audioStartOffset,
      audioDuration: audioDur,
    });
    cursor += sceneTotal;
  }

  const total = cursor;
  const title = planned.meta.title ? escapeText(planned.meta.title) : "HyperFrames Video";

  // The hyperframes runtime composes its own master from elements with
  // [data-composition-id] + window.__timelines[sceneId] + audio[data-start].
  // We do not write our own master timeline JS — the runtime + studio player
  // drive playback, scrubbing, and audio sync. Per-scene timelines are
  // registered by each template's inline <script>.
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <title>${title}</title>
    <script src="${opts.gsapUrl ?? DEFAULT_GSAP}"></script>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
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
    <div class="hf-stage" id="hf-root" data-composition-id="hf-root" data-root="true" data-start="0" data-duration="${total.toFixed(2)}">
      <!-- Persistent atmosphere layer behind every scene -->
      <div class="hf-atmosphere" aria-hidden="true">
        <div class="hf-grid-bg"></div>
        <div class="hf-glow-orb a" id="hf-orb-a"></div>
        <div class="hf-glow-orb b" id="hf-orb-b"></div>
      </div>
${sceneFragments.join("\n")}
${audioTags.join("\n")}
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
        // background always feels alive. Independent of scene visibility.
        var orbA = document.getElementById('hf-orb-a');
        var orbB = document.getElementById('hf-orb-b');
        if (orbA) {
          window.gsap.to(orbA, {
            x: 600, y: 200, duration: Math.max(20, TOTAL),
            yoyo: true, repeat: -1, ease: 'sine.inOut',
          });
        }
        if (orbB) {
          window.gsap.to(orbB, {
            x: -500, y: -250, duration: Math.max(24, TOTAL),
            yoyo: true, repeat: -1, ease: 'sine.inOut', delay: 1.2,
          });
        }
        // Persistent decorations: rails draw in once at start.
        window.gsap.to('#hf-rail-top', { width: '100%', duration: 1.2, ease: 'expo.out', delay: 0.2 });
        window.gsap.to('#hf-rail-left', { height: '100%', duration: 1.4, ease: 'expo.out', delay: 0.35 });
        window.gsap.to('.hf-corner', { opacity: 0.9, duration: 0.5, ease: 'power3.out', stagger: 0.08, delay: 0.6 });

        // Cross-frame caption visibility toggle. Studio (or any embedder) can
        // postMessage({ source: 'hf-host', type: 'captions', visible: false })
        // to hide the caption bubble. URL hash captions=off also disables.
        function applyCaptionVisibility(visible) {
          var cap = document.getElementById('hf-captions');
          if (!cap) return;
          if (visible) cap.classList.remove('hidden');
          else cap.classList.add('hidden');
        }
        if (window.location.hash.indexOf('captions=off') !== -1) applyCaptionVisibility(false);
        try {
          var stored = localStorage.getItem('hf-captions-visible');
          if (stored === '0') applyCaptionVisibility(false);
        } catch (e) {}
        window.addEventListener('message', function(ev) {
          var d = ev.data;
          if (!d || d.source !== 'hf-host' || d.type !== 'captions') return;
          applyCaptionVisibility(d.visible !== false);
          try { localStorage.setItem('hf-captions-visible', d.visible === false ? '0' : '1'); } catch (e) {}
        });

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
        function forceSync(t) {
          var activeIdx = -1;
          for (var i = 0; i < SCENES.length; i++) {
            var s = SCENES[i];
            if (t >= s.start && t < s.start + s.duration) { activeIdx = i; break; }
          }
          var active = activeIdx >= 0 ? SCENES[activeIdx].id : null;
          // Scene visibility: opacity-only so the runtime can't override us.
          for (var j = 0; j < SCENES.length; j++) {
            var sj = SCENES[j];
            var el = document.getElementById(sj.id);
            if (!el) continue;
            var want = sj.id === active ? "1" : "0";
            if (el.style.opacity !== want) el.style.opacity = want;
            if (el.style.visibility === "hidden") el.style.visibility = "";
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
        // rAF is heavily throttled inside the studio's iframe — it can fire
        // 0 times per second when the parent tab isn't focused. Combine
        // multiple triggers so visibility stays correct under all conditions.
        function loop() {
          forceSync(root.time());
          window.requestAnimationFrame(loop);
        }
        window.requestAnimationFrame(loop);
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
