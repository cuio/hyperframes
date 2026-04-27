import { describe, it, expect } from "vitest";
import { resolveSfxStart, type SfxEntry } from "./manifest";

const baseEntry: Pick<SfxEntry, "anchor" | "accentWordIndex" | "durationSeconds"> = {
  anchor: "scene-start",
  durationSeconds: 1.5,
};

describe("resolveSfxStart", () => {
  it("scene-start anchor returns sceneStart + audioStartOffset", () => {
    expect(
      resolveSfxStart({
        sceneStart: 10,
        sceneDuration: 6,
        audioStartOffset: 0.15,
        voiceDurationSeconds: 5,
        voiceWordCount: 12,
        entry: { ...baseEntry, anchor: "scene-start" },
      }),
    ).toBeCloseTo(10.15, 3);
  });

  it("scene-start with zero lead-in returns sceneStart exactly", () => {
    expect(
      resolveSfxStart({
        sceneStart: 30,
        sceneDuration: 4,
        audioStartOffset: 0,
        voiceDurationSeconds: 3,
        voiceWordCount: 8,
        entry: { ...baseEntry, anchor: "scene-start" },
      }),
    ).toBe(30);
  });

  it("scene-end anchor places SFX so it finishes at scene end", () => {
    // sceneEnd = 16; SFX is 1.5s long → start at 14.5
    expect(
      resolveSfxStart({
        sceneStart: 10,
        sceneDuration: 6,
        audioStartOffset: 0.15,
        voiceDurationSeconds: 5,
        voiceWordCount: 12,
        entry: { ...baseEntry, anchor: "scene-end", durationSeconds: 1.5 },
      }),
    ).toBe(14.5);
  });

  it("scene-end with SFX longer than scene clamps to sceneStart (won't precede the scene)", () => {
    expect(
      resolveSfxStart({
        sceneStart: 50,
        sceneDuration: 2,
        audioStartOffset: 0,
        voiceDurationSeconds: 1.5,
        voiceWordCount: 4,
        entry: { ...baseEntry, anchor: "scene-end", durationSeconds: 5 },
      }),
    ).toBe(50);
  });

  it("accent-word anchor interpolates by word index", () => {
    // 4 words over 5s narration → each word gets ~1.25s; word index 2 = 2 * 1.25 = 2.5s
    // sceneStart 10 + audioStartOffset 0.15 + 2.5 = 12.65
    expect(
      resolveSfxStart({
        sceneStart: 10,
        sceneDuration: 6,
        audioStartOffset: 0.15,
        voiceDurationSeconds: 5,
        voiceWordCount: 4,
        entry: { ...baseEntry, anchor: "accent-word", accentWordIndex: 2 },
      }),
    ).toBeCloseTo(12.65, 3);
  });

  it("accent-word with index 0 = scene-start + offset (the first word fires immediately)", () => {
    expect(
      resolveSfxStart({
        sceneStart: 10,
        sceneDuration: 6,
        audioStartOffset: 0.15,
        voiceDurationSeconds: 5,
        voiceWordCount: 5,
        entry: { ...baseEntry, anchor: "accent-word", accentWordIndex: 0 },
      }),
    ).toBeCloseTo(10.15, 3);
  });

  it("accent-word with index past the word count clamps to last word", () => {
    // wordCount 5, requested index 99 → clamps to 4 (last word).
    // Each word = 5 / 5 = 1s. Index 4 = 4s offset. 10 + 0.15 + 4 = 14.15
    expect(
      resolveSfxStart({
        sceneStart: 10,
        sceneDuration: 6,
        audioStartOffset: 0.15,
        voiceDurationSeconds: 5,
        voiceWordCount: 5,
        entry: { ...baseEntry, anchor: "accent-word", accentWordIndex: 99 },
      }),
    ).toBeCloseTo(14.15, 3);
  });

  it("accent-word falls back to scene-start when narration is empty", () => {
    expect(
      resolveSfxStart({
        sceneStart: 8,
        sceneDuration: 4,
        audioStartOffset: 0.2,
        voiceDurationSeconds: 0,
        voiceWordCount: 0,
        entry: { ...baseEntry, anchor: "accent-word", accentWordIndex: 3 },
      }),
    ).toBeCloseTo(8.2, 3);
  });

  it("accent-word with negative index clamps to 0", () => {
    expect(
      resolveSfxStart({
        sceneStart: 10,
        sceneDuration: 6,
        audioStartOffset: 0,
        voiceDurationSeconds: 4,
        voiceWordCount: 4,
        entry: { ...baseEntry, anchor: "accent-word", accentWordIndex: -5 },
      }),
    ).toBe(10);
  });

  it("never returns a value before sceneStart", () => {
    // Defensive: scene-end with bizarre inputs.
    expect(
      resolveSfxStart({
        sceneStart: 100,
        sceneDuration: 0.1,
        audioStartOffset: 0,
        voiceDurationSeconds: 0.05,
        voiceWordCount: 1,
        entry: { ...baseEntry, anchor: "scene-end", durationSeconds: 99 },
      }),
    ).toBe(100);
  });
});
