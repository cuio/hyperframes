import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { ingestImage, ingestImages } from "./ingest.js";
import { manifestPath, readManifest } from "./manifest.js";

let tmp: string;
let projectDir: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "img-ingest-"));
  projectDir = join(tmp, "proj");
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

async function makeSource(name: string, width = 800, height = 600): Promise<string> {
  const path = join(tmp, name);
  await sharp({
    create: { width, height, channels: 3, background: { r: 100, g: 50, b: 200 } },
  })
    .png()
    .toFile(path);
  return path;
}

describe("ingestImage", () => {
  it("processes the source, writes assets/images/<id>.webp, and adds to manifest", async () => {
    const src = await makeSource("cowboy.png");
    const result = await ingestImage(src, { projectDir });
    expect(result.entry.id).toBe("cowboy");
    expect(result.entry.src).toBe("assets/images/cowboy.webp");
    expect(result.entry.format).toBe("webp");
    expect(result.entry.role).toBeNull();
    expect(result.entry.focalPoint).toEqual({ x: 0.5, y: 0.5 });
    expect(existsSync(join(projectDir, "assets", "images", "cowboy.webp"))).toBe(true);
    expect(existsSync(manifestPath(projectDir))).toBe(true);
  });

  it("appends -2 on id collision rather than overwriting", async () => {
    const a = await makeSource("photo.png");
    const b = await makeSource("photo.png");
    const r1 = await ingestImage(a, { projectDir });
    const r2 = await ingestImage(b, { projectDir });
    expect(r1.entry.id).toBe("photo");
    expect(r2.entry.id).toBe("photo-2");
    expect(readManifest(projectDir).images.map((i) => i.id)).toEqual(["photo", "photo-2"]);
  });

  it("overwrites when forceId matches an existing entry", async () => {
    const src = await makeSource("first.png");
    await ingestImage(src, { projectDir });
    const src2 = await makeSource("second.png");
    const r2 = await ingestImage(src2, { projectDir, forceId: "first" });
    expect(r2.replaced).toBe(true);
    expect(readManifest(projectDir).images.map((i) => i.id)).toEqual(["first"]);
  });

  it("ingestImages processes multiple sources sequentially", async () => {
    const a = await makeSource("alpha.png");
    const b = await makeSource("bravo.png");
    const c = await makeSource("charlie.png");
    const results = await ingestImages([a, b, c], { projectDir });
    expect(results.map((r) => r.entry.id)).toEqual(["alpha", "bravo", "charlie"]);
  });

  it("throws when source does not exist", async () => {
    await expect(ingestImage("/no/such/file.png", { projectDir })).rejects.toThrow(
      /does not exist/,
    );
  });
});
