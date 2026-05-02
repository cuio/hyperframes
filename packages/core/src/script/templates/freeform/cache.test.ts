import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readFreeformCache,
  writeFreeformCache,
  hashFreeformKey,
  clearFreeformCache,
} from "./cache.js";
import type { FreeformCacheKey, FreeformGeneration } from "./types.js";

const SCENE_ID = "s12";

const baseKey: FreeformCacheKey = {
  narration: "Snap just showed every tech company the playbook.",
  sceneId: SCENE_ID,
  referenceProfileShape: { vibe: "lo-fi cyberlofi", pacingDensity: "medium" },
  themeTokens: {
    bg: "#000000",
    fg: "#FFFFFF",
    accent: "#66FF99",
    accent2: "#FF6699",
    fontDisplay: "JetBrains Mono",
    fontMono: "JetBrains Mono",
  },
  generatorVersion: 1,
};

const validHtml = (sceneId: string): string =>
  [
    `<style>#${sceneId} { background: #000; }</style>`,
    `<div id="${sceneId}" data-composition-id="${sceneId}" data-scene-id="${sceneId}" data-duration="4">`,
    `  <div class="word">HI</div>`,
    `</div>`,
    `<script>`,
    `  window.__timelines = window.__timelines || {};`,
    `  window.__timelines['${sceneId}'] = gsap.timeline({ paused: true });`,
    `</script>`,
  ].join("\n");

const validGeneration: FreeformGeneration = {
  html: validHtml(SCENE_ID),
  model: "gemini-2.5-flash",
  generatedAt: "2026-05-02T16:00:00.000Z",
  usage: { promptTokens: 1500, outputTokens: 800 },
};

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "hf-freeform-cache-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("hashFreeformKey", () => {
  it("produces the same hash for structurally-equal keys", () => {
    const a: FreeformCacheKey = { ...baseKey };
    const b: FreeformCacheKey = { ...baseKey };
    expect(hashFreeformKey(a)).toBe(hashFreeformKey(b));
  });

  it("is order-independent across nested object keys", () => {
    // Reorder properties of nested objects and confirm same hash.
    const reordered: FreeformCacheKey = {
      ...baseKey,
      themeTokens: {
        accent2: baseKey.themeTokens.accent2,
        accent: baseKey.themeTokens.accent,
        fg: baseKey.themeTokens.fg,
        bg: baseKey.themeTokens.bg,
        fontMono: baseKey.themeTokens.fontMono,
        fontDisplay: baseKey.themeTokens.fontDisplay,
      },
    };
    expect(hashFreeformKey(reordered)).toBe(hashFreeformKey(baseKey));
  });

  it("changes when narration changes", () => {
    const other = { ...baseKey, narration: "completely different narration" };
    expect(hashFreeformKey(other)).not.toBe(hashFreeformKey(baseKey));
  });

  it("changes when scene id changes", () => {
    const other = { ...baseKey, sceneId: "s99" };
    expect(hashFreeformKey(other)).not.toBe(hashFreeformKey(baseKey));
  });

  it("changes when generatorVersion bumps", () => {
    const other = { ...baseKey, generatorVersion: 2 };
    expect(hashFreeformKey(other)).not.toBe(hashFreeformKey(baseKey));
  });

  it("returns a 32-char hex string", () => {
    const h = hashFreeformKey(baseKey);
    expect(h).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("writeFreeformCache + readFreeformCache", () => {
  it("round-trips a valid generation", () => {
    writeFreeformCache(tmp, baseKey, validGeneration);
    const back = readFreeformCache(tmp, baseKey);
    expect(back).not.toBeNull();
    expect(back?.html).toBe(validGeneration.html);
    expect(back?.model).toBe(validGeneration.model);
  });

  it("returns null when the cache file is missing", () => {
    expect(readFreeformCache(tmp, baseKey)).toBeNull();
  });

  it("refuses to persist invalid HTML", () => {
    const badGen: FreeformGeneration = { ...validGeneration, html: "<iframe src='evil'></iframe>" };
    expect(() => writeFreeformCache(tmp, baseKey, badGen)).toThrow();
  });

  it("returns null when the persisted JSON is unparseable", () => {
    writeFreeformCache(tmp, baseKey, validGeneration);
    // Find the cache file and corrupt it.
    const cacheDir = join(tmp, ".hyperframes/freeform-cache");
    const files = require("node:fs")
      .readdirSync(cacheDir)
      .filter((f: string) => f.endsWith(".json"));
    expect(files.length).toBe(1);
    const path = join(cacheDir, files[0]);
    writeFileSync(path, "{not json");
    expect(readFreeformCache(tmp, baseKey)).toBeNull();
  });

  it("returns null when the persisted html fails the validator (tampered cache)", () => {
    writeFreeformCache(tmp, baseKey, validGeneration);
    const cacheDir = join(tmp, ".hyperframes/freeform-cache");
    const files = require("node:fs")
      .readdirSync(cacheDir)
      .filter((f: string) => f.endsWith(".json"));
    const path = join(cacheDir, files[0]);
    // Tamper: replace the html with an injection attempt.
    const tampered = {
      ...validGeneration,
      html: `<iframe src="https://attacker.example"></iframe>`,
    };
    writeFileSync(path, JSON.stringify(tampered));
    expect(readFreeformCache(tmp, baseKey)).toBeNull();
  });

  it("creates the cache directory on first write", () => {
    expect(existsSync(join(tmp, ".hyperframes/freeform-cache"))).toBe(false);
    writeFreeformCache(tmp, baseKey, validGeneration);
    expect(existsSync(join(tmp, ".hyperframes/freeform-cache"))).toBe(true);
  });

  it("two structurally-equal keys read each other's cache entry", () => {
    writeFreeformCache(tmp, baseKey, validGeneration);
    const equivalent: FreeformCacheKey = JSON.parse(JSON.stringify(baseKey));
    expect(readFreeformCache(tmp, equivalent)?.html).toBe(validGeneration.html);
  });
});

describe("clearFreeformCache", () => {
  it("writes an INDEX.txt sentinel without erroring on missing dir", () => {
    expect(() => clearFreeformCache(tmp)).not.toThrow();
  });

  it("writes the sentinel when the cache dir exists", () => {
    mkdirSync(join(tmp, ".hyperframes/freeform-cache"), { recursive: true });
    clearFreeformCache(tmp);
    const idx = readFileSync(join(tmp, ".hyperframes/freeform-cache/INDEX.txt"), "utf-8");
    expect(idx).toContain("cleared at");
  });
});
