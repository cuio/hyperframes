/**
 * Frame-accurate animation capture for the chart-pack test pages.
 *
 * For each scene-NN.html, this script:
 *   1. Loads the page in headless Chrome with window.__captureMode = true,
 *      which prevents the page from auto-playing its GSAP timeline.
 *   2. Seeks the scene timeline to t = frame/fps for each frame in
 *      [0, duration*fps), captures a PNG, writes it to a temp dir.
 *   3. Pipes the PNG sequence through ffmpeg → MP4 (libx264, yuv420p,
 *      faststart so it streams cleanly).
 *
 * Output (relative to repo root):
 *   videos/chart-pack-test/scene-NN.mp4   (one per scene)
 *   videos/chart-pack-test/all-scenes.mp4 (concat supercut)
 *
 * Why this script lives at packages/engine/scripts/: puppeteer is a direct
 * dep of `engine`, so `bun run` from this workspace resolves it cleanly.
 * Running from repo-root scripts/ would need a workspace-aware launcher.
 *
 * How to run from repo root:
 *   bun run --cwd packages/engine scripts/capture-chart-pack.ts
 *
 * Or, after `cd packages/engine`:
 *   bun run scripts/capture-chart-pack.ts
 *
 * Override the project dir via CHART_PACK_PROJECT env var if you want to
 * capture a different test composition.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

// This file lives at packages/engine/scripts/capture-chart-pack.ts; the
// repo root is two directories up. Resolve relative to __dirname instead
// of process.cwd() so the script runs from any working directory.
const SCRIPT_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "../../..");
const PROJECT_DIR = process.env.CHART_PACK_PROJECT
  ? resolve(process.env.CHART_PACK_PROJECT)
  : join(REPO_ROOT, "videos/chart-pack-test");
const W = 1920;
const H = 1080;
const FPS = 30;
const DURATION_S = 5; // matches SCENE_DURATION in scripts/build-chart-pack-test.ts
const FRAME_COUNT = FPS * DURATION_S;
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";

async function captureScene(browser: puppeteer.Browser, scenePath: string): Promise<string> {
  const baseName = scenePath.replace(/\.html$/, "");
  const framesDir = join(PROJECT_DIR, `.frames-${baseName}`);
  if (existsSync(framesDir)) rmSync(framesDir, { recursive: true });
  mkdirSync(framesDir, { recursive: true });

  const tab = await browser.newPage();
  await tab.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await tab.evaluateOnNewDocument(() => {
    (window as unknown as { __captureMode: boolean }).__captureMode = true;
  });
  const url = `file://${join(PROJECT_DIR, scenePath)}`;
  await tab.goto(url, { waitUntil: "networkidle0", timeout: 15000 });

  // Wait for window.__hf to be exposed (means the scene's timeline registered).
  await tab.waitForFunction(() => (window as unknown as { __hf?: object }).__hf, { timeout: 5000 });

  // Capture each frame by seeking the timeline.
  for (let i = 0; i < FRAME_COUNT; i++) {
    const t = i / FPS;
    await tab.evaluate((t: number) => {
      const hf = (window as unknown as { __hf: { seek: (t: number) => void } }).__hf;
      hf.seek(t);
    }, t);
    // Tiny settle so any ticker-driven sync paints before screenshot.
    await new Promise((r) => setTimeout(r, 8));
    const framePath = join(framesDir, `frame-${String(i).padStart(4, "0")}.png`);
    await tab.screenshot({ path: framePath, type: "png" });
  }

  await tab.close();

  // Encode frames → mp4 via ffmpeg.
  const outMp4 = join(PROJECT_DIR, `${baseName}.mp4`);
  await new Promise<void>((resolve, reject) => {
    const ff = spawn(
      FFMPEG,
      [
        "-y",
        "-framerate",
        String(FPS),
        "-i",
        join(framesDir, "frame-%04d.png"),
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-crf",
        "18",
        "-preset",
        "medium",
        "-movflags",
        "+faststart",
        outMp4,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    ff.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    ff.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}\n${stderr.slice(-2000)}`));
    });
  });

  // Cleanup frames dir (mp4 is what we keep).
  rmSync(framesDir, { recursive: true });

  return outMp4;
}

async function main() {
  const pages = readdirSync(PROJECT_DIR)
    .filter((f) => f.startsWith("scene-") && f.endsWith(".html"))
    .sort();
  if (pages.length === 0) {
    console.error(`No scene-*.html in ${PROJECT_DIR}. Run build-chart-pack-test.ts first.`);
    process.exit(1);
  }

  console.log(`Capturing ${pages.length} scenes × ${FRAME_COUNT} frames @ ${FPS}fps...`);
  const browser = await puppeteer.launch({
    headless: "shell",
    args: ["--no-sandbox", "--disable-setuid-sandbox", `--window-size=${W},${H}`],
    defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
  });

  const mp4s: string[] = [];
  for (const page of pages) {
    const start = Date.now();
    const mp4 = await captureScene(browser, page);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`  ✓ ${page} → ${mp4.replace(REPO_ROOT + "/", "")} (${elapsed}s)`);
    mp4s.push(mp4);
  }
  await browser.close();

  // Build supercut: concat all scene MP4s into one file via ffmpeg's concat demuxer.
  const concatList = join(PROJECT_DIR, "_concat-list.txt");
  writeFileSync(concatList, mp4s.map((m) => `file '${m}'`).join("\n"), "utf8");
  const supercut = join(PROJECT_DIR, "all-scenes.mp4");
  await new Promise<void>((resolve, reject) => {
    const ff = spawn(
      FFMPEG,
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        concatList,
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        supercut,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    ff.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    ff.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg concat exited ${code}\n${stderr.slice(-2000)}`));
    });
  });
  rmSync(concatList);
  console.log(`  ✓ all-scenes.mp4 (${pages.length}× scene supercut)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
