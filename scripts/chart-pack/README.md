# Chart-pack visual verification

Two-step pipeline for rendering the editorial chart pack across themes + gradients, capturing frame-accurate animation MP4s for visual review.

Use this whenever you add a new chart to `BUILTIN_CHARTS` or change anything in `chart-scene` / `charts/util.ts` — it's the cheapest way to confirm the chart renders correctly across all 4 built-in themes (`hackernoon-ft`, `data-drift-dark`, `dreamspace`, `cyberlofi`) and gradient backgrounds.

## Pipeline

```
scripts/build-chart-pack-test.ts          → standalone scene-NN.html files (one per chart × theme)
packages/engine/scripts/capture-chart-pack.ts → frame-accurate MP4 captures via puppeteer + ffmpeg
```

## Step 1 — Generate the test HTMLs

From the repo root:

```bash
bun run --cwd packages/core build  # rebuild core if you changed any chart code
npx tsx scripts/build-chart-pack-test.ts
```

This writes 5 standalone HTML pages to `videos/chart-pack-test/`:

| File            | Chart                                      | Theme             | Background                       |
| --------------- | ------------------------------------------ | ----------------- | -------------------------------- |
| `scene-01.html` | `lollipop-timeline`                        | `hackernoon-ft`   | solid cream                      |
| `scene-02.html` | `grouped-bars`                             | `data-drift-dark` | linear gradient via `bgOverride` |
| `scene-03.html` | `annotated-area`                           | `dreamspace`      | radial gradient via `bgOverride` |
| `scene-04.html` | `donut-ring`                               | `cyberlofi`       | solid black                      |
| `scene-05.html` | `grouped-bars` (single series + highlight) | `hackernoon-ft`   | solid cream                      |

Each page registers `window.__hf = { tl, seek, play, duration }` so the capture script (or any browser) can drive the timeline. If `window.__captureMode` is set before the page boots, the timeline starts paused; otherwise it auto-plays so you can quick-preview by opening the file in a browser.

To test a different chart configuration, edit the `SCENES[]` array at the top of `scripts/build-chart-pack-test.ts`. Each entry takes a chart-scene `props` object (the same shape the planner emits) plus a `themeName` and optional `bgOverride`.

You can also point the script at a different output directory:

```bash
CHART_PACK_PROJECT=/tmp/my-test npx tsx scripts/build-chart-pack-test.ts
```

## Step 2 — Capture frame-by-frame MP4s

```bash
cd packages/engine && bun run scripts/capture-chart-pack.ts
```

Why from `packages/engine/`: puppeteer is a direct dep there, so bun's resolver finds it. Running from repo root would need a workspace-aware launcher.

Outputs in `videos/chart-pack-test/`:

```
scene-01.mp4     5s × 30fps × 1920×1080
scene-02.mp4
scene-03.mp4
scene-04.mp4
scene-05.mp4
all-scenes.mp4   25s supercut (concat of all 5)
```

The capture loop pauses each scene's timeline, seeks to `frame/fps` for every frame, screenshots, then ffmpeg-encodes (libx264, CRF 18, faststart). Total time ≈ 100s for all 5 scenes on macOS.

Override defaults via env vars:

```bash
FFMPEG=/usr/local/bin/ffmpeg \
CHART_PACK_PROJECT=/tmp/my-test \
bun run scripts/capture-chart-pack.ts
```

## Quick smoke test (snapshot only, no MP4)

If you just want one PNG per scene to eyeball static rendering:

```bash
npx tsx packages/cli/src/cli.ts snapshot videos/chart-pack-test --frames 5
```

But note this drives the master-timeline runtime, not the standalone scene timelines this pipeline uses — for chart-only verification, prefer the MP4 capture above.

## What to look for in the output

- **Lollipop timeline (scene-01)**: leftmost label should anchor `start`, rightmost `end`. No clipping. Stem heights alternate so adjacent labels don't collide.
- **Grouped bars (scene-02, scene-05)**: bars rise from baseline (entrance), value labels pop above each bar (settle), highlighted bar in 3rd color, annotation pill fades in with curved leader (development).
- **Annotated area (scene-03)**: area fills under line as line draws via stroke-dashoffset. Endpoint labels appear last. Annotation pill clamps inside chart bounds.
- **Donut ring (scene-04)**: ring sweeps from 12 o'clock, center value fades in, caption follows.
- **Annotation pill contrast**: text reads sharply on every theme — cream parchment (FT), deep purple (data-drift-dark), ink-violet (dreamspace), pure black (cyberlofi).

If any of these break, that's a regression — fix before committing.
