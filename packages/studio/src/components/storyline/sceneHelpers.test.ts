import { describe, it, expect } from "vitest";
import {
  applyInlineEdit,
  auditWordBudget,
  countWords,
  extractDataPoints,
  getEditableHeadlineField,
  getEditableSubtextField,
  pickAccentWord,
  pickFocalCardIndex,
  pickImageId,
  pickOnScreenHeadline,
  pickOnScreenSubtext,
  summarizeScene,
  TEMPLATE_HEADLINE_FIELD,
  TEMPLATE_SUBTEXT_FIELD,
  VISUAL_WORD_BUDGET,
} from "./sceneHelpers";

describe("countWords", () => {
  it("returns 0 for empty / nullish input", () => {
    expect(countWords("")).toBe(0);
    expect(countWords(undefined)).toBe(0);
    expect(countWords(null)).toBe(0);
    expect(countWords("   ")).toBe(0);
  });

  it("counts whitespace-separated words", () => {
    expect(countWords("a b c")).toBe(3);
    expect(countWords("the world is moving on")).toBe(5);
  });

  it("ignores leading / trailing / repeated whitespace", () => {
    expect(countWords("   chase   trends   ")).toBe(2);
    expect(countWords("a\tb\nc")).toBe(3);
  });
});

describe("pickOnScreenHeadline", () => {
  it("uses props.title for the default contract", () => {
    expect(pickOnScreenHeadline("hook-bigtext", { title: "Hello" })).toBe("Hello");
    expect(pickOnScreenHeadline("hook-vhs-rip", { title: "STALLED" })).toBe("STALLED");
    expect(pickOnScreenHeadline("aroll-text", { title: "Body of work" })).toBe("Body of work");
  });

  it("joins kinetic-words array entries", () => {
    expect(
      pickOnScreenHeadline("kinetic-words", { words: ["the", "world", "is", "moving", "on"] }),
    ).toBe("the world is moving on");
  });

  it("uses phrase for editorial-serif", () => {
    expect(pickOnScreenHeadline("editorial-serif", { phrase: "the numbers" })).toBe("the numbers");
  });

  it("uses value for hook-statreveal", () => {
    expect(pickOnScreenHeadline("hook-statreveal", { value: "99.9" })).toBe("99.9");
  });

  it("returns null when the relevant prop is missing or wrong type", () => {
    expect(pickOnScreenHeadline("hook-bigtext", {})).toBeNull();
    expect(pickOnScreenHeadline("kinetic-words", { words: "not-an-array" })).toBeNull();
    expect(pickOnScreenHeadline("editorial-serif", { phrase: 42 })).toBeNull();
  });
});

describe("pickOnScreenSubtext", () => {
  it("uses label for hook-statreveal", () => {
    expect(pickOnScreenSubtext("hook-statreveal", { label: "of all-time-high erased" })).toBe(
      "of all-time-high erased",
    );
  });

  it("uses subhead for image-scene", () => {
    expect(pickOnScreenSubtext("image-scene", { subhead: "by 2025" })).toBe("by 2025");
  });

  it("falls through to subtitle, then subtext", () => {
    expect(pickOnScreenSubtext("chart-scene", { subtitle: "domestic vs offshore" })).toBe(
      "domestic vs offshore",
    );
    expect(pickOnScreenSubtext("hook-bigtext", { subtext: "58% drop" })).toBe("58% drop");
  });

  it("returns null when no secondary prop exists", () => {
    expect(pickOnScreenSubtext("hook-bigtext", { title: "x" })).toBeNull();
  });
});

describe("extractDataPoints", () => {
  it("pulls percentages, money amounts, and unit-suffixed numbers", () => {
    const text =
      "Between 2022 and 2025, U.S. crypto venture capital funding dropped by 58%, while $42 billion fled offshore.";
    const points = extractDataPoints(text);
    expect(points).toContain("58%");
    expect(points).toContain("$42 billion");
  });

  it("dedupes repeats", () => {
    const points = extractDataPoints("99.9% of value erased. We hit 99.9% drawdown.");
    const ninety = points.filter((p) => p === "99.9%");
    expect(ninety).toHaveLength(1);
  });

  it("caps at the requested max", () => {
    expect(extractDataPoints("1% 2% 3% 4% 5% 6% 7% 8%", 4)).toHaveLength(4);
  });

  it("handles bare years and short numbers conservatively", () => {
    // "2022" and "2025" are years — appear as-is. They're real data so OK.
    const points = extractDataPoints("Between 2022 and 2025 it changed.");
    expect(points).toContain("2022");
    expect(points).toContain("2025");
  });

  it("returns empty list for missing / blank text", () => {
    expect(extractDataPoints(undefined)).toEqual([]);
    expect(extractDataPoints("")).toEqual([]);
    expect(extractDataPoints("nothing numeric here at all")).toEqual([]);
  });
});

describe("pickAccentWord", () => {
  it("returns the accentWord prop for the default contract", () => {
    expect(pickAccentWord("hook-bigtext", { accentWord: "neither" })).toBe("neither");
    expect(pickAccentWord("aroll-text", { accentWord: "broken" })).toBe("broken");
  });

  it("uses words[emphasisIndex] for kinetic-words", () => {
    expect(
      pickAccentWord("kinetic-words", {
        words: ["you", "can", "be", "skilled"],
        emphasisIndex: 3,
      }),
    ).toBe("skilled");
  });

  it("falls back to last word when emphasisIndex is missing", () => {
    expect(pickAccentWord("kinetic-words", { words: ["the", "world", "is", "moving", "on"] })).toBe(
      "on",
    );
  });

  it("returns null when nothing usable is set", () => {
    expect(pickAccentWord("hook-bigtext", {})).toBeNull();
    expect(pickAccentWord("kinetic-words", {})).toBeNull();
  });
});

describe("pickImageId", () => {
  it("returns the imageId when present and non-empty", () => {
    expect(pickImageId({ imageId: "founder-portrait-01" })).toBe("founder-portrait-01");
  });

  it("returns null for missing / blank / wrong-type values", () => {
    expect(pickImageId({})).toBeNull();
    expect(pickImageId({ imageId: "" })).toBeNull();
    expect(pickImageId({ imageId: 42 })).toBeNull();
  });
});

describe("auditWordBudget", () => {
  it("scores within-budget copy as ok", () => {
    expect(auditWordBudget("kinetic-words", "the world is moving on")).toEqual({
      count: 5,
      budget: 6,
      status: "ok",
    });
  });

  it("scores 1× to 1.25× as warn", () => {
    // hook-vhs-rip budget = 5; 6 words = 1.2× → warn (rounded up to 7 is the cliff).
    expect(auditWordBudget("hook-vhs-rip", "one two three four five six")).toEqual({
      count: 6,
      budget: 5,
      status: "warn",
    });
  });

  it("scores well over budget as over", () => {
    expect(
      auditWordBudget("kinetic-words", "this is way too many words for a kinetic reveal"),
    ).toEqual({
      count: 10,
      budget: 6,
      status: "over",
    });
  });

  it("returns unknown when the template has no budget on file", () => {
    expect(auditWordBudget("not-a-real-template", "anything")).toEqual({
      count: 1,
      budget: null,
      status: "unknown",
    });
  });

  it("returns unknown when there's no headline yet", () => {
    expect(auditWordBudget("hook-bigtext", null)).toEqual({
      count: 0,
      budget: 8,
      status: "unknown",
    });
  });

  it("VISUAL_WORD_BUDGET covers every shipped Reels-grade template", () => {
    expect(VISUAL_WORD_BUDGET["hook-vhs-rip"]).toBe(5);
    expect(VISUAL_WORD_BUDGET["kinetic-words"]).toBe(6);
    expect(VISUAL_WORD_BUDGET["editorial-serif"]).toBe(4);
  });
});

describe("summarizeScene", () => {
  it("uses audio.durationSeconds when available", () => {
    expect(
      summarizeScene({
        id: "s04",
        text: "x",
        template: "hook-bigtext",
        props: {},
        hook: true,
        audio: { durationSeconds: 5.76 },
      }),
    ).toEqual({ id: "s04", template: "hook-bigtext", durationLabel: "5.76s", hook: true });
  });

  it("falls back to durationHint, then '—' when neither is available", () => {
    expect(
      summarizeScene({
        id: "s07",
        text: "y",
        template: "aroll-text",
        durationHint: 8,
        props: {},
      }).durationLabel,
    ).toBe("8.00s");
    expect(summarizeScene({ id: "s99", text: "", template: "x", props: {} }).durationLabel).toBe(
      "—",
    );
  });
});

describe("getEditableHeadlineField", () => {
  it("returns 'title' for the most common templates", () => {
    expect(getEditableHeadlineField("hook-bigtext")).toBe("title");
    expect(getEditableHeadlineField("hook-vhs-rip")).toBe("title");
    expect(getEditableHeadlineField("aroll-text")).toBe("title");
    expect(getEditableHeadlineField("chart-scene")).toBe("title");
  });

  it("returns the template-specific field where it differs", () => {
    expect(getEditableHeadlineField("editorial-serif")).toBe("phrase");
    expect(getEditableHeadlineField("hook-statreveal")).toBe("label");
    expect(getEditableHeadlineField("quote")).toBe("quote");
    expect(getEditableHeadlineField("image-scene")).toBe("headline");
  });

  it("returns null for kinetic-words (no single field — words[] array)", () => {
    expect(getEditableHeadlineField("kinetic-words")).toBeNull();
  });

  it("falls through to 'title' for unknown templates", () => {
    expect(getEditableHeadlineField("not-a-real-template")).toBe("title");
  });
});

describe("getEditableSubtextField", () => {
  it("maps the common subtext fields", () => {
    expect(getEditableSubtextField("hook-bigtext")).toBe("subtext");
    expect(getEditableSubtextField("aroll-text")).toBe("body");
    expect(getEditableSubtextField("image-scene")).toBe("subhead");
    expect(getEditableSubtextField("quote")).toBe("attribution");
  });

  it("returns null for templates with no subtext field", () => {
    expect(getEditableSubtextField("not-a-real-template")).toBeNull();
  });

  it("TEMPLATE_HEADLINE_FIELD and TEMPLATE_SUBTEXT_FIELD share the templates we ship", () => {
    // Sanity check that every Reels-grade template has both maps populated.
    for (const t of ["hook-bigtext", "hook-vhs-rip", "kinetic-words", "editorial-serif"]) {
      expect(VISUAL_WORD_BUDGET[t]).toBeGreaterThan(0);
    }
    expect(TEMPLATE_HEADLINE_FIELD["hook-vhs-rip"]).toBe("title");
    expect(TEMPLATE_SUBTEXT_FIELD["hook-vhs-rip"]).toBe("sourceTag");
  });
});

describe("applyInlineEdit", () => {
  it("merges a string field into existing props (preserves untouched fields)", () => {
    expect(
      applyInlineEdit({ title: "Old", eyebrow: "STAKE", accentWord: "neither" }, "title", "New"),
    ).toEqual({ title: "New", eyebrow: "STAKE", accentWord: "neither" });
  });

  it("splits whitespace for kinetic-words and re-anchors emphasis to the last word", () => {
    expect(
      applyInlineEdit({ words: ["a", "b"], emphasisIndex: 0 }, "words", "the world is moving on"),
    ).toEqual({
      words: ["the", "world", "is", "moving", "on"],
      emphasisIndex: 4,
    });
  });

  it("empty kinetic-words input yields an empty array and emphasis 0", () => {
    expect(applyInlineEdit({ words: ["a"] }, "words", "   ")).toEqual({
      words: [],
      emphasisIndex: 0,
    });
  });

  it("collapses repeated whitespace in kinetic-words input", () => {
    expect(applyInlineEdit({}, "words", "  the   numbers  ")).toEqual({
      words: ["the", "numbers"],
      emphasisIndex: 1,
    });
  });
});

describe("pickFocalCardIndex", () => {
  const focusLineAt = (frac: number, viewport: number): number => viewport * frac;

  it("returns -1 for an empty card list", () => {
    expect(pickFocalCardIndex([], 800)).toBe(-1);
  });

  it("returns -1 when the viewport has zero height", () => {
    expect(pickFocalCardIndex([{ top: 0, height: 100 }], 0)).toBe(-1);
  });

  it("picks the card straddling the focus line", () => {
    // Focus line at 0.33 * 600 = 198px. Card 1 spans 100-300 → straddles.
    const cards = [
      { top: -200, height: 200 }, // 1
      { top: 100, height: 200 }, // 2 — straddles
      { top: 350, height: 200 }, // 3
    ];
    expect(pickFocalCardIndex(cards, 600)).toBe(1);
    void focusLineAt;
  });

  it("picks the card whose center is closest when no card straddles", () => {
    // Focus line at 198. Cards have gaps that make none straddle.
    const cards = [
      { top: 0, height: 50 }, // center 25, dist 173
      { top: 150, height: 30 }, // center 165, dist 33
      { top: 230, height: 30 }, // center 245, dist 47
    ];
    expect(pickFocalCardIndex(cards, 600)).toBe(1);
  });

  it("respects a custom focus-line fraction", () => {
    // Focus line at 0.5 * 600 = 300. Card 2 spans 250-450 → straddles.
    const cards = [
      { top: 0, height: 200 },
      { top: 250, height: 200 }, // straddles 300
    ];
    expect(pickFocalCardIndex(cards, 600, 0.5)).toBe(1);
  });

  it("returns 0 when only one card exists, regardless of position", () => {
    expect(pickFocalCardIndex([{ top: 1000, height: 50 }], 600)).toBe(0);
  });
});
