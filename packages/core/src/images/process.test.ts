import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { processImage } from "./process.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "img-process-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

async function writeFixture(
  width: number,
  height: number,
  color: { r: number; g: number; b: number },
): Promise<string> {
  const path = join(tmp, `src-${width}x${height}.png`);
  await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: color,
    },
  })
    .png()
    .toFile(path);
  return path;
}

describe("processImage", () => {
  it("produces a webp at the requested path", async () => {
    const src = await writeFixture(800, 600, { r: 50, g: 100, b: 200 });
    const out = join(tmp, "out.webp");
    const result = await processImage(src, out);
    expect(result.format).toBe("webp");
    expect(statSync(out).size).toBeGreaterThan(0);
    expect(result.bytes).toBeGreaterThan(0);
  });

  it("preserves dimensions when source is under maxLongEdge", async () => {
    const src = await writeFixture(800, 600, { r: 0, g: 0, b: 0 });
    const out = join(tmp, "out.webp");
    const result = await processImage(src, out);
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
  });

  it("downscales when long edge exceeds the limit", async () => {
    const src = await writeFixture(8000, 4000, { r: 0, g: 0, b: 0 });
    const out = join(tmp, "out.webp");
    const result = await processImage(src, out, { maxLongEdge: 1920 });
    expect(result.width).toBe(1920);
    expect(result.height).toBe(960);
  });

  it("does not upscale when source is smaller than maxLongEdge", async () => {
    const src = await writeFixture(400, 300, { r: 0, g: 0, b: 0 });
    const out = join(tmp, "out.webp");
    const result = await processImage(src, out, { maxLongEdge: 8000 });
    expect(result.width).toBe(400);
    expect(result.height).toBe(300);
  });

  it("samples a dominant color close to the source's average", async () => {
    const src = await writeFixture(400, 300, { r: 200, g: 50, b: 100 });
    const out = join(tmp, "out.webp");
    const result = await processImage(src, out);
    // After webp encoding the value drifts slightly; just confirm it is
    // in the right neighbourhood (R high, G low, B mid).
    const r = parseInt(result.dominantColor.slice(1, 3), 16);
    const g = parseInt(result.dominantColor.slice(3, 5), 16);
    const b = parseInt(result.dominantColor.slice(5, 7), 16);
    expect(r).toBeGreaterThan(150);
    expect(g).toBeLessThan(100);
    expect(b).toBeGreaterThan(50);
    expect(b).toBeLessThan(150);
  });

  it("returns a palette array of the requested length", async () => {
    const src = await writeFixture(400, 300, { r: 50, g: 50, b: 50 });
    const out = join(tmp, "out.webp");
    const result = await processImage(src, out);
    expect(result.palette).toHaveLength(4);
    for (const hex of result.palette) {
      expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("throws when the source path does not exist", async () => {
    await expect(processImage("/no/such/file.png", join(tmp, "out.webp"))).rejects.toThrow(
      /does not exist/i,
    );
  });

  it("creates parent directories of outPath", async () => {
    const src = await writeFixture(100, 100, { r: 0, g: 0, b: 0 });
    const out = join(tmp, "deeply", "nested", "out.webp");
    await processImage(src, out);
    expect(statSync(out).size).toBeGreaterThan(0);
  });
});
