/**
 * Build standalone HTML pages — one per chart × theme — to verify the
 * editorial chart pack renders correctly across all 4 built-in themes
 * + a couple of bgOverride gradient atmospheres.
 *
 * Each page auto-plays its own scene timeline immediately on load (no
 * master timeline, no visibility-toggle complexity). After ~2s the
 * scene is fully resolved and ready to screenshot via puppeteer.
 *
 * Outputs:
 *   videos/chart-pack-test/scene-01.html  (lollipop / hackernoon-ft)
 *   videos/chart-pack-test/scene-02.html  (grouped-bars / dark + linear gradient)
 *   videos/chart-pack-test/scene-03.html  (annotated-area / dreamspace + radial gradient)
 *   videos/chart-pack-test/scene-04.html  (donut / cyberlofi)
 *   videos/chart-pack-test/scene-05.html  (grouped-bars / hackernoon-ft, second sample)
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getTemplate } from "../packages/core/src/script/templates/index.js";
import { THEMES } from "../packages/core/src/script/themes.js";
import type { DesignTokens } from "../packages/core/src/script/templates/types.js";

// Resolve relative to this file so the script works from any cwd.
const SCRIPT_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");

const W = 1920;
const H = 1080;
const SCENE_DURATION = 5; // seconds — long enough for entrance + settle

interface SceneSpec {
  id: string;
  themeName: string;
  bgOverride?: string;
  props: Record<string, unknown>;
}

const SCENES: SceneSpec[] = [
  {
    id: "scene-01",
    themeName: "hackernoon-ft",
    props: {
      title: "Ninety Days That Gave AI Agents a Tax ID",
      subtitle: "Year 2026, agent-economy infrastructure milestones from wallet to legal entity",
      titleStyle: "rule-above",
      byline: "Ishan Pandey  /  HackerNoon",
      bylinePosition: "left",
      source: "Sources: Coinbase, ClawBank, CoinDesk, FinTech Weekly.",
      chart: {
        type: "lollipop-timeline",
        props: {
          events: [
            {
              date: "11 Feb",
              label: "Coinbase ships\nAgentic Wallets (x402)",
              category: "coinbase",
            },
            {
              date: "09 Mar",
              label: "Armstrong: 'more agents\nthan humans'",
              category: "clawbank",
            },
            { date: "21 Apr", label: "Coinbase launches\nAgentic.market", category: "coinbase" },
            {
              date: "01 May",
              label: "ClawBank's Manfred files\nits own US company",
              category: "clawbank",
            },
          ],
          categories: [
            { id: "coinbase", name: "Coinbase / wallet layer", color: "secondary" },
            { id: "clawbank", name: "ClawBank / agent-as-actor layer", color: "primary" },
          ],
        },
      },
    },
  },
  {
    id: "scene-02",
    themeName: "data-drift-dark",
    bgOverride: "linear-gradient(135deg, #0a0a0a 0%, #1a0a2e 45%, #0a0a14 100%)",
    props: {
      title: "Claude Code grew 6× in nine months",
      subtitle: "Share of professional developers using each AI coding tool at work, %",
      titleStyle: "underline-below",
      byline: "Ishan Pandey  /  HackerNoon",
      bylinePosition: "right",
      source: "Sources: JetBrains AI Pulse Survey (Jan 2026, n=10,000); Stack Overflow 2025.",
      chart: {
        type: "grouped-bars",
        props: {
          groups: [
            "GitHub\nCopilot",
            "Cursor",
            "Claude\nCode",
            "JetBrains\nAI",
            "Google\nAntigravity",
            "Gemini\nCLI",
          ],
          series: [
            { name: "Apr–Jun 2025", values: [27, 14, 3, 8, null, 2], color: "muted" },
            {
              name: "Jan 2026",
              values: [29, 18, 18, 11, 6, 5],
              color: "secondary",
              highlightIndex: 2,
              highlightColor: "primary",
            },
          ],
          valueFormat: "percent",
          annotation: {
            text: "6× growth\nin 9 months",
            targetGroup: 2,
            targetSeries: 1,
            position: "right",
          },
        },
      },
    },
  },
  {
    id: "scene-03",
    themeName: "dreamspace",
    bgOverride: "radial-gradient(ellipse at top, #1a1530 0%, #0d0d18 65%, #08080f 100%)",
    props: {
      title: "Machines Are Already Transacting",
      subtitle: "Coinbase x402 protocol cleared 50M+ machine-to-machine payments in under a month",
      titleStyle: "rule-above",
      byline: "Ishan Pandey  /  HackerNoon",
      bylinePosition: "left",
      source: "Source: Brian Armstrong (X), 9 March 2026; Blockonomi.",
      chart: {
        type: "annotated-area",
        props: {
          points: [
            { x: "11 Feb\n(launch)", y: 0 },
            { x: "18 Feb", y: 5 },
            { x: "25 Feb", y: 22 },
            { x: "04 Mar", y: 38 },
            { x: "09 Mar\n(Armstrong post)", y: 50 },
          ],
          valueFormat: "compact-count",
          startLabel: "0",
          endLabel: "50M+",
          yLabel: "Cumulative transactions cleared",
          annotation: {
            text: "26 days from protocol launch to 50 million transactions",
            targetIndex: 2,
            position: "above",
          },
        },
      },
    },
  },
  {
    id: "scene-04",
    themeName: "cyberlofi",
    props: {
      title: "Dollar Demand From Machines",
      subtitle: "Share of stablecoin supply tied to the dollar",
      titleStyle: "underline-below",
      byline: "Ishan Pandey  /  HackerNoon",
      bylinePosition: "left",
      source: "Sources: JPMorgan; Cryptonews; ClawBank press release.",
      chart: {
        type: "donut-ring",
        props: {
          percent: 99,
          centerValue: "99%",
          centerCaption: "USD-pegged",
        },
      },
    },
  },
  {
    id: "scene-05",
    themeName: "hackernoon-ft",
    props: {
      title: "Bot Traffic Share",
      subtitle: "Share of global web traffic that was automated, by year",
      titleStyle: "underline-below",
      byline: "Ishan Pandey  /  HackerNoon",
      bylinePosition: "right",
      source: "Sources: Imperva Bad Bot Report 2024.",
      chart: {
        type: "grouped-bars",
        props: {
          groups: ["2019", "2020", "2021", "2022", "2023", "2024"],
          series: [
            {
              name: "Bot traffic %",
              values: [37, 41, 44, 47, 48, 49.6],
              color: "secondary",
              highlightIndex: 5,
              highlightColor: "primary",
            },
          ],
          valueFormat: "percent",
          annotation: {
            text: "+2.6 pp acceleration\n2022 → 2024",
            targetGroup: 5,
            targetSeries: 0,
            position: "above",
          },
        },
      },
    },
  },
];

function renderSceneHtml(spec: SceneSpec): string {
  const tpl = getTemplate("chart-scene");
  if (!tpl) throw new Error("chart-scene template missing — did you build core?");
  const tokens = THEMES[spec.themeName] as DesignTokens;
  if (!tokens) throw new Error(`unknown theme: ${spec.themeName}`);
  const sceneProps = spec.bgOverride ? { ...spec.props, bgOverride: spec.bgOverride } : spec.props;
  const sceneFragment = tpl.render(sceneProps, {
    sceneId: spec.id,
    durationSeconds: SCENE_DURATION,
    isHook: false,
    tokens,
  });
  // Standalone HTML — auto-plays the scene's GSAP timeline on load. No master.
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <title>Editorial Chart Pack — ${spec.id}</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Space+Grotesk:wght@300;400;500;600;700&family=JetBrains+Mono:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 100vw; height: 100vh; overflow: hidden; background: #000; color: #fff; }
      .hf-stage { width: ${W}px; height: ${H}px; position: relative; overflow: hidden; }
      .scene { position: absolute; inset: 0; }
    </style>
  </head>
  <body>
    <div class="hf-stage">
      ${sceneFragment}
    </div>
    <script>
      // Expose the scene's timeline for headless drivers (puppeteer
      // animation capture) AND auto-play in the browser case. The
      // chart-scene template's inline script registers
      // window.__timelines[sceneId] paused; we keep it paused, expose
      // window.__hf with seek/duration helpers, and only auto-play when
      // no harness has flagged itself by setting window.__captureMode.
      (function(){
        function start(){
          if (!window.gsap) return setTimeout(start, 50);
          var sid = '${spec.id}';
          var tl = window.__timelines && window.__timelines[sid];
          if (!tl) return setTimeout(start, 50);
          window.__hf = {
            sceneId: sid,
            tl: tl,
            duration: tl.duration(),
            seek: function(t){ tl.pause(); tl.seek(t, false); },
            play: function(){ tl.play(); },
          };
          if (!window.__captureMode) tl.play();
        }
        start();
      })();
    </script>
  </body>
</html>`;
}

const projectDir = process.env.CHART_PACK_PROJECT
  ? resolve(process.env.CHART_PACK_PROJECT)
  : join(REPO_ROOT, "videos/chart-pack-test");
mkdirSync(projectDir, { recursive: true });

for (const spec of SCENES) {
  const html = renderSceneHtml(spec);
  const out = join(projectDir, `${spec.id}.html`);
  writeFileSync(out, html, "utf8");
  console.log(
    `✓ ${spec.id}.html (${spec.themeName}${spec.bgOverride ? " + gradient" : ""}, ${(html.length / 1024).toFixed(1)}KB)`,
  );
}
console.log(
  `\nNext: open each scene-NN.html in a browser, OR puppeteer-snapshot via:\n  npx tsx scripts/snapshot-chart-pack.ts`,
);
