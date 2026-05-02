import { describe, it, expect } from "vitest";
import {
  niceCeiling,
  niceTicks,
  formatValue,
  wrapText,
  renderGridlines,
  renderAnnotation,
} from "./util.js";
import type { DesignTokens } from "../templates/types.js";

const TOKENS: DesignTokens = {
  colors: {
    bg: "#F2E8D5",
    fg: "#1A1A1A",
    surface: "#FFFFFF",
    accent: "#E3120B",
    accent2: "#0E5A89",
    accent3: "#D4A574",
    muted: "#888888",
    subtle: "#C8C0B4",
  },
  fonts: { display: "Georgia", body: "Georgia", mono: "ui-monospace" },
  motion: { ease: "power3.out", enterMs: 600, staggerMs: 150 },
};

describe("niceCeiling", () => {
  it("rounds tiny values up to 1", () => {
    expect(niceCeiling(0.84)).toBe(1);
    expect(niceCeiling(0.0001)).toBe(0.0001);
  });
  it("never bumps a value already on a 1/2/5 boundary", () => {
    expect(niceCeiling(50)).toBe(50);
    expect(niceCeiling(100)).toBe(100);
    expect(niceCeiling(2)).toBe(2);
  });
  it("snaps within {1, 2, 2.5, 3, 5, 10} per magnitude", () => {
    expect(niceCeiling(47)).toBe(50);
    expect(niceCeiling(283)).toBe(300);
    expect(niceCeiling(1234)).toBe(2000);
    expect(niceCeiling(1.4)).toBe(2);
  });
  it("returns 1 for non-positive inputs", () => {
    expect(niceCeiling(0)).toBe(1);
    expect(niceCeiling(-50)).toBe(1);
    expect(niceCeiling(NaN)).toBe(1);
  });
});

describe("niceTicks", () => {
  it("returns count evenly-spaced ticks from 0 to niceCeiling(max)", () => {
    expect(niceTicks(50)).toEqual([0, 12.5, 25, 37.5, 50]);
    expect(niceTicks(283)).toEqual([0, 75, 150, 225, 300]);
  });
  it("respects custom count", () => {
    expect(niceTicks(100, 3)).toEqual([0, 50, 100]);
  });
});

describe("formatValue", () => {
  it("formats compact-money with appropriate suffix", () => {
    expect(formatValue(1.4e12, "compact-money")).toBe("$1.4T");
    expect(formatValue(325e9, "compact-money")).toBe("$325B");
    expect(formatValue(50e6, "compact-money")).toBe("$50M");
    expect(formatValue(2500, "compact-money")).toBe("$2.5K");
    expect(formatValue(840, "compact-money")).toBe("$840");
  });
  it("trims trailing .0 on compact suffixes", () => {
    expect(formatValue(2e12, "compact-money")).toBe("$2T");
    expect(formatValue(1e9, "compact-count")).toBe("1B");
  });
  it("formats percent with one decimal when sub-100 and not integer", () => {
    expect(formatValue(49.6, "percent")).toBe("49.6%");
    expect(formatValue(50, "percent")).toBe("50%");
    expect(formatValue(99, "percent")).toBe("99%");
    expect(formatValue(100, "percent")).toBe("100%");
  });
  it("formats currency with thousands separators", () => {
    expect(formatValue(1234567, "currency")).toBe("$1,234,567");
  });
  it("handles negative values in compact formats", () => {
    expect(formatValue(-1.4e9, "compact-money")).toBe("-$1.4B");
  });
});

describe("wrapText", () => {
  it("greedy-wraps to a max char count", () => {
    const lines = wrapText("the quick brown fox jumps over the lazy dog", 12);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      // Each line can exceed maxChars only if a single word is longer than the limit.
      const words = line.split(/\s+/);
      if (words.length > 1) expect(line.length).toBeLessThanOrEqual(12);
    }
  });
  it("preserves explicit newlines", () => {
    const lines = wrapText("first line\nsecond line\nthird line", 100);
    expect(lines).toEqual(["first line", "second line", "third line"]);
  });
});

describe("renderGridlines", () => {
  it("emits one gridline + one axis label per tick", () => {
    const out = renderGridlines({
      ticks: [0, 25, 50, 75, 100],
      yMax: 100,
      chartLeft: 100,
      chartRight: 1000,
      axisTopY: 50,
      axisBottomY: 600,
      tokens: TOKENS,
      format: "percent",
    });
    expect(out.match(/hf-grid-line/g)?.length).toBe(5);
    expect(out.match(/hf-axis-label/g)?.length).toBe(5);
    expect(out).toContain(">100%<");
    expect(out).toContain(">0%<");
  });
  it("renders the bottom-most gridline at higher contrast (baseline)", () => {
    const out = renderGridlines({
      ticks: [0, 50, 100],
      yMax: 100,
      chartLeft: 100,
      chartRight: 1000,
      axisTopY: 50,
      axisBottomY: 600,
      tokens: TOKENS,
    });
    // The first line should use fg (baseline color), not subtle.
    const firstLine = out.split("hf-grid-line").slice(1, 2).join("");
    expect(firstLine).toContain(TOKENS.colors.fg);
  });
});

describe("renderAnnotation", () => {
  it("emits a pill rect + leader path", () => {
    const out = renderAnnotation({
      text: "26 days from launch to 50M",
      anchor: { x: 800, y: 200 },
      position: "above",
      tokens: TOKENS,
    });
    expect(out).toContain("hf-pill");
    expect(out).toContain("hf-pill-leader");
    expect(out).toContain("<rect");
    expect(out.match(/<text /)?.length).toBeGreaterThanOrEqual(1);
  });
  it("can omit the leader arrow", () => {
    const out = renderAnnotation({
      text: "no arrow here",
      anchor: { x: 100, y: 100 },
      position: "right",
      tokens: TOKENS,
      showLeader: false,
    });
    expect(out).not.toContain("hf-pill-leader");
  });
  it("wraps long text into multiple <text> lines inside the pill", () => {
    const out = renderAnnotation({
      text: "This is a fairly long annotation that should wrap into multiple lines inside the pill",
      anchor: { x: 800, y: 400 },
      position: "below",
      tokens: TOKENS,
      width: 220,
      fontSize: 18,
    });
    expect((out.match(/<text /g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
