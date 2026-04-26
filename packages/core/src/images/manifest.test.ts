import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  emptyManifest,
  findById,
  manifestPath,
  pickId,
  readManifest,
  removeEntry,
  upsertEntry,
  writeManifest,
  type ImageEntry,
} from "./manifest.js";

let tmp: string;

function makeEntry(id: string): ImageEntry {
  return {
    id,
    src: `images/${id}.webp`,
    format: "webp",
    width: 1920,
    height: 1080,
    aspect: 1920 / 1080,
    bytes: 1234,
    dominantColor: "#101010",
    palette: ["#100", "#200", "#300", "#400"],
    role: null,
    description: "",
    tags: [],
    focalPoint: { x: 0.5, y: 0.5 },
    importedAt: new Date().toISOString(),
  };
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "img-manifest-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("readManifest / writeManifest", () => {
  it("returns empty manifest when file is missing", () => {
    expect(readManifest(tmp)).toEqual({ version: 1, images: [] });
  });

  it("round-trips a simple manifest", () => {
    const orig = { version: 1 as const, images: [makeEntry("a"), makeEntry("b")] };
    writeManifest(tmp, orig);
    expect(readManifest(tmp)).toEqual(orig);
  });

  it("returns empty manifest for malformed JSON", () => {
    mkdirSync(join(tmp, "assets"), { recursive: true });
    writeFileSync(manifestPath(tmp), "{ not json");
    expect(readManifest(tmp)).toEqual(emptyManifest());
  });

  it("returns empty manifest for wrong version", () => {
    mkdirSync(join(tmp, "assets"), { recursive: true });
    writeFileSync(manifestPath(tmp), JSON.stringify({ version: 99, images: [] }));
    expect(readManifest(tmp).images).toEqual([]);
  });

  it("filters out entries missing required fields", () => {
    mkdirSync(join(tmp, "assets"), { recursive: true });
    const broken = {
      version: 1,
      images: [makeEntry("ok"), { id: "no-src" }, { description: "no id either" }],
    };
    writeFileSync(manifestPath(tmp), JSON.stringify(broken));
    const loaded = readManifest(tmp);
    expect(loaded.images).toHaveLength(1);
    expect(loaded.images[0]?.id).toBe("ok");
  });
});

describe("pickId", () => {
  it("slugifies the source basename", () => {
    const m = emptyManifest();
    expect(pickId(m, "Cowboy & Birds.JPG")).toBe("cowboy-birds");
  });

  it("appends -2 on collision", () => {
    const m = upsertEntry(emptyManifest(), makeEntry("cowboy"));
    expect(pickId(m, "cowboy.png")).toBe("cowboy-2");
  });

  it("walks suffixes until it finds a free id", () => {
    let m = emptyManifest();
    for (const suffix of ["", "-2", "-3"]) m = upsertEntry(m, makeEntry(`cowboy${suffix}`));
    expect(pickId(m, "cowboy.png")).toBe("cowboy-4");
  });

  it("falls back to 'image' when input has no slug-able chars", () => {
    expect(pickId(emptyManifest(), "!!!.png")).toBe("image");
  });

  it("clamps long basenames to 48 chars", () => {
    const long = "a".repeat(80) + ".png";
    expect(pickId(emptyManifest(), long).length).toBeLessThanOrEqual(48);
  });
});

describe("upsertEntry / removeEntry / findById", () => {
  it("upsert adds a new entry", () => {
    const next = upsertEntry(emptyManifest(), makeEntry("a"));
    expect(next.images).toHaveLength(1);
  });

  it("upsert replaces an existing entry by id", () => {
    let m = upsertEntry(emptyManifest(), makeEntry("a"));
    m = upsertEntry(m, { ...makeEntry("a"), description: "updated" });
    expect(m.images).toHaveLength(1);
    expect(m.images[0]?.description).toBe("updated");
  });

  it("removeEntry drops the matching id and leaves others", () => {
    let m = upsertEntry(emptyManifest(), makeEntry("a"));
    m = upsertEntry(m, makeEntry("b"));
    m = removeEntry(m, "a");
    expect(m.images.map((i) => i.id)).toEqual(["b"]);
  });

  it("findById returns null when missing", () => {
    expect(findById(emptyManifest(), "nope")).toBeNull();
  });
});
