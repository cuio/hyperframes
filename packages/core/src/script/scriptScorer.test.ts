import { describe, it, expect, vi, beforeEach } from "vitest";
import { scoreScript, SCORER_DEFAULT_MODEL } from "./scriptScorer.js";
import type { Script } from "./types.js";

// Mock the anthropic client so we don't hit the real API in unit tests.
// We capture the args passed to callStructuredTool (model, prompts, tool)
// and return a deterministic structured response that exercises the
// post-processing logic (sorting, shape preservation, usage passthrough).
vi.mock("../anthropic/index.js", () => ({
  callStructuredTool: vi.fn(),
}));

import { callStructuredTool } from "../anthropic/index.js";
const mockedCall = vi.mocked(callStructuredTool);

const makeScript = (): Script => ({
  meta: { title: "Test", targetDurationSeconds: 60 },
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
      text: "Forty-nine point six percent.",
      template: "hook-statreveal",
      props: { value: "49.6%", label: "of web traffic" },
      durationHint: 4,
    },
    {
      id: "s03",
      text: "The flip is coming.",
      template: "outro-cta",
      props: { headline: "Watch closely" },
      durationHint: 3,
    },
  ],
});

describe("scoreScript", () => {
  beforeEach(() => {
    mockedCall.mockReset();
  });

  it("calls Anthropic with the configured model + prompts and returns the parsed score", async () => {
    mockedCall.mockResolvedValue({
      result: {
        scenes: [
          {
            sceneId: "s01",
            hookStrength: 8,
            sentiment: "alarming",
            sentimentIntensity: 7,
            energy: 9,
            predictedRetention: 88,
            narrativeRole: "hook",
            rationale: "Strong opener",
          },
          {
            sceneId: "s02",
            hookStrength: 7,
            sentiment: "neutral",
            sentimentIntensity: 5,
            energy: 8,
            predictedRetention: 85,
            narrativeRole: "stake",
            rationale: "Specific stat lands",
          },
          {
            sceneId: "s03",
            hookStrength: 5,
            sentiment: "curious",
            sentimentIntensity: 4,
            energy: 5,
            predictedRetention: 80,
            narrativeRole: "close",
            rationale: "Fine close",
          },
        ],
        arc: {
          overallRetention: 84,
          hookQuality: 8,
          energyPeaks: [0],
          momentumRisks: [],
          closingStrength: 6,
        },
        recommendations: [
          // Intentionally NOT in impact-descending order — scoreScript should sort.
          {
            type: "rewrite-text",
            sceneId: "s03",
            field: "headline",
            suggestion: "Land the close stronger",
            predictedImpact: 2,
            confidence: "low",
          },
          {
            type: "rewrite-text",
            sceneId: "s01",
            field: "title",
            suggestion: "'BOTS' is generic — try '49% BOTS'",
            predictedImpact: 5,
            confidence: "high",
          },
          {
            type: "duration-adjust",
            sceneId: "s02",
            suggestion: "Tighten s02 from 4s → 3s",
            predictedImpact: 3,
            confidence: "medium",
          },
        ],
      },
      usage: {
        input_tokens: 1234,
        output_tokens: 567,
      } as { input_tokens: number; output_tokens: number },
    });

    const out = await scoreScript(makeScript(), { apiKey: "fake-key" });

    // Anthropic was called once with the right defaults
    expect(mockedCall).toHaveBeenCalledTimes(1);
    const callArg = mockedCall.mock.calls[0]?.[1];
    expect(callArg?.model).toBe(SCORER_DEFAULT_MODEL);
    expect(callArg?.tool.name).toBe("report_script_retention");
    expect(typeof callArg?.system).toBe("string");
    expect(callArg?.user).toContain("Test"); // title from script.meta surfaced
    expect(callArg?.user).toContain("s01");
    expect(callArg?.user).toContain("hook-bigtext");

    // Output passthrough
    expect(out.scenes).toHaveLength(3);
    expect(out.arc.overallRetention).toBe(84);
    expect(out.usage).toEqual({ inputTokens: 1234, outputTokens: 567 });
  });

  it("sorts recommendations by predictedImpact descending", async () => {
    mockedCall.mockResolvedValue({
      result: {
        scenes: [],
        arc: {
          overallRetention: 75,
          hookQuality: 7,
          energyPeaks: [],
          momentumRisks: [],
          closingStrength: 6,
        },
        recommendations: [
          {
            type: "rewrite-text",
            sceneId: "s01",
            suggestion: "low",
            predictedImpact: 1,
            confidence: "low",
          },
          {
            type: "split-scene",
            sceneId: "s02",
            suggestion: "high",
            predictedImpact: 7,
            confidence: "high",
          },
          {
            type: "duration-adjust",
            sceneId: "s03",
            suggestion: "med",
            predictedImpact: 4,
            confidence: "medium",
          },
        ],
      },
      usage: { input_tokens: 0, output_tokens: 0 } as {
        input_tokens: number;
        output_tokens: number;
      },
    });

    const out = await scoreScript(makeScript(), { apiKey: "fake-key" });
    const impacts = out.recommendations.map((r) => r.predictedImpact);
    expect(impacts).toEqual([7, 4, 1]);
  });

  it("respects custom model + temperature overrides", async () => {
    mockedCall.mockResolvedValue({
      result: { scenes: [], arc: {} as never, recommendations: [] },
      usage: { input_tokens: 0, output_tokens: 0 } as {
        input_tokens: number;
        output_tokens: number;
      },
    });
    await scoreScript(makeScript(), {
      apiKey: "fake-key",
      model: "claude-sonnet-4-5",
      temperature: 0.8,
    });
    const callArg = mockedCall.mock.calls[0]?.[1];
    expect(callArg?.model).toBe("claude-sonnet-4-5");
    expect(callArg?.temperature).toBe(0.8);
  });

  it("propagates errors from the Anthropic call", async () => {
    mockedCall.mockRejectedValue(new Error("rate limited"));
    await expect(scoreScript(makeScript(), { apiKey: "fake-key" })).rejects.toThrow("rate limited");
  });

  it("includes a per-scene props summary in the user prompt", async () => {
    mockedCall.mockResolvedValue({
      result: { scenes: [], arc: {} as never, recommendations: [] },
      usage: { input_tokens: 0, output_tokens: 0 } as {
        input_tokens: number;
        output_tokens: number;
      },
    });
    await scoreScript(makeScript(), { apiKey: "fake-key" });
    const user = mockedCall.mock.calls[0]?.[1].user ?? "";
    // Title prop surfaced
    expect(user).toContain("title=BOTS");
    // hook flag surfaced
    expect(user).toContain("(marked as hook)");
    // duration hint surfaced (format: "**Duration hint:** Xs")
    expect(user).toMatch(/Duration hint:\*?\*? 3s/);
  });

  it("works on a script with no hook flag and minimal props", async () => {
    mockedCall.mockResolvedValue({
      result: {
        scenes: [],
        arc: {
          overallRetention: 50,
          hookQuality: 0,
          energyPeaks: [],
          momentumRisks: [],
          closingStrength: 5,
        },
        recommendations: [],
      },
      usage: { input_tokens: 0, output_tokens: 0 } as {
        input_tokens: number;
        output_tokens: number;
      },
    });
    const minimal: Script = {
      meta: {},
      scenes: [{ id: "s01", text: "Hello", template: "aroll-text", props: {} }],
    };
    const out = await scoreScript(minimal, { apiKey: "fake-key" });
    expect(out.arc.overallRetention).toBe(50);
  });
});
