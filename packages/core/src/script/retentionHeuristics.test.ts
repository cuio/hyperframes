import { describe, it, expect } from "vitest";
import {
  applyRetentionHeuristics,
  inferScriptFormat,
  avoidChartAtSceneOne,
  capConsecutiveCharts,
  autoEmitPayoff,
  clampChartDurations,
} from "./retentionHeuristics.js";
import type { Script, SceneRef } from "./types.js";

const makeScene = (overrides: Partial<SceneRef>): SceneRef => ({
  id: "s00",
  text: "",
  template: "aroll-text",
  props: {},
  ...overrides,
});

describe("inferScriptFormat", () => {
  it("respects explicit meta.format", () => {
    expect(inferScriptFormat({ format: "short" } as never)).toBe("short");
    expect(inferScriptFormat({ format: "long" } as never)).toBe("long");
  });
  it("uses targetDurationSeconds <= 90 → short", () => {
    expect(inferScriptFormat({ targetDurationSeconds: 60 })).toBe("short");
    expect(inferScriptFormat({ targetDurationSeconds: 90 })).toBe("short");
  });
  it("uses targetDurationSeconds > 90 → long", () => {
    expect(inferScriptFormat({ targetDurationSeconds: 91 })).toBe("long");
    expect(inferScriptFormat({ targetDurationSeconds: 600 })).toBe("long");
  });
  it("defaults to long when nothing is set", () => {
    expect(inferScriptFormat({})).toBe("long");
  });
});

describe("avoidChartAtSceneOne", () => {
  it("prepends a hook-bigtext when scene 0 is chart-scene", () => {
    const scenes = [
      makeScene({
        id: "s01",
        template: "chart-scene",
        props: { title: "Bot Traffic Share" },
      }),
    ];
    const out = avoidChartAtSceneOne(scenes);
    expect(out).toHaveLength(2);
    expect(out[0]?.template).toBe("hook-bigtext");
    expect(out[0]?.props.title).toBe("Bot Traffic Share");
    expect(out[1]?.template).toBe("chart-scene");
  });
  it("falls back to subtitle when title is missing", () => {
    const scenes = [
      makeScene({
        id: "s01",
        template: "chart-scene",
        props: { subtitle: "By year, 2019–2024" },
      }),
    ];
    const out = avoidChartAtSceneOne(scenes);
    expect(out[0]?.props.title).toBe("By year, 2019–2024");
  });
  it("is a no-op when scene 0 isn't a chart", () => {
    const scenes = [makeScene({ id: "s01", template: "hook-bigtext" })];
    expect(avoidChartAtSceneOne(scenes)).toEqual(scenes);
  });
  it("is a no-op on empty input", () => {
    expect(avoidChartAtSceneOne([])).toEqual([]);
  });
});

describe("capConsecutiveCharts", () => {
  it("inserts a bridge after 2 consecutive charts when a 3rd follows", () => {
    const scenes = [
      makeScene({ id: "s01", template: "chart-scene", props: { subtitle: "first chart" } }),
      makeScene({ id: "s02", template: "chart-scene", props: { subtitle: "second chart" } }),
      makeScene({ id: "s03", template: "chart-scene", props: { subtitle: "third chart" } }),
    ];
    const out = capConsecutiveCharts(scenes);
    expect(out).toHaveLength(4);
    // Bridge should sit between the 2nd and 3rd chart-scene
    expect(out[2]?.template).toBe("kinetic-words");
    expect(out[3]?.template).toBe("chart-scene");
  });
  it("does NOT insert a bridge when there are only 2 consecutive charts", () => {
    const scenes = [
      makeScene({ id: "s01", template: "chart-scene" }),
      makeScene({ id: "s02", template: "chart-scene" }),
      makeScene({ id: "s03", template: "aroll-text" }),
    ];
    const out = capConsecutiveCharts(scenes);
    expect(out).toHaveLength(3);
  });
  it("resets the consecutive-counter on a non-chart scene", () => {
    const scenes = [
      makeScene({ id: "s01", template: "chart-scene" }),
      makeScene({ id: "s02", template: "chart-scene" }),
      makeScene({ id: "s03", template: "aroll-text" }),
      makeScene({ id: "s04", template: "chart-scene" }),
      makeScene({ id: "s05", template: "chart-scene" }),
    ];
    const out = capConsecutiveCharts(scenes);
    // No bridge inserted because each chart-pair is separated by aroll-text
    expect(out).toHaveLength(5);
  });
});

describe("autoEmitPayoff", () => {
  it("emits a chart-payoff after every chart-scene", () => {
    const scenes = [
      makeScene({
        id: "s01",
        template: "chart-scene",
        props: {
          chart: {
            type: "grouped-bars",
            props: {
              annotation: { text: "6× growth in 9 months" },
            },
          },
        },
      }),
    ];
    const out = autoEmitPayoff(scenes);
    expect(out).toHaveLength(2);
    expect(out[1]?.template).toBe("chart-payoff");
    expect(out[1]?.props.payoff).toBe("6× growth in 9 months");
  });
  it("falls back to subtitle when annotation is missing", () => {
    const scenes = [
      makeScene({
        id: "s01",
        template: "chart-scene",
        props: { subtitle: "Editorial takeaway here." },
      }),
    ];
    const out = autoEmitPayoff(scenes);
    expect(out).toHaveLength(2);
    expect(out[1]?.props.payoff).toBe("Editorial takeaway here.");
  });
  it("does not double-emit when planner already added a chart-payoff", () => {
    const scenes = [
      makeScene({
        id: "s01",
        template: "chart-scene",
        props: { chart: { type: "x", props: { annotation: { text: "Take" } } } },
      }),
      makeScene({ id: "s02", template: "chart-payoff", props: { payoff: "Take" } }),
    ];
    const out = autoEmitPayoff(scenes);
    expect(out).toHaveLength(2);
  });
  it("threads byline through to the payoff", () => {
    const scenes = [
      makeScene({
        id: "s01",
        template: "chart-scene",
        props: {
          subtitle: "fallback",
          byline: "Ishan Pandey  /  HackerNoon",
        },
      }),
    ];
    const out = autoEmitPayoff(scenes);
    expect(out[1]?.props.byline).toBe("Ishan Pandey  /  HackerNoon");
  });
});

describe("clampChartDurations", () => {
  it("caps short-form chart-scenes at 5s", () => {
    const scenes = [makeScene({ template: "chart-scene", durationHint: 9 })];
    const out = clampChartDurations(scenes, "short");
    expect(out[0]?.durationHint).toBe(5);
  });
  it("caps long-form chart-scenes at 10s", () => {
    const scenes = [makeScene({ template: "chart-scene", durationHint: 15 })];
    const out = clampChartDurations(scenes, "long");
    expect(out[0]?.durationHint).toBe(10);
  });
  it("preserves duration if under cap", () => {
    const scenes = [makeScene({ template: "chart-scene", durationHint: 4 })];
    const out = clampChartDurations(scenes, "short");
    expect(out[0]?.durationHint).toBe(4);
  });
  it("primes durationHint at the cap when not set", () => {
    const scenes = [makeScene({ template: "chart-scene" })];
    const out = clampChartDurations(scenes, "short");
    expect(out[0]?.durationHint).toBe(5);
  });
  it("leaves non-chart scenes alone", () => {
    const scenes = [makeScene({ template: "hook-bigtext", durationHint: 30 })];
    const out = clampChartDurations(scenes, "short");
    expect(out[0]?.durationHint).toBe(30);
  });
});

describe("applyRetentionHeuristics — full pipeline", () => {
  it("applies all rules in order and renumbers ids", () => {
    const script: Script = {
      meta: { targetDurationSeconds: 60 }, // → short-form
      scenes: [
        makeScene({
          id: "s01",
          template: "chart-scene",
          props: {
            title: "First Chart",
            chart: { type: "grouped-bars", props: { annotation: { text: "Takeaway one" } } },
          },
          durationHint: 8,
        }),
        makeScene({
          id: "s02",
          template: "chart-scene",
          props: {
            title: "Second Chart",
            chart: { type: "grouped-bars", props: { annotation: { text: "Takeaway two" } } },
          },
          durationHint: 7,
        }),
      ],
    };
    const out = applyRetentionHeuristics(script);
    // hook prepended (1) + chart (2) + payoff (3) + chart (4) + payoff (5) = 5 scenes
    expect(out.scenes).toHaveLength(5);
    expect(out.scenes[0]?.template).toBe("hook-bigtext");
    expect(out.scenes[1]?.template).toBe("chart-scene");
    expect(out.scenes[2]?.template).toBe("chart-payoff");
    expect(out.scenes[3]?.template).toBe("chart-scene");
    expect(out.scenes[4]?.template).toBe("chart-payoff");
    // ids renumbered
    expect(out.scenes[0]?.id).toBe("s01-hook");
    expect(out.scenes[1]?.id).toBe("s02");
    expect(out.scenes[2]?.id).toBe("s03-payoff");
    expect(out.scenes[3]?.id).toBe("s04");
    expect(out.scenes[4]?.id).toBe("s05-payoff");
    // chart durations clamped to 5s for short-form
    expect(out.scenes[1]?.durationHint).toBe(5);
    expect(out.scenes[3]?.durationHint).toBe(5);
  });

  it("does not mutate the input script", () => {
    const script: Script = {
      meta: {},
      scenes: [makeScene({ id: "s01", template: "hook-bigtext" })],
    };
    const beforeScenes = script.scenes.length;
    applyRetentionHeuristics(script);
    expect(script.scenes.length).toBe(beforeScenes);
  });
});
