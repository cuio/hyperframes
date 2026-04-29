import { describe, it, expect } from "vitest";
import { resolveMusicSpan, type MusicEntry, type SceneSpan } from "./manifest";

const baseEntry: Pick<MusicEntry, "scenesCovered" | "durationSeconds"> = {
  scenesCovered: [],
  durationSeconds: 60,
};

const SCENES: SceneSpan[] = [
  { id: "s01", start: 0, duration: 5 },
  { id: "s02", start: 5, duration: 8 },
  { id: "s03", start: 13, duration: 6 },
  { id: "s04", start: 19, duration: 4 },
];
const TOTAL = 23;

describe("resolveMusicSpan", () => {
  it("empty scenesCovered = full-video span, capped at audio length", () => {
    expect(resolveMusicSpan({ scenesCovered: [], durationSeconds: 30 }, SCENES, TOTAL)).toEqual({
      start: 0,
      declaredDuration: 23,
    });
  });

  it("empty scenesCovered with audio shorter than total stays at audio length", () => {
    expect(resolveMusicSpan({ scenesCovered: [], durationSeconds: 10 }, SCENES, TOTAL)).toEqual({
      start: 0,
      declaredDuration: 10,
    });
  });

  it("single-scene cover spans that scene only", () => {
    expect(resolveMusicSpan({ ...baseEntry, scenesCovered: ["s02"] }, SCENES, TOTAL)).toEqual({
      start: 5,
      declaredDuration: 8,
    });
  });

  it("contiguous multi-scene cover spans first start to last end", () => {
    // s02 starts 5 + s03 ends 19 → start=5, duration=14
    expect(
      resolveMusicSpan({ scenesCovered: ["s02", "s03"], durationSeconds: 60 }, SCENES, TOTAL),
    ).toEqual({ start: 5, declaredDuration: 14 });
  });

  it("non-contiguous cover (s01 + s04) spans the outer hull", () => {
    // s01 starts 0 + s04 ends 23 → start=0, duration=23
    expect(
      resolveMusicSpan({ scenesCovered: ["s01", "s04"], durationSeconds: 60 }, SCENES, TOTAL),
    ).toEqual({ start: 0, declaredDuration: 23 });
  });

  it("scenesCovered referencing unknown ids falls back to full video", () => {
    expect(
      resolveMusicSpan({ scenesCovered: ["doesnt-exist"], durationSeconds: 30 }, SCENES, TOTAL),
    ).toEqual({ start: 0, declaredDuration: 23 });
  });

  it("audio longer than covered scenes clips to covered duration", () => {
    expect(
      resolveMusicSpan({ scenesCovered: ["s01"], durationSeconds: 60 }, SCENES, TOTAL),
    ).toEqual({ start: 0, declaredDuration: 5 });
  });

  it("audio shorter than covered scenes uses audio length", () => {
    expect(
      resolveMusicSpan({ scenesCovered: ["s01", "s02", "s03"], durationSeconds: 7 }, SCENES, TOTAL),
    ).toEqual({ start: 0, declaredDuration: 7 });
  });

  it("scenesCovered out of order resolves correctly (uses min/max not first/last)", () => {
    expect(
      resolveMusicSpan({ scenesCovered: ["s04", "s02"], durationSeconds: 60 }, SCENES, TOTAL),
    ).toEqual({ start: 5, declaredDuration: 18 });
  });
});
