import { describe, it, expect } from "vitest";
import {
  auditWordBudget,
  countWords,
  extractDataPoints,
  pickAccentWord,
  pickImageId,
  pickOnScreenHeadline,
  pickOnScreenSubtext,
  summarizeScene,
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
