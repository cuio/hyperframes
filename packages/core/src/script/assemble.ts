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
  const sceneVisibility: Array<{ id: string; start: number; duration: number }> = [];

  for (const scene of planned.scenes) {
    const tpl = BUILTIN_TEMPLATES.find((t) => t.id === scene.template);
    if (!tpl) continue;
    const dur = sceneDuration(scene);

    const fragment = tpl.render(scene.props, {
      sceneId: scene.id,
      audioSrc: scene.audio?.path,
      durationSeconds: dur,
      isHook: scene.hook === true,
      tokens,
    });
    const positioned = fragment.replace(`data-start="0"`, `data-start="${cursor.toFixed(2)}"`);
    sceneFragments.push(positioned);

    if (scene.audio) {
      audioTags.push(
        `  <audio src="${escapeAttr(scene.audio.path)}" data-start="${cursor.toFixed(2)}" data-duration="${dur.toFixed(2)}" data-track-index="1" preload="auto"></audio>`,
      );
    }
    sceneVisibility.push({ id: scene.id, start: cursor, duration: dur });
    cursor += dur;
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
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
        background: ${tokens.colors.bg};
        color: ${tokens.colors.fg};
        font-family: ${tokens.fonts.body};
      }
      .hf-stage {
        position: relative;
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
      }
      .scene {
        position: absolute;
        inset: 0;
        width: ${width}px;
        height: ${height}px;
        opacity: 0;
        pointer-events: none;
      }
    </style>
  </head>
  <body>
    <div class="hf-stage" id="hf-root" data-composition-id="hf-root" data-root="true" data-start="0" data-duration="${total.toFixed(2)}">
${sceneFragments.join("\n")}
${audioTags.join("\n")}
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
        var root = window.gsap.timeline({ paused: true });
        // Spacer establishes the master duration.
        root.to({}, { duration: ${total.toFixed(2)} }, 0);

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
          var active = null;
          for (var i = 0; i < SCENES.length; i++) {
            var s = SCENES[i];
            if (t >= s.start && t < s.start + s.duration) { active = s.id; break; }
          }
          // We use opacity only (no visibility) because the runtime media
          // and composition adapters can flip style.visibility on us.
          // Opacity 1 wins decisively, and pointer-events:none on .scene
          // keeps inactive scenes from intercepting input.
          for (var j = 0; j < SCENES.length; j++) {
            var sj = SCENES[j];
            var el = document.getElementById(sj.id);
            if (!el) continue;
            var want = sj.id === active ? "1" : "0";
            if (el.style.opacity !== want) el.style.opacity = want;
            // Defensive: clear visibility:hidden if anything stamped it on us.
            if (el.style.visibility === "hidden") el.style.visibility = "";
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

function sceneDuration(scene: PlannedScene): number {
  if (scene.audio?.durationSeconds && scene.audio.durationSeconds > 0) {
    return scene.audio.durationSeconds;
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
