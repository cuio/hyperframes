import { describe, it, expect } from "vitest";
import {
  applyRecommendations,
  parseRewriteTarget,
  parseDurationTarget,
  parseTemplateTarget,
  parseThemeTarget,
} from "./scoreApplier.js";
import type { Script, SceneRef } from "./types.js";
import type { SceneRecommendation } from "./scriptScorer.js";

const makeScene = (overrides: Partial<SceneRef>): SceneRef => ({
  id: "s01",
  text: "",
  template: "hook-bigtext",
  props: {},
  ...overrides,
});

const makeScript = (scenes: SceneRef[]): Script => ({ meta: {}, scenes });

describe("parseRewriteTarget", () => {
  it("pulls the quoted string after →", () => {
    expect(parseRewriteTarget("'BOTS' is generic — try '49% BOTS'")).toBe("49% BOTS");
  });
  it("pulls the quoted string after 'try'", () => {
    expect(parseRewriteTarget("Try 'New title' for more punch")).toBe("New title");
  });
  it("pulls the quoted string after 'to'", () => {
    expect(parseRewriteTarget("Rewrite to 'New title'")).toBe("New title");
  });
  it("falls back to the last quoted string if no arrow", () => {
    expect(parseRewriteTarget("'Old title' is weak. Use 'Better title'.")).toBe("Better title");
  });
  it("handles double quotes", () => {
    expect(parseRewriteTarget('rewrite to "New title"')).toBe("New title");
  });
  it("returns null when no quoted string found", () => {
    expect(parseRewriteTarget("Just rewrite this")).toBeNull();
  });
});

describe("parseDurationTarget", () => {
  it("parses 'to Ns' patterns", () => {
    expect(parseDurationTarget("Tighten s02 to 3s")).toBe(3);
  });
  it("parses '→ Ns' patterns", () => {
    expect(parseDurationTarget("Shorten s02 from 4s → 3s")).toBe(3);
  });
  it("handles decimal durations", () => {
    expect(parseDurationTarget("Adjust to 2.5s")).toBe(2.5);
  });
  it("rejects unreasonable durations", () => {
    expect(parseDurationTarget("Adjust to 999s")).toBeNull(); // > 60s cap
  });
  it("returns null when no Ns pattern", () => {
    expect(parseDurationTarget("Just tighten the scene")).toBeNull();
  });
});

describe("parseTemplateTarget", () => {
  it("pulls a kebab-case template id after →", () => {
    expect(parseTemplateTarget("Swap kinetic-words → cyber-glitch-word")).toBe("cyber-glitch-word");
  });
  it("pulls a kebab-case template id after 'to'", () => {
    expect(parseTemplateTarget("Swap to chart-payoff")).toBe("chart-payoff");
  });
});

describe("parseThemeTarget", () => {
  it("pulls a theme name after →", () => {
    expect(parseThemeTarget("Shift theme → dreamspace")).toBe("dreamspace");
  });
  it("pulls a theme name after 'theme'", () => {
    expect(parseThemeTarget("Use theme cyberlofi for energy")).toBe("cyberlofi");
  });
});

describe("applyRecommendations", () => {
  const baseScript = makeScript([
    makeScene({ id: "s01", template: "hook-bigtext", props: { title: "BOTS" }, durationHint: 3 }),
    makeScene({ id: "s02", template: "aroll-text", props: { title: "Old" }, durationHint: 5 }),
  ]);

  it("applies a high-confidence rewrite-text recommendation", () => {
    const recs: SceneRecommendation[] = [
      {
        type: "rewrite-text",
        sceneId: "s01",
        field: "title",
        suggestion: "'BOTS' is generic — try '49% BOTS'",
        predictedImpact: 5,
        confidence: "high",
      },
    ];
    const { script, report } = applyRecommendations(baseScript, recs);
    expect(report.applied).toHaveLength(1);
    expect(script.scenes[0]?.props.title).toBe("49% BOTS");
    expect(report.applied[0]?.diff).toContain("BOTS");
    expect(report.applied[0]?.diff).toContain("49%");
  });

  it("skips medium-confidence recs by default (minConfidence high)", () => {
    const recs: SceneRecommendation[] = [
      {
        type: "rewrite-text",
        sceneId: "s01",
        field: "title",
        suggestion: "try 'X'",
        predictedImpact: 3,
        confidence: "medium",
      },
    ];
    const { report } = applyRecommendations(baseScript, recs);
    expect(report.applied).toHaveLength(0);
    expect(report.skipped).toHaveLength(1);
  });

  it("respects minConfidence: 'medium'", () => {
    const recs: SceneRecommendation[] = [
      {
        type: "rewrite-text",
        sceneId: "s01",
        field: "title",
        suggestion: "try 'X'",
        predictedImpact: 3,
        confidence: "medium",
      },
    ];
    const { report } = applyRecommendations(baseScript, recs, { minConfidence: "medium" });
    expect(report.applied).toHaveLength(1);
  });

  it("respects topN", () => {
    const recs: SceneRecommendation[] = [
      {
        type: "rewrite-text",
        sceneId: "s01",
        field: "title",
        suggestion: "try 'X'",
        predictedImpact: 5,
        confidence: "high",
      },
      {
        type: "rewrite-text",
        sceneId: "s02",
        field: "title",
        suggestion: "try 'Y'",
        predictedImpact: 4,
        confidence: "high",
      },
    ];
    const { report } = applyRecommendations(baseScript, recs, { topN: 1 });
    expect(report.applied).toHaveLength(1);
    expect(report.applied[0]?.recommendation.sceneId).toBe("s01");
  });

  it("applies duration-adjust", () => {
    const recs: SceneRecommendation[] = [
      {
        type: "duration-adjust",
        sceneId: "s02",
        suggestion: "Shorten s02 from 5s → 3s",
        predictedImpact: 3,
        confidence: "high",
      },
    ];
    const { script, report } = applyRecommendations(baseScript, recs);
    expect(report.applied).toHaveLength(1);
    expect(script.scenes[1]?.durationHint).toBe(3);
  });

  it("applies template-swap when target is in catalog", () => {
    const recs: SceneRecommendation[] = [
      {
        type: "template-swap",
        sceneId: "s02",
        suggestion: "Swap aroll-text → kinetic-words",
        predictedImpact: 4,
        confidence: "high",
      },
    ];
    const { script, report } = applyRecommendations(baseScript, recs, {
      knownTemplates: new Set(["kinetic-words", "aroll-text"]),
    });
    expect(report.applied).toHaveLength(1);
    expect(script.scenes[1]?.template).toBe("kinetic-words");
  });

  it("skips template-swap when target is not in catalog", () => {
    const recs: SceneRecommendation[] = [
      {
        type: "template-swap",
        sceneId: "s02",
        suggestion: "Swap to nonexistent-template",
        predictedImpact: 4,
        confidence: "high",
      },
    ];
    const { report } = applyRecommendations(baseScript, recs, {
      knownTemplates: new Set(["aroll-text"]),
    });
    expect(report.applied).toHaveLength(0);
    expect(report.skipped[0]?.skipReason).toContain("not in catalog");
  });

  it("skips structural recs (split-scene, merge-scene, add-hook)", () => {
    const recs: SceneRecommendation[] = [
      {
        type: "split-scene",
        sceneId: "s02",
        suggestion: "Split s02",
        predictedImpact: 6,
        confidence: "high",
      },
      {
        type: "merge-scene",
        sceneId: "s01",
        suggestion: "Merge with s02",
        predictedImpact: 5,
        confidence: "high",
      },
      {
        type: "add-hook",
        sceneId: "s01",
        suggestion: "Add hook before",
        predictedImpact: 4,
        confidence: "high",
      },
    ];
    const { report } = applyRecommendations(baseScript, recs);
    expect(report.applied).toHaveLength(0);
    expect(report.skipped).toHaveLength(3);
    for (const s of report.skipped) {
      expect(s.skipReason).toContain("narrative judgment");
    }
  });

  it("does not mutate the input script", () => {
    const recs: SceneRecommendation[] = [
      {
        type: "rewrite-text",
        sceneId: "s01",
        field: "title",
        suggestion: "try 'X'",
        predictedImpact: 5,
        confidence: "high",
      },
    ];
    applyRecommendations(baseScript, recs);
    expect(baseScript.scenes[0]?.props.title).toBe("BOTS");
  });

  it("skips when scene id is missing", () => {
    const recs: SceneRecommendation[] = [
      {
        type: "rewrite-text",
        sceneId: "s99",
        field: "title",
        suggestion: "try 'X'",
        predictedImpact: 5,
        confidence: "high",
      },
    ];
    const { report } = applyRecommendations(baseScript, recs);
    expect(report.skipped[0]?.skipReason).toContain("not found");
  });
});
