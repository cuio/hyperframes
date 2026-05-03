import { describe, it, expect } from "vitest";
import { applySentimentTheming, SENTIMENT_BG_OVERRIDES } from "./sentimentTheming.js";
import type { Script, SceneRef } from "./types.js";
import type { SceneScore } from "./scriptScorer.js";

const makeScene = (overrides: Partial<SceneRef>): SceneRef => ({
  id: "s01",
  text: "",
  template: "chart-scene",
  props: {},
  ...overrides,
});

const makeScore = (overrides: Partial<SceneScore>): SceneScore => ({
  sceneId: "s01",
  hookStrength: 5,
  sentiment: "neutral",
  sentimentIntensity: 5,
  energy: 5,
  predictedRetention: 75,
  narrativeRole: "stake",
  rationale: "",
  ...overrides,
});

const makeScript = (scenes: SceneRef[]): Script => ({ meta: {}, scenes });

describe("applySentimentTheming", () => {
  it("applies bgOverride to chart-scene scenes based on sentiment", () => {
    const script = makeScript([makeScene({ id: "s01", template: "chart-scene" })]);
    const sceneScores = [makeScore({ sceneId: "s01", sentiment: "alarming" })];
    const { script: updated, report } = applySentimentTheming(script, { sceneScores });
    expect(report.changes).toHaveLength(1);
    expect(updated.scenes[0]?.props.bgOverride).toBe(SENTIMENT_BG_OVERRIDES.alarming);
  });

  it("preserves author-set bgOverride", () => {
    const script = makeScript([
      makeScene({
        id: "s01",
        template: "chart-scene",
        props: { bgOverride: "linear-gradient(0deg, red, blue)" },
      }),
    ]);
    const sceneScores = [makeScore({ sceneId: "s01", sentiment: "alarming" })];
    const { script: updated, report } = applySentimentTheming(script, { sceneScores });
    expect(report.changes).toHaveLength(0);
    expect(report.skipped).toHaveLength(1);
    expect(updated.scenes[0]?.props.bgOverride).toBe("linear-gradient(0deg, red, blue)");
  });

  it("skips templates that don't honour bgOverride", () => {
    const script = makeScript([makeScene({ id: "s01", template: "hook-bigtext" })]);
    const sceneScores = [makeScore({ sceneId: "s01", sentiment: "alarming" })];
    const { report } = applySentimentTheming(script, { sceneScores });
    expect(report.changes).toHaveLength(0);
    expect(report.skipped[0]?.reason).toContain("does not honour bgOverride");
  });

  it("skips neutral sentiment (no atmosphere mapping)", () => {
    const script = makeScript([makeScene({ id: "s01", template: "chart-scene" })]);
    const sceneScores = [makeScore({ sceneId: "s01", sentiment: "neutral" })];
    const { script: updated, report } = applySentimentTheming(script, { sceneScores });
    expect(report.changes).toHaveLength(0);
    expect(updated.scenes[0]?.props.bgOverride).toBeUndefined();
  });

  it("skips light themes (preserves cream identity)", () => {
    const script = makeScript([makeScene({ id: "s01", template: "chart-scene" })]);
    const sceneScores = [makeScore({ sceneId: "s01", sentiment: "alarming" })];
    const { report } = applySentimentTheming(script, {
      sceneScores,
      projectTheme: "hackernoon-ft",
    });
    expect(report.changes).toHaveLength(0);
    expect(report.skipped[0]?.reason).toContain("light theme");
  });

  it("does not skip dark themes", () => {
    const script = makeScript([makeScene({ id: "s01", template: "chart-scene" })]);
    const sceneScores = [makeScore({ sceneId: "s01", sentiment: "alarming" })];
    const { report } = applySentimentTheming(script, {
      sceneScores,
      projectTheme: "dreamspace",
    });
    expect(report.changes).toHaveLength(1);
  });

  it("respects custom bgOverrides", () => {
    const script = makeScript([makeScene({ id: "s01", template: "chart-scene" })]);
    const sceneScores = [makeScore({ sceneId: "s01", sentiment: "alarming" })];
    const customBg = "url(/my-custom-bg.png)";
    const { script: updated } = applySentimentTheming(script, {
      sceneScores,
      bgOverrides: {
        alarming: customBg,
        aspirational: null,
        curious: null,
        warm: null,
        cold: null,
        neutral: null,
      },
    });
    expect(updated.scenes[0]?.props.bgOverride).toBe(customBg);
  });

  it("does not mutate the input script", () => {
    const original = makeScript([makeScene({ id: "s01", template: "chart-scene" })]);
    const sceneScores = [makeScore({ sceneId: "s01", sentiment: "alarming" })];
    applySentimentTheming(original, { sceneScores });
    expect(original.scenes[0]?.props.bgOverride).toBeUndefined();
  });
});
