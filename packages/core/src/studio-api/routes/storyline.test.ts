import { describe, it, expect } from "vitest";
import { __testing } from "./storyline";
import type { Script } from "../../script/types";

const { buildProjectIntentSystem, buildProjectIntentResponse } = __testing;

const fakeScript: Script = {
  meta: { title: "Test" },
  scenes: [
    {
      id: "s01",
      text: "x",
      template: "hook-bigtext",
      props: { title: "Hello" },
      hook: true,
    },
    {
      id: "s02",
      text: "y",
      template: "aroll-text",
      props: { title: "World" },
    },
  ],
};

const fakeContext = {
  activeTheme: { id: "hackernoon-ft", name: "HackerNoon FT", description: "Cream + red" },
  themeChoices: [
    { id: "hackernoon-ft", name: "HackerNoon FT", description: "Cream + red" },
    { id: "data-drift-dark", name: "Data Drift Dark", description: "Black + cyan" },
    { id: "dreamspace", name: "Dreamspace", description: "UV gradient" },
  ],
  designBrief: "",
  imageSummary: "",
};

describe("buildProjectIntentSystem", () => {
  it("includes the active theme name + id", () => {
    const sys = buildProjectIntentSystem(fakeContext);
    expect(sys).toContain("hackernoon-ft");
    expect(sys).toContain("HackerNoon FT");
  });

  it("lists all available theme ids", () => {
    const sys = buildProjectIntentSystem(fakeContext);
    expect(sys).toContain("data-drift-dark");
    expect(sys).toContain("dreamspace");
  });

  it("indicates absence of design brief when empty", () => {
    const sys = buildProjectIntentSystem(fakeContext);
    expect(sys).toContain("DESIGN.md is empty or missing");
  });

  it("inlines a non-empty design brief", () => {
    const sys = buildProjectIntentSystem({
      ...fakeContext,
      designBrief: "Use cream + cyan for all data scenes.",
    });
    expect(sys).toContain("Use cream + cyan for all data scenes");
  });

  it("indicates an empty image manifest", () => {
    const sys = buildProjectIntentSystem(fakeContext);
    expect(sys).toContain("Image manifest\n(empty)");
  });

  it("locks narration so the model can't propose text changes", () => {
    const sys = buildProjectIntentSystem(fakeContext);
    expect(sys.toLowerCase()).toContain("narration is fixed");
  });
});

describe("buildProjectIntentResponse", () => {
  it("normalises an empty model output into safe defaults", () => {
    const res = buildProjectIntentResponse({}, fakeScript, fakeContext);
    expect(res.overallNote).toBe("");
    expect(res.themeSuggestion).toBeNull();
    expect(res.designBriefAddendum).toBeNull();
    expect(res.patches).toEqual([]);
  });

  it("drops a theme suggestion that matches the currently-active theme", () => {
    const res = buildProjectIntentResponse(
      {
        themeSuggestion: { suggestedThemeId: "hackernoon-ft", rationale: "stays the same" },
        scenes: [],
      },
      fakeScript,
      fakeContext,
    );
    expect(res.themeSuggestion).toBeNull();
  });

  it("drops a theme suggestion that's not in the available list", () => {
    const res = buildProjectIntentResponse(
      {
        themeSuggestion: { suggestedThemeId: "fake-theme-id", rationale: "won't apply" },
        scenes: [],
      },
      fakeScript,
      fakeContext,
    );
    expect(res.themeSuggestion).toBeNull();
  });

  it("keeps a valid theme suggestion that differs from the active theme", () => {
    const res = buildProjectIntentResponse(
      {
        themeSuggestion: {
          suggestedThemeId: "data-drift-dark",
          rationale: "darker reads more investigative",
        },
        scenes: [],
      },
      fakeScript,
      fakeContext,
    );
    expect(res.themeSuggestion).toEqual({
      currentThemeId: "hackernoon-ft",
      suggestedThemeId: "data-drift-dark",
      rationale: "darker reads more investigative",
    });
  });

  it("clamps the design brief addendum to 1200 chars and trims", () => {
    const huge = "a".repeat(2000);
    const res = buildProjectIntentResponse(
      {
        designBriefAddendum: { text: `   ${huge}   `, rationale: "bigger" },
        scenes: [],
      },
      fakeScript,
      fakeContext,
    );
    expect(res.designBriefAddendum?.text.length).toBe(1200);
    expect(res.designBriefAddendum?.rationale).toBe("bigger");
  });

  it("drops a brief addendum that's empty / whitespace only", () => {
    const res = buildProjectIntentResponse(
      {
        designBriefAddendum: { text: "   ", rationale: "noop" },
        scenes: [],
      },
      fakeScript,
      fakeContext,
    );
    expect(res.designBriefAddendum).toBeNull();
  });

  it("merges partial props into existing scene props on patch", () => {
    const res = buildProjectIntentResponse(
      {
        scenes: [
          {
            sceneId: "s01",
            props: { eyebrow: "BREAKING" },
            note: "give it broadcast urgency",
          },
        ],
      },
      fakeScript,
      fakeContext,
    );
    expect(res.patches).toHaveLength(1);
    // s01 already had props.title="Hello"; merge should preserve it.
    expect(res.patches[0]?.patch.props).toEqual({ title: "Hello", eyebrow: "BREAKING" });
    expect(res.patches[0]?.note).toBe("give it broadcast urgency");
  });

  it("skips scenes referenced by sceneId not in the script", () => {
    const res = buildProjectIntentResponse(
      {
        scenes: [
          { sceneId: "doesnt-exist", props: { title: "X" }, note: "unused" },
          { sceneId: "s02", reasoning: "tighter why", note: "explain better" },
        ],
      },
      fakeScript,
      fakeContext,
    );
    expect(res.patches).toHaveLength(1);
    expect(res.patches[0]?.sceneId).toBe("s02");
    expect(res.patches[0]?.patch.reasoning).toBe("tighter why");
  });

  it("drops template patches that match the current template (no-op)", () => {
    const res = buildProjectIntentResponse(
      {
        scenes: [
          {
            sceneId: "s01",
            template: "hook-bigtext", // same as current
            note: "noop",
          },
        ],
      },
      fakeScript,
      fakeContext,
    );
    // No actual change → no patch shipped.
    expect(res.patches).toHaveLength(0);
  });

  it("keeps template patches when the new template differs", () => {
    const res = buildProjectIntentResponse(
      {
        scenes: [
          {
            sceneId: "s01",
            template: "hook-vhs-rip",
            props: { title: "STALLED" },
            note: "more cinematic",
          },
        ],
      },
      fakeScript,
      fakeContext,
    );
    expect(res.patches).toHaveLength(1);
    expect(res.patches[0]?.patch.template).toBe("hook-vhs-rip");
  });
});
