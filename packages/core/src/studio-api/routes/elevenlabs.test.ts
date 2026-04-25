import { describe, it, expect } from "vitest";
import { sanitizeFilename } from "./elevenlabs.js";

describe("sanitizeFilename", () => {
  it("returns null for empty / undefined input", () => {
    expect(sanitizeFilename(undefined)).toBeNull();
    expect(sanitizeFilename("")).toBeNull();
    expect(sanitizeFilename("   ")).toBeNull();
  });

  it("accepts a simple basename", () => {
    expect(sanitizeFilename("scene-01")).toBe("scene-01");
  });

  it("accepts a relative path with subdirectories", () => {
    expect(sanitizeFilename("voice/scene-01")).toBe("voice/scene-01");
  });

  it("accepts a basename with one extension", () => {
    expect(sanitizeFilename("scene-01.mp3")).toBe("scene-01.mp3");
  });

  it("rejects path traversal", () => {
    expect(sanitizeFilename("../etc/passwd")).toBeNull();
    expect(sanitizeFilename("voice/../../../etc/passwd")).toBeNull();
    expect(sanitizeFilename("../voice/x")).toBeNull();
  });

  it("rejects components with leading dots (no hidden files)", () => {
    expect(sanitizeFilename(".env")).toBeNull();
    expect(sanitizeFilename(".git/config")).toBeNull();
    expect(sanitizeFilename("voice/.hidden.mp3")).toBeNull();
  });

  it("rejects multiple dots in a single component (no .html.mp3 ambiguity)", () => {
    expect(sanitizeFilename("scene.html.mp3")).toBeNull();
    expect(sanitizeFilename("voice/a.b.c")).toBeNull();
  });

  it("rejects spaces and shell metacharacters", () => {
    expect(sanitizeFilename("my voice.mp3")).toBeNull();
    expect(sanitizeFilename("voice;rm -rf.mp3")).toBeNull();
    expect(sanitizeFilename("voice|cat.mp3")).toBeNull();
    expect(sanitizeFilename("voice$(whoami).mp3")).toBeNull();
    expect(sanitizeFilename("voice`id`.mp3")).toBeNull();
  });

  it("strips leading slashes", () => {
    expect(sanitizeFilename("/voice/scene")).toBe("voice/scene");
    expect(sanitizeFilename("///voice/scene")).toBe("voice/scene");
  });

  it("normalizes backslashes to forward slashes", () => {
    expect(sanitizeFilename("voice\\scene-01")).toBe("voice/scene-01");
  });

  it("collapses repeated separators", () => {
    expect(sanitizeFilename("voice//scene")).toBe("voice/scene");
  });

  it("rejects unicode it can't normalize", () => {
    expect(sanitizeFilename("voice/scène")).toBeNull();
    expect(sanitizeFilename("voice/sc​ene")).toBeNull();
  });

  it("rejects empty path components", () => {
    // Multiple consecutive slashes already collapsed by the normalizer above,
    // but a trailing slash exposes an empty tail.
    expect(sanitizeFilename("voice/")).toBeNull();
  });

  describe("expectedExt enforcement", () => {
    it("accepts when basename has the expected extension", () => {
      expect(sanitizeFilename("voice/scene.mp3", "mp3")).toBe("voice/scene.mp3");
    });

    it("rejects when basename has a different extension", () => {
      expect(sanitizeFilename("voice/scene.html", "mp3")).toBeNull();
      expect(sanitizeFilename("voice/scene.exe", "mp3")).toBeNull();
    });

    it("accepts when basename has no extension (caller will append)", () => {
      expect(sanitizeFilename("voice/scene", "mp3")).toBe("voice/scene");
    });

    it("only checks the basename's extension, not parent components", () => {
      expect(sanitizeFilename("voice.mp3/scene", "mp3")).toBe("voice.mp3/scene");
    });
  });
});
