import { describe, it, expect } from "vitest";
import { scoreVisualStoryboard } from "./visualStoryboardScorer.js";
import type { Script, SceneRef } from "./types.js";

const makeScene = (overrides: Partial<SceneRef>): SceneRef => ({
  id: "s00",
  text: "",
  template: "aroll-text",
  props: {},
  ...overrides,
});

const makeScript = (scenes: SceneRef[]): Script => ({
  meta: {},
  scenes,
});

describe("scoreVisualStoryboard", () => {
  it("returns max score on a varied 5-scene script with no issues", () => {
    const script = makeScript([
      makeScene({ id: "s01", template: "hook-bigtext", durationHint: 2 }),
      makeScene({ id: "s02", template: "kinetic-words", durationHint: 1.5 }),
      makeScene({ id: "s03", template: "chart-scene", durationHint: 6 }),
      makeScene({ id: "s04", template: "aroll-text", durationHint: 4 }),
      makeScene({ id: "s05", template: "outro-cta", durationHint: 2 }),
    ]);
    const out = scoreVisualStoryboard(script);
    expect(out.overall).toBeGreaterThanOrEqual(85);
    expect(out.issues.length).toBeLessThanOrEqual(1); // maybe atmosphere monotony default
  });

  it("flags template-monotony when 3+ identical templates run consecutively", () => {
    const script = makeScript([
      makeScene({ id: "s01", template: "aroll-text" }),
      makeScene({ id: "s02", template: "aroll-text" }),
      makeScene({ id: "s03", template: "aroll-text" }),
      makeScene({ id: "s04", template: "outro-cta" }),
    ]);
    const out = scoreVisualStoryboard(script);
    expect(out.issues.some((i) => i.type === "template-monotony")).toBe(true);
    const monotony = out.issues.find((i) => i.type === "template-monotony");
    expect(monotony?.sceneIds).toEqual(["s01", "s02", "s03"]);
    expect(out.variety.template).toBeLessThan(8);
  });

  it("flags atmosphere-monotony when all scenes share a single explicit atmosphere", () => {
    const script = makeScript([
      makeScene({ id: "s01", template: "hook-bigtext", props: { background: "aurora" } }),
      makeScene({ id: "s02", template: "aroll-text", props: { background: "aurora" } }),
      makeScene({ id: "s03", template: "outro-cta", props: { background: "aurora" } }),
    ]);
    const out = scoreVisualStoryboard(script);
    expect(out.issues.some((i) => i.type === "atmosphere-monotony")).toBe(true);
  });

  it("flags hook-too-long when a hook scene runs > 4s", () => {
    const script = makeScript([
      makeScene({ id: "s01", template: "hook-bigtext", durationHint: 6 }),
      makeScene({ id: "s02", template: "aroll-text", durationHint: 4 }),
    ]);
    const out = scoreVisualStoryboard(script);
    expect(out.issues.some((i) => i.type === "hook-too-long")).toBe(true);
  });

  it("flags chart-overrun when a chart-scene runs > 10s", () => {
    const script = makeScript([
      makeScene({ id: "s01", template: "chart-scene", durationHint: 12 }),
    ]);
    const out = scoreVisualStoryboard(script);
    expect(out.issues.some((i) => i.type === "chart-overrun")).toBe(true);
  });

  it("flags low-opening-density when first 5s is one long scene", () => {
    const script = makeScript([
      makeScene({ id: "s01", template: "hook-bigtext", durationHint: 6 }),
      makeScene({ id: "s02", template: "aroll-text", durationHint: 4 }),
    ]);
    const out = scoreVisualStoryboard(script);
    expect(out.issues.some((i) => i.type === "low-opening-density")).toBe(true);
  });

  it("rewards 3+ distinct beats in the opening 5s", () => {
    const script = makeScript([
      makeScene({ id: "s01", template: "hook-bigtext", durationHint: 1 }),
      makeScene({ id: "s02", template: "kinetic-words", durationHint: 1 }),
      makeScene({ id: "s03", template: "cyber-glitch-word", durationHint: 1.5 }),
      makeScene({ id: "s04", template: "aroll-text", durationHint: 4 }),
    ]);
    const out = scoreVisualStoryboard(script);
    expect(out.openingDensity).toBeGreaterThanOrEqual(8);
  });

  it("flags palette-stagnant when bgOverride + theme are identical across the arc", () => {
    const script = makeScript([
      makeScene({
        id: "s01",
        template: "chart-scene",
        props: { theme: "dreamspace", bgOverride: "linear-gradient(...)" },
      }),
      makeScene({
        id: "s02",
        template: "chart-scene",
        props: { theme: "dreamspace", bgOverride: "linear-gradient(...)" },
      }),
      makeScene({
        id: "s03",
        template: "chart-scene",
        props: { theme: "dreamspace", bgOverride: "linear-gradient(...)" },
      }),
      makeScene({
        id: "s04",
        template: "chart-scene",
        props: { theme: "dreamspace", bgOverride: "linear-gradient(...)" },
      }),
    ]);
    const out = scoreVisualStoryboard(script);
    expect(out.issues.some((i) => i.type === "palette-stagnant")).toBe(true);
  });

  it("sorts issues by penalty descending", () => {
    const script = makeScript([
      makeScene({ id: "s01", template: "aroll-text" }),
      makeScene({ id: "s02", template: "aroll-text" }),
      makeScene({ id: "s03", template: "aroll-text" }),
      makeScene({ id: "s04", template: "aroll-text" }),
      makeScene({ id: "s05", template: "aroll-text" }),
    ]);
    const out = scoreVisualStoryboard(script);
    for (let i = 1; i < out.issues.length; i++) {
      const prev = out.issues[i - 1];
      const cur = out.issues[i];
      if (prev && cur) expect(prev.penalty).toBeGreaterThanOrEqual(cur.penalty);
    }
  });

  it("returns max score on an empty script", () => {
    const out = scoreVisualStoryboard(makeScript([]));
    expect(out.overall).toBe(100);
    expect(out.issues).toEqual([]);
  });
});
