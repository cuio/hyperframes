import { describe, it, expect, vi, beforeEach } from "vitest";
import { varyHookAndScore, applyHookWinner, type ScoredHookVariant } from "./hookVariants.js";
import type { Script, SceneRef } from "./types.js";

// Mock both planSceneVariants AND scoreScript so we don't hit the real API.
vi.mock("./planner.js", () => ({
  planSceneVariants: vi.fn(),
}));
vi.mock("./scriptScorer.js", () => ({
  scoreScript: vi.fn(),
}));

import { planSceneVariants } from "./planner.js";
import { scoreScript } from "./scriptScorer.js";
const mockedVariants = vi.mocked(planSceneVariants);
const mockedScore = vi.mocked(scoreScript);

const makeScript = (): Script => ({
  meta: { title: "Test" },
  scenes: [
    {
      id: "s01",
      text: "Last year half the internet was bots.",
      template: "hook-bigtext",
      props: { title: "BOTS" },
      hook: true,
      durationHint: 3,
    },
    {
      id: "s02",
      text: "More.",
      template: "aroll-text",
      props: {},
    },
  ],
});

describe("varyHookAndScore", () => {
  beforeEach(() => {
    mockedVariants.mockReset();
    mockedScore.mockReset();
  });

  it("generates variants, scores each, picks highest-retention winner", async () => {
    const variants: Array<SceneRef & { label: string }> = [
      {
        id: "s01",
        text: "Last year half the internet was bots.",
        template: "hook-bigtext",
        props: { title: "BOTS" },
        label: "Original",
        reasoning: "as-is",
      },
      {
        id: "s01",
        text: "Last year half the internet was bots.",
        template: "kinetic-words",
        props: { words: ["BOTS", "WROTE", "INTERNET"] },
        label: "Kinetic",
        reasoning: "kinetic typography",
      },
      {
        id: "s01",
        text: "Last year half the internet was bots.",
        template: "cyber-glitch-word",
        props: { word: "BOTS" },
        label: "Glitch",
        reasoning: "cyber glitch",
      },
    ];
    mockedVariants.mockResolvedValue(variants);
    mockedScore
      .mockResolvedValueOnce({
        scenes: [
          {
            sceneId: "s01",
            hookStrength: 6,
            sentiment: "neutral",
            sentimentIntensity: 5,
            energy: 6,
            predictedRetention: 70,
            narrativeRole: "hook",
            rationale: "",
          },
        ],
        arc: {} as never,
        recommendations: [],
        usage: { inputTokens: 100, outputTokens: 50 },
      })
      .mockResolvedValueOnce({
        scenes: [
          {
            sceneId: "s01",
            hookStrength: 9,
            sentiment: "alarming",
            sentimentIntensity: 8,
            energy: 9,
            predictedRetention: 92,
            narrativeRole: "hook",
            rationale: "",
          },
        ],
        arc: {} as never,
        recommendations: [],
        usage: { inputTokens: 100, outputTokens: 50 },
      })
      .mockResolvedValueOnce({
        scenes: [
          {
            sceneId: "s01",
            hookStrength: 7,
            sentiment: "alarming",
            sentimentIntensity: 7,
            energy: 8,
            predictedRetention: 85,
            narrativeRole: "hook",
            rationale: "",
          },
        ],
        arc: {} as never,
        recommendations: [],
        usage: { inputTokens: 100, outputTokens: 50 },
      });

    const result = await varyHookAndScore(makeScript(), { apiKey: "fake" });

    expect(result.variants).toHaveLength(3);
    expect(result.winner.label).toBe("Kinetic"); // highest predictedRetention (92)
    expect(result.winner.score.predictedRetention).toBe(92);
    expect(result.usage.scoreInputTokens).toBe(300);
  });

  it("sorts variants by predictedRetention descending", async () => {
    mockedVariants.mockResolvedValue([
      { id: "s01", text: "x", template: "a", props: {}, label: "lo", reasoning: "" },
      { id: "s01", text: "x", template: "b", props: {}, label: "hi", reasoning: "" },
      { id: "s01", text: "x", template: "c", props: {}, label: "med", reasoning: "" },
    ]);
    mockedScore
      .mockResolvedValueOnce({
        scenes: [scoreOf(70)],
        arc: {} as never,
        recommendations: [],
        usage: { inputTokens: 0, outputTokens: 0 },
      })
      .mockResolvedValueOnce({
        scenes: [scoreOf(95)],
        arc: {} as never,
        recommendations: [],
        usage: { inputTokens: 0, outputTokens: 0 },
      })
      .mockResolvedValueOnce({
        scenes: [scoreOf(80)],
        arc: {} as never,
        recommendations: [],
        usage: { inputTokens: 0, outputTokens: 0 },
      });
    const result = await varyHookAndScore(makeScript(), { apiKey: "fake" });
    expect(result.variants.map((v) => v.score.predictedRetention)).toEqual([95, 80, 70]);
  });

  it("uses hookStrength as tiebreaker when retention is tied", async () => {
    mockedVariants.mockResolvedValue([
      { id: "s01", text: "x", template: "a", props: {}, label: "lower-hook", reasoning: "" },
      { id: "s01", text: "x", template: "b", props: {}, label: "higher-hook", reasoning: "" },
    ]);
    mockedScore
      .mockResolvedValueOnce({
        scenes: [scoreOf(80, 6)],
        arc: {} as never,
        recommendations: [],
        usage: { inputTokens: 0, outputTokens: 0 },
      })
      .mockResolvedValueOnce({
        scenes: [scoreOf(80, 9)],
        arc: {} as never,
        recommendations: [],
        usage: { inputTokens: 0, outputTokens: 0 },
      });
    const result = await varyHookAndScore(makeScript(), { apiKey: "fake" });
    expect(result.winner.label).toBe("higher-hook");
  });

  it("throws when script has no scenes", async () => {
    const empty: Script = { meta: {}, scenes: [] };
    await expect(varyHookAndScore(empty, { apiKey: "fake" })).rejects.toThrow("no scenes");
  });
});

describe("applyHookWinner", () => {
  it("replaces scene 0 with the winner, preserving the original id", () => {
    const script = makeScript();
    const winner: ScoredHookVariant = {
      index: 1,
      label: "Kinetic",
      scene: {
        id: "variant-id",
        text: "Last year half the internet was bots.",
        template: "kinetic-words",
        props: { words: ["BOTS", "WROTE"] },
      },
      reasoning: "",
      score: scoreOf(92),
    };
    const out = applyHookWinner(script, winner);
    expect(out.scenes[0]?.id).toBe("s01"); // original id preserved
    expect(out.scenes[0]?.template).toBe("kinetic-words");
    expect(out.scenes[1]?.id).toBe("s02"); // rest unchanged
  });

  it("does not mutate the input script", () => {
    const script = makeScript();
    const winner: ScoredHookVariant = {
      index: 0,
      label: "x",
      scene: {
        id: "x",
        text: "y",
        template: "kinetic-words",
        props: {},
      },
      reasoning: "",
      score: scoreOf(80),
    };
    applyHookWinner(script, winner);
    expect(script.scenes[0]?.template).toBe("hook-bigtext");
  });
});

function scoreOf(retention: number, hookStrength = 7) {
  return {
    sceneId: "s01",
    hookStrength,
    sentiment: "neutral" as const,
    sentimentIntensity: 5,
    energy: 7,
    predictedRetention: retention,
    narrativeRole: "hook" as const,
    rationale: "",
  };
}
