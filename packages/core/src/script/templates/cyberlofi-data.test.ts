import { describe, it, expect } from "vitest";
import {
  GLITCH_BAR_CHART_TEMPLATE,
  CYBER_COUNTER_BURST_TEMPLATE,
  DATA_STREAM_REVEAL_TEMPLATE,
  CYBER_COMPARISON_TEMPLATE,
  CYBERLOFI_DATA_TEMPLATES,
} from "./cyberlofi-data.js";
import { BUILTIN_TEMPLATES } from "./builtin.js";
import type { TemplateRenderContext } from "./types.js";
import { CYBERLOFI } from "../themes.js";

const ctx = (sceneId: string): TemplateRenderContext => ({
  sceneId,
  durationSeconds: 4,
  isHook: false,
  tokens: CYBERLOFI,
});

describe("cyberlofi-data templates registration", () => {
  it("exports 4 templates with the expected ids", () => {
    expect(CYBERLOFI_DATA_TEMPLATES).toHaveLength(4);
    expect(CYBERLOFI_DATA_TEMPLATES.map((t) => t.id)).toEqual([
      "glitch-bar-chart",
      "cyber-counter-burst",
      "data-stream-reveal",
      "cyber-comparison",
    ]);
  });

  it("are all registered in BUILTIN_TEMPLATES", () => {
    const ids = new Set(BUILTIN_TEMPLATES.map((t) => t.id));
    for (const t of CYBERLOFI_DATA_TEMPLATES) {
      expect(ids.has(t.id)).toBe(true);
    }
  });

  it("are unique across BUILTIN_TEMPLATES", () => {
    const ids = BUILTIN_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("glitch-bar-chart", () => {
  it("renders title + bars + scoped scene wrapper", () => {
    const html = GLITCH_BAR_CHART_TEMPLATE.render(
      {
        title: "BOT TRAFFIC",
        eyebrow: "ANNUAL SHARE",
        bars: [
          { label: "2019", value: 37, valueLabel: "37%" },
          { label: "2024", value: 49.6, valueLabel: "49.6%", highlight: true },
        ],
        sourceTag: "Imperva 2024",
      },
      ctx("s01"),
    );
    expect(html).toContain('id="s01"');
    expect(html).toContain('data-composition-id="s01"');
    expect(html).toContain("BOT TRAFFIC");
    expect(html).toContain("ANNUAL SHARE");
    expect(html).toContain("2024");
    expect(html).toContain("49.6%");
    expect(html).toContain("Imperva 2024");
    // Continuous-motion keyframes registered
    expect(html).toContain("gbc-scan-s01");
    // Timeline registered
    expect(html).toContain("window.__timelines['s01']");
  });

  it("caps bars at 8 even if more passed", () => {
    const bars = Array.from({ length: 20 }, (_, i) => ({
      label: `${i}`,
      value: i * 5,
    }));
    const html = GLITCH_BAR_CHART_TEMPLATE.render({ title: "x", bars }, ctx("s02"));
    // 8 bars → 8 .gbc-col entries
    const matches = html.match(/class="gbc-col"/g) ?? [];
    expect(matches.length).toBe(8);
  });

  it("escapes user-supplied labels and values", () => {
    const html = GLITCH_BAR_CHART_TEMPLATE.render(
      {
        title: "<script>",
        bars: [{ label: "<x>", value: 50, valueLabel: "<img>" }],
      },
      ctx("s03"),
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;x&gt;");
    expect(html).toContain("&lt;img&gt;");
  });
});

describe("cyber-counter-burst", () => {
  it("renders 3-layer chromatic counter stack with timeline", () => {
    const html = CYBER_COUNTER_BURST_TEMPLATE.render(
      {
        stat: 49.6,
        statSuffix: "%",
        eyebrow: "BOTS",
        undertext: "of all global web traffic in 2024",
        sourceTag: "Imperva Bad Bot Report",
      },
      ctx("s04"),
    );
    expect(html).toContain("BOTS");
    expect(html).toContain("of all global web traffic in 2024");
    expect(html).toContain("ccb-counter");
    expect(html).toContain("ccb-counter-r");
    expect(html).toContain("ccb-counter-g");
    expect(html).toContain("Imperva Bad Bot Report");
    expect(html).toContain("window.__timelines['s04']");
    // Decimal stat → toFixed(1) in JS
    expect(html).toContain("v.toFixed(1)");
  });

  it("uses Math.round for integer stats", () => {
    const html = CYBER_COUNTER_BURST_TEMPLATE.render({ stat: 1000, statSuffix: "" }, ctx("s05"));
    expect(html).toContain("Math.round(v)");
  });

  it("falls back to 0 when stat is missing", () => {
    const html = CYBER_COUNTER_BURST_TEMPLATE.render({}, ctx("s06"));
    expect(html).toContain('data-cnt="0"');
  });
});

describe("data-stream-reveal", () => {
  it("renders accent + stream + continuous scroll keyframe", () => {
    const html = DATA_STREAM_REVEAL_TEMPLATE.render(
      {
        accentWord: "SIGNAL",
        streamLines: [
          "lat 41.878 lng -87.624",
          "frame 042 / 99",
          "ID 7C3F-A2-8F",
          "uid 0x9f3...0a1",
          "ts 2024-11-04T03:21:08Z",
          "src 192.0.2.42",
          "agent bot.v3.4",
          "lvl warning",
        ],
        undertext: 'every comment, every reply, every "person" — bot first',
        cornerTag: "FRAME 042 / 99",
      },
      ctx("s07"),
    );
    expect(html).toContain("SIGNAL");
    expect(html).toContain("lat 41.878 lng -87.624");
    expect(html).toContain("FRAME 042 / 99");
    // Continuous scroll keyframe
    expect(html).toContain("dsr-scroll-s07");
    expect(html).toContain("window.__timelines['s07']");
  });

  it("clips long stream lines to 80 chars", () => {
    const long = "a".repeat(200);
    const html = DATA_STREAM_REVEAL_TEMPLATE.render(
      { accentWord: "x", streamLines: [long] },
      ctx("s08"),
    );
    // The escaped line should be at most 80 a's
    const match = html.match(/<div class="dsr-line">(a+)<\/div>/);
    expect(match).not.toBeNull();
    expect((match![1] ?? "").length).toBe(80);
  });

  it("uppercases and clips the accent word", () => {
    const html = DATA_STREAM_REVEAL_TEMPLATE.render(
      { accentWord: "this is too long for one slot", streamLines: ["x"] },
      ctx("s09"),
    );
    expect(html).toContain("THIS IS TOO LO");
    expect(html).not.toContain("THIS IS TOO LON");
  });
});

describe("cyber-comparison", () => {
  it("renders left + right panels with values, labels, and pixel-bar fills", () => {
    const html = CYBER_COMPARISON_TEMPLATE.render(
      {
        heading: "INTERNET FLIPPED",
        left: { label: "2015", value: "90%", fill: 90 },
        right: { label: "2024", value: "<40%", fill: 38 },
        footnote: "human-written content share",
      },
      ctx("s10"),
    );
    expect(html).toContain("INTERNET FLIPPED");
    expect(html).toContain('class="ccm-side left"');
    expect(html).toContain('class="ccm-side right"');
    expect(html).toContain("2015");
    expect(html).toContain("90%");
    expect(html).toContain("2024");
    expect(html).toContain("&lt;40%");
    expect(html).toContain('data-target="90"');
    expect(html).toContain('data-target="38"');
    expect(html).toContain("human-written content share");
    expect(html).toContain("window.__timelines['s10']");
  });

  it("clamps fill values out of [0, 100]", () => {
    const html = CYBER_COMPARISON_TEMPLATE.render(
      {
        heading: "x",
        left: { label: "a", value: "1", fill: -50 },
        right: { label: "b", value: "2", fill: 250 },
      },
      ctx("s11"),
    );
    expect(html).toContain('data-target="0"');
    expect(html).toContain('data-target="100"');
  });
});

describe("default atmosphere routing", () => {
  it("maps cyber-* data templates to glitch-decay atmosphere", async () => {
    const { defaultAtmosphereForTemplate } = await import("../atmosphere/builtin.js");
    expect(defaultAtmosphereForTemplate("glitch-bar-chart")).toBe("glitch-decay");
    expect(defaultAtmosphereForTemplate("cyber-counter-burst")).toBe("glitch-decay");
    expect(defaultAtmosphereForTemplate("data-stream-reveal")).toBe("glitch-decay");
    expect(defaultAtmosphereForTemplate("cyber-comparison")).toBe("glitch-decay");
  });
});
