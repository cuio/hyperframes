import { describe, it, expect } from "vitest";
import { BUILTIN_CHARTS, getChart } from "./builtin.js";
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

const ctx = { chartId: "test-chart", width: 1620, height: 700, tokens: TOKENS };

describe("BUILTIN_CHARTS catalog", () => {
  it("includes the three editorial-pack additions", () => {
    const ids = BUILTIN_CHARTS.map((c) => c.id);
    expect(ids).toContain("lollipop-timeline");
    expect(ids).toContain("grouped-bars");
    expect(ids).toContain("annotated-area");
  });
  it("exposes each chart via getChart()", () => {
    expect(getChart("lollipop-timeline")?.id).toBe("lollipop-timeline");
    expect(getChart("grouped-bars")?.id).toBe("grouped-bars");
    expect(getChart("annotated-area")?.id).toBe("annotated-area");
    expect(getChart("nonexistent")).toBeUndefined();
  });
});

describe("lollipop-timeline render", () => {
  const chart = getChart("lollipop-timeline")!;

  it("renders an SVG with one lollipop group per event", () => {
    const html = chart.render(
      {
        events: [
          { date: "11 Feb", label: "Coinbase ships Agentic Wallets", category: "coinbase" },
          { date: "09 Mar", label: "Armstrong: 'more agents than humans'", category: "clawbank" },
          { date: "21 Apr", label: "Coinbase launches Agentic.market", category: "coinbase" },
        ],
        categories: [
          { id: "coinbase", name: "Coinbase / wallet layer", color: "secondary" },
          { id: "clawbank", name: "ClawBank / agent-as-actor layer", color: "primary" },
        ],
      },
      ctx,
    );
    expect(html).toContain("<svg");
    expect((html.match(/hf-lollipop hf-lollipop-/g) ?? []).length).toBe(3);
    expect((html.match(/hf-lollipop-stem/g) ?? []).length).toBe(3);
    expect((html.match(/hf-lollipop-dot/g) ?? []).length).toBe(3);
    expect(html).toContain("11 Feb");
    expect(html).toContain("09 Mar");
    expect(html).toContain("Coinbase / wallet layer");
  });

  it("falls back to accent color for events with unknown category", () => {
    const html = chart.render(
      {
        events: [{ date: "11 Feb", label: "uncategorized", category: "ghost" }],
      },
      ctx,
    );
    expect(html).toContain(TOKENS.colors.accent);
  });

  it("returns empty string when no events provided", () => {
    expect(chart.render({ events: [] }, ctx)).toBe("");
  });
});

describe("grouped-bars render", () => {
  const chart = getChart("grouped-bars")!;

  it("renders one bar per series-group cell with value labels", () => {
    const html = chart.render(
      {
        groups: ["GitHub Copilot", "Cursor", "Claude Code"],
        series: [
          { name: "Apr-Jun 2025", values: [27, 14, 3], color: "muted" },
          {
            name: "Jan 2026",
            values: [29, 18, 18],
            color: "secondary",
            highlightIndex: 2,
            highlightColor: "primary",
          },
        ],
        valueFormat: "percent",
        annotation: {
          text: "6x growth in 9 months",
          targetGroup: 2,
          targetSeries: 1,
          position: "right",
        },
      },
      ctx,
    );
    // 3 groups × 2 series = 6 bars
    expect((html.match(/class="hf-bar"/g) ?? []).length).toBe(6);
    expect((html.match(/class="hf-bar-val"/g) ?? []).length).toBe(6);
    // Highlighted bar uses accent (primary), other Jan 2026 bars use accent2 (secondary)
    expect(html).toContain(TOKENS.colors.accent);
    expect(html).toContain(TOKENS.colors.accent2);
    // Annotation pill rendered
    expect(html).toContain("hf-pill");
    expect(html).toContain("hf-pill-leader");
    // Group labels present
    expect(html).toContain("GitHub Copilot");
    expect(html).toContain("Claude Code");
    // Y-axis ticks rendered as percent
    expect(html).toContain("%");
  });

  it("renders gridlines for the y-axis", () => {
    const html = chart.render(
      {
        groups: ["A", "B"],
        series: [{ name: "S1", values: [10, 20], color: "primary" }],
      },
      ctx,
    );
    expect((html.match(/hf-grid-line/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect((html.match(/hf-axis-label/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it("skips bars where the value is null", () => {
    const html = chart.render(
      {
        groups: ["A", "B", "C"],
        series: [{ name: "S1", values: [10, null, 30], color: "primary" }],
      },
      ctx,
    );
    // Only 2 bars should render (B has null)
    expect((html.match(/class="hf-bar"/g) ?? []).length).toBe(2);
  });

  it("returns empty string when no groups or series", () => {
    expect(chart.render({ groups: [], series: [{ name: "x", values: [1] }] }, ctx)).toBe("");
    expect(chart.render({ groups: ["A"], series: [] }, ctx)).toBe("");
  });
});

describe("annotated-area render", () => {
  const chart = getChart("annotated-area")!;

  it("renders the area + line + markers + endpoint labels", () => {
    const html = chart.render(
      {
        points: [
          { x: "11 Feb", y: 0 },
          { x: "18 Feb", y: 5 },
          { x: "25 Feb", y: 22 },
          { x: "04 Mar", y: 38 },
          { x: "09 Mar", y: 50 },
        ],
        valueFormat: "compact-count",
        startLabel: "0",
        endLabel: "50M+",
        annotation: {
          text: "26 days from launch to 50M",
          targetIndex: 2,
          position: "above",
        },
      },
      ctx,
    );
    expect(html).toContain("<svg");
    expect(html).toContain("hf-fill");
    expect(html).toContain("hf-line-a");
    expect((html.match(/hf-marker hf-marker-/g) ?? []).length).toBe(5);
    expect(html).toContain("hf-label-a");
    expect(html).toContain("hf-label-b");
    expect(html).toContain("0</text>"); // startLabel
    expect(html).toContain("50M+</text>"); // endLabel
    expect(html).toContain("hf-pill");
    expect(html).toContain("11 Feb");
    expect(html).toContain("09 Mar");
  });

  it("auto-formats endpoint labels when not overridden", () => {
    const html = chart.render(
      {
        points: [
          { x: "Q1", y: 100 },
          { x: "Q2", y: 1400 },
        ],
        valueFormat: "compact-count",
      },
      ctx,
    );
    expect(html).toContain("100</text>");
    expect(html).toContain("1.4K</text>");
  });

  it("returns empty string when fewer than 2 points", () => {
    expect(chart.render({ points: [{ x: "Q1", y: 1 }] }, ctx)).toBe("");
  });
});
