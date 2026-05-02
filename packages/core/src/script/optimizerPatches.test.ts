import { describe, it, expect } from "vitest";
import { applyPatches, isImprovement, nextSceneId, validatePatches } from "./optimizerPatches.js";
import type { Script } from "./types.js";

const SCRIPT: Script = {
  meta: { title: "test" },
  scenes: [
    { id: "s01", text: "Hook line one.", template: "hook-bigtext", props: {} },
    { id: "s02", text: "Stat reveal here.", template: "hook-statreveal", props: { stat: 100 } },
    { id: "s03", text: "Closer.", template: "outro-cta", props: {} },
  ],
};

const KNOWN = {
  knownTemplates: ["hook-bigtext", "hook-statreveal", "outro-cta", "kinetic-words"],
  knownAtmospheres: ["aurora", "noise-grain", "studio-flat", "clean-fade"],
};

describe("validatePatches", () => {
  it("returns empty array when input isn't an array", () => {
    const out = validatePatches(null, SCRIPT, KNOWN);
    expect(out.patches).toEqual([]);
    expect(out.rejected.length).toBe(1);
  });

  it("rejects patches with unknown sceneId", () => {
    const out = validatePatches(
      [{ sceneId: "s99", action: "editText", text: "x", why: "y" }],
      SCRIPT,
      KNOWN,
    );
    expect(out.patches).toEqual([]);
    expect(out.rejected[0]?.reason).toMatch(/unknown sceneId/);
  });

  it("accepts a valid editText patch", () => {
    const out = validatePatches(
      [{ sceneId: "s01", action: "editText", text: "New hook.", why: "stronger" }],
      SCRIPT,
      KNOWN,
    );
    expect(out.patches.length).toBe(1);
    const p = out.patches[0];
    expect(p?.action).toBe("editText");
    if (p?.action === "editText") expect(p.text).toBe("New hook.");
  });

  it("rejects editText with empty text", () => {
    const out = validatePatches(
      [{ sceneId: "s01", action: "editText", text: "   ", why: "y" }],
      SCRIPT,
      KNOWN,
    );
    expect(out.patches).toEqual([]);
    expect(out.rejected[0]?.reason).toMatch(/empty text/);
  });

  it("rejects editText longer than the cap", () => {
    const out = validatePatches(
      [
        {
          sceneId: "s01",
          action: "editText",
          text: "a".repeat(700),
          why: "y",
        },
      ],
      SCRIPT,
      KNOWN,
    );
    expect(out.patches).toEqual([]);
    expect(out.rejected[0]?.reason).toMatch(/exceeds/);
  });

  it("accepts swapTemplate with a known template", () => {
    const out = validatePatches(
      [
        {
          sceneId: "s02",
          action: "swapTemplate",
          newTemplate: "kinetic-words",
          why: "more energy",
        },
      ],
      SCRIPT,
      KNOWN,
    );
    expect(out.patches.length).toBe(1);
    const p = out.patches[0];
    if (p?.action === "swapTemplate") expect(p.newTemplate).toBe("kinetic-words");
  });

  it("rejects swapTemplate with unknown template id", () => {
    const out = validatePatches(
      [
        {
          sceneId: "s01",
          action: "swapTemplate",
          newTemplate: "made-up-template",
          why: "y",
        },
      ],
      SCRIPT,
      KNOWN,
    );
    expect(out.patches).toEqual([]);
    expect(out.rejected[0]?.reason).toMatch(/unknown template/);
  });

  it("accepts addProp with arbitrary key/value", () => {
    const out = validatePatches(
      [
        {
          sceneId: "s01",
          action: "addProp",
          key: "accentWord",
          value: "playbook",
          why: "highlight",
        },
      ],
      SCRIPT,
      KNOWN,
    );
    expect(out.patches.length).toBe(1);
    const p = out.patches[0];
    if (p?.action === "addProp") {
      expect(p.key).toBe("accentWord");
      expect(p.value).toBe("playbook");
    }
  });

  it("rejects addProp on reserved keys", () => {
    for (const reserved of ["id", "text", "template", "voiceId", "audio"]) {
      const out = validatePatches(
        [
          {
            sceneId: "s01",
            action: "addProp",
            key: reserved,
            value: "x",
            why: "y",
          },
        ],
        SCRIPT,
        KNOWN,
      );
      expect(out.patches.length).toBe(0);
      expect(out.rejected[0]?.reason).toMatch(/reserved key/);
    }
  });

  it("rejects addProp atmosphere with unknown id", () => {
    const out = validatePatches(
      [
        {
          sceneId: "s01",
          action: "addProp",
          key: "atmosphere",
          value: "made-up",
          why: "y",
        },
      ],
      SCRIPT,
      KNOWN,
    );
    expect(out.patches.length).toBe(0);
    expect(out.rejected[0]?.reason).toMatch(/unknown atmosphere/);
  });

  it("accepts splitScene with valid two halves", () => {
    const out = validatePatches(
      [
        {
          sceneId: "s02",
          action: "splitScene",
          firstText: "First half.",
          secondText: "Second half.",
          why: "too long",
        },
      ],
      SCRIPT,
      KNOWN,
    );
    expect(out.patches.length).toBe(1);
  });

  it("rejects splitScene with missing halves", () => {
    expect(
      validatePatches(
        [{ sceneId: "s02", action: "splitScene", firstText: "x", why: "y" }],
        SCRIPT,
        KNOWN,
      ).patches.length,
    ).toBe(0);
  });

  it("rejects splitScene with unknown secondTemplate", () => {
    const out = validatePatches(
      [
        {
          sceneId: "s02",
          action: "splitScene",
          firstText: "a",
          secondText: "b",
          secondTemplate: "made-up",
          why: "y",
        },
      ],
      SCRIPT,
      KNOWN,
    );
    expect(out.patches.length).toBe(0);
    expect(out.rejected[0]?.reason).toMatch(/unknown secondTemplate/);
  });

  it("rejects fixBorders with empty cssOverride", () => {
    expect(
      validatePatches(
        [{ sceneId: "s01", action: "fixBorders", cssOverride: "", why: "y" }],
        SCRIPT,
        KNOWN,
      ).patches.length,
    ).toBe(0);
  });

  it("rejects fixBorders with cssOverride too long", () => {
    expect(
      validatePatches(
        [
          {
            sceneId: "s01",
            action: "fixBorders",
            cssOverride: "a".repeat(5000),
            why: "y",
          },
        ],
        SCRIPT,
        KNOWN,
      ).patches.length,
    ).toBe(0);
  });

  it("clamps estimatedRetentionDelta to [-100, 100]", () => {
    const out = validatePatches(
      [
        {
          sceneId: "s01",
          action: "editText",
          text: "x",
          why: "y",
          estimatedRetentionDelta: 9999,
        },
        {
          sceneId: "s01",
          action: "editText",
          text: "x",
          why: "y",
          estimatedRetentionDelta: -9999,
        },
      ],
      SCRIPT,
      KNOWN,
    );
    expect(out.patches[0]?.estimatedRetentionDelta).toBe(100);
    expect(out.patches[1]?.estimatedRetentionDelta).toBe(-100);
  });
});

describe("applyPatches", () => {
  it("does not mutate the input script", () => {
    const before = JSON.stringify(SCRIPT);
    applyPatches(SCRIPT, [{ sceneId: "s01", action: "editText", text: "Changed.", why: "y" }]);
    expect(JSON.stringify(SCRIPT)).toBe(before);
  });

  it("applies an editText patch and reports the scene as dirty (re-synth)", () => {
    const result = applyPatches(SCRIPT, [
      { sceneId: "s01", action: "editText", text: "Stronger hook.", why: "y" },
    ]);
    expect(result.script.scenes[0]?.text).toBe("Stronger hook.");
    expect(result.resynthSceneIds).toEqual(["s01"]);
  });

  it("applies a swapTemplate patch and replaces props", () => {
    const result = applyPatches(SCRIPT, [
      {
        sceneId: "s02",
        action: "swapTemplate",
        newTemplate: "kinetic-words",
        newProps: { words: ["new", "energy"] },
        why: "y",
      },
    ]);
    expect(result.script.scenes[1]?.template).toBe("kinetic-words");
    expect(result.script.scenes[1]?.props).toEqual({ words: ["new", "energy"] });
    // Template swap doesn't change narration, so no re-synth
    expect(result.resynthSceneIds).toEqual([]);
  });

  it("applies addProp without disturbing other props", () => {
    const result = applyPatches(SCRIPT, [
      {
        sceneId: "s02",
        action: "addProp",
        key: "accentWord",
        value: "playbook",
        why: "y",
      },
    ]);
    expect(result.script.scenes[1]?.props).toEqual({
      stat: 100,
      accentWord: "playbook",
    });
  });

  it("splitScene expands one scene into two and dirties both", () => {
    const result = applyPatches(SCRIPT, [
      {
        sceneId: "s02",
        action: "splitScene",
        firstText: "First half.",
        secondText: "Second half.",
        why: "y",
      },
    ]);
    expect(result.script.scenes.length).toBe(4);
    expect(result.script.scenes[1]?.id).toBe("s02");
    expect(result.script.scenes[1]?.text).toBe("First half.");
    expect(result.script.scenes[2]?.id).toBe("s02-split-1");
    expect(result.script.scenes[2]?.text).toBe("Second half.");
    expect(result.resynthSceneIds).toEqual(["s02", "s02-split-1"]);
  });

  it("applies multiple patches in order on the same scene", () => {
    const result = applyPatches(SCRIPT, [
      { sceneId: "s01", action: "editText", text: "A.", why: "y" },
      { sceneId: "s01", action: "addProp", key: "accentWord", value: "A", why: "y" },
    ]);
    expect(result.script.scenes[0]?.text).toBe("A.");
    expect(result.script.scenes[0]?.props).toEqual({ accentWord: "A" });
    expect(result.appliedLog.length).toBe(2);
  });

  it("fixBorders writes cssOverride into props", () => {
    const result = applyPatches(SCRIPT, [
      {
        sceneId: "s01",
        action: "fixBorders",
        cssOverride: "#hook { overflow: hidden; }",
        why: "y",
      },
    ]);
    expect(result.script.scenes[0]?.props.cssOverride).toBe("#hook { overflow: hidden; }");
  });
});

describe("nextSceneId", () => {
  it("returns the first non-colliding split id", () => {
    expect(nextSceneId(SCRIPT, [], "s01")).toBe("s01-split-1");
  });

  it("skips ids that already exist in alreadyAdded", () => {
    expect(
      nextSceneId(
        SCRIPT,
        [{ id: "s01-split-1", text: "x", template: "outro-cta", props: {} }],
        "s01",
      ),
    ).toBe("s01-split-2");
  });
});

describe("isImprovement", () => {
  const baseline = {
    overallRetentionScore: 70,
    perScene: [
      { sceneId: "s01", visualHook: 8, paceMatch: 8, onBrand: 9 },
      { sceneId: "s02", visualHook: 6, paceMatch: 7, onBrand: 8 },
    ],
  };

  it("flags an improvement when overall rises and no scene regresses badly", () => {
    const next = {
      overallRetentionScore: 78,
      perScene: [
        { sceneId: "s01", visualHook: 8, paceMatch: 8, onBrand: 9 },
        { sceneId: "s02", visualHook: 8, paceMatch: 8, onBrand: 8 },
      ],
    };
    const v = isImprovement(baseline, next);
    expect(v.improved).toBe(true);
    expect(v.delta).toBe(8);
    expect(v.regressedScenes).toEqual([]);
  });

  it("flags a regression when overall drops", () => {
    const next = {
      overallRetentionScore: 65,
      perScene: baseline.perScene,
    };
    const v = isImprovement(baseline, next);
    expect(v.improved).toBe(false);
    expect(v.delta).toBe(-5);
  });

  it("flags a regression when a single scene drops by ≥3 even if overall rises", () => {
    const next = {
      overallRetentionScore: 75,
      perScene: [
        // s01 went from 8 → 4 — bad scene regression
        { sceneId: "s01", visualHook: 4, paceMatch: 8, onBrand: 9 },
        { sceneId: "s02", visualHook: 9, paceMatch: 9, onBrand: 9 },
      ],
    };
    const v = isImprovement(baseline, next);
    expect(v.improved).toBe(false);
    expect(v.regressedScenes).toContain("s01");
  });
});
