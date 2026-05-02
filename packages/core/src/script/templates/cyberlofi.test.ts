import { describe, it, expect } from "vitest";
import {
  CYBER_DATA_CLUSTER_TEMPLATE,
  CYBER_GLITCH_WORD_TEMPLATE,
  CYBER_PIXEL_STILL_TEMPLATE,
  CYBERLOFI_TEMPLATES,
} from "./cyberlofi.js";
import { BUILTIN_TEMPLATES } from "./builtin.js";
import { DEFAULT_TOKENS } from "./tokens.js";
import type { TemplateRenderContext } from "./types.js";
import { CYBERLOFI, getThemeByName } from "../themes.js";
import { getAtmosphere } from "../atmosphere/builtin.js";

const ctx = (sceneId: string, isHook = false): TemplateRenderContext => ({
  sceneId,
  durationSeconds: 4,
  isHook,
  tokens: CYBERLOFI,
});

describe("cyberlofi templates", () => {
  it("CYBERLOFI_TEMPLATES contains all 3 templates with stable ids", () => {
    expect(CYBERLOFI_TEMPLATES).toHaveLength(3);
    const ids = CYBERLOFI_TEMPLATES.map((t) => t.id);
    expect(ids).toEqual(["cyber-data-cluster", "cyber-glitch-word", "cyber-pixel-still"]);
  });

  it("all 3 templates are registered in BUILTIN_TEMPLATES", () => {
    const builtinIds = new Set(BUILTIN_TEMPLATES.map((t) => t.id));
    for (const t of CYBERLOFI_TEMPLATES) {
      expect(builtinIds.has(t.id)).toBe(true);
    }
  });

  it("template ids are unique across BUILTIN_TEMPLATES (no collision)", () => {
    const ids = BUILTIN_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("cyber-data-cluster", () => {
  it("renders valid HTML with the accent word and required scene wrapper", () => {
    const html = CYBER_DATA_CLUSTER_TEMPLATE.render(
      {
        accentWord: "TEMPLATE",
        dataLines: ["lat 41.878 lng -87.624", "frame 042 / 99", "ID 7C3F-A2"],
        cornerTag: "CHANNEL 03 / 99",
        footerTag: "STAGE 02 ▸ 05",
      },
      ctx("s01"),
    );
    expect(html).toContain('id="s01"');
    expect(html).toContain('data-composition-id="s01"');
    expect(html).toContain("TEMPLATE");
    expect(html).toContain("lat 41.878 lng -87.624");
    expect(html).toContain("CHANNEL 03 / 99");
    expect(html).toContain("STAGE 02 ▸ 05");
    // Registers a paused timeline as window.__timelines["s01"]
    expect(html).toContain("window.__timelines['s01']");
  });

  it("escapes HTML in the accent word and data lines", () => {
    const html = CYBER_DATA_CLUSTER_TEMPLATE.render(
      {
        accentWord: "<script>",
        dataLines: ["<img src=x>", "normal"],
      },
      ctx("s02"),
    );
    // User-supplied <img> must not appear as a real tag — it should be escaped.
    // (The template itself emits a legitimate <script> for the timeline, so we
    // can't blanket-assert "no <script>" — we assert the user content escaped.)
    expect(html).not.toContain("<img src=x>");
    expect(html).toContain("&lt;img src=x&gt;");
    expect(html).toContain("&lt;script&gt;");
  });

  it("caps data lines at 30 even if more are passed", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line-${i}`);
    const html = CYBER_DATA_CLUSTER_TEMPLATE.render(
      { accentWord: "X", dataLines: lines },
      ctx("s03"),
    );
    // 30 lines → 30 .cdc-line divs
    const matches = html.match(/class="cdc-line"/g) ?? [];
    expect(matches.length).toBe(30);
    expect(html).not.toContain("line-30"); // line index 30 (the 31st) excluded
  });

  it("falls back to a placeholder when accentWord is empty", () => {
    const html = CYBER_DATA_CLUSTER_TEMPLATE.render({ dataLines: [] }, ctx("s04"));
    expect(html).toContain('id="s04"');
    // Placeholder is the em-dash glyph
    expect(html).toContain("—");
  });
});

describe("cyber-glitch-word", () => {
  it("renders 4 stacked word layers for chromatic split", () => {
    const html = CYBER_GLITCH_WORD_TEMPLATE.render(
      { word: "TEMPLATE", undertext: "the new playbook" },
      ctx("s05"),
    );
    // Base + 3 chromatic copies (.r .g .b) = 4 occurrences of the word
    const wordMatches = html.match(/TEMPLATE/g) ?? [];
    expect(wordMatches.length).toBeGreaterThanOrEqual(4);
    expect(html).toContain("the new playbook");
  });

  it("uppercases and clips the word to 14 chars", () => {
    const html = CYBER_GLITCH_WORD_TEMPLATE.render(
      { word: "thiswordistoolongtoflowinone" },
      ctx("s06"),
    );
    // Only the first 14 chars (uppercased) should appear
    expect(html).toContain("THISWORDISTOOL");
    expect(html).not.toContain("THISWORDISTOOLO");
  });

  it("registers a paused timeline keyed to the scene id", () => {
    const html = CYBER_GLITCH_WORD_TEMPLATE.render({ word: "X" }, ctx("s07"));
    expect(html).toContain("window.__timelines['s07']");
    expect(html).toContain("paused: true");
  });
});

describe("cyber-pixel-still", () => {
  it("renders the no-image fallback when no image is attached", () => {
    const html = CYBER_PIXEL_STILL_TEMPLATE.render(
      { caption: "telemetry capture, 2026-04" },
      ctx("s08"),
    );
    // The .cps-tile element should carry the no-image class in the rendered DOM
    expect(html).toContain('class="cps-tile no-image"');
    // No actual tile-image element rendered when there's no image (CSS class
    // definition is still in the <style> block — that's fine).
    expect(html).not.toContain('<div class="cps-tile-image"');
    expect(html).toContain("telemetry capture, 2026-04");
  });

  it("renders the image fill when an image is attached", () => {
    const html = CYBER_PIXEL_STILL_TEMPLATE.render(
      { caption: "with photo", cornerLabel: "OBSERVATION 03" },
      {
        ...ctx("s09"),
        image: {
          id: "ref",
          src: "assets/images/ref.webp",
          width: 1024,
          height: 768,
          aspect: 1.33,
          dominantColor: "#000",
          palette: [],
          description: "",
          focalPoint: { x: 0.5, y: 0.5 },
          role: "subject",
        },
      },
    );
    expect(html).toContain("cps-tile-image");
    expect(html).toContain("assets/images/ref.webp");
    // The DOM element should NOT have the no-image class (CSS rule still in
    // <style> always; we only check the rendered tile element's class list).
    expect(html).not.toContain('class="cps-tile no-image"');
    expect(html).toContain("OBSERVATION 03");
  });
});

describe("cyberlofi theme", () => {
  it("is registered in the themes map", () => {
    expect(getThemeByName("cyberlofi")).toBe(CYBERLOFI);
  });

  it("uses pure-black background and white foreground", () => {
    expect(CYBERLOFI.colors.bg).toBe("#000000");
    expect(CYBERLOFI.colors.fg).toBe("#FFFFFF");
  });

  it("uses JetBrains Mono for all three font slots", () => {
    expect(CYBERLOFI.fonts.display).toContain("JetBrains Mono");
    expect(CYBERLOFI.fonts.body).toContain("JetBrains Mono");
    expect(CYBERLOFI.fonts.mono).toContain("JetBrains Mono");
  });
});

describe("glitch-decay atmosphere", () => {
  it("is registered as a builtin atmosphere", () => {
    const atmo = getAtmosphere("glitch-decay");
    expect(atmo).toBeDefined();
    expect(atmo?.id).toBe("glitch-decay");
  });

  it("renders scoped scanlines + pixel grid + RGB-shift layer", () => {
    const atmo = getAtmosphere("glitch-decay")!;
    const html = atmo.render({ sceneId: "s10", tokens: DEFAULT_TOKENS });
    expect(html).toContain("hf-atmo-glitch");
    expect(html).toContain("hf-glitch-rgb");
    // Scoped to the scene id so two scenes can use it side-by-side
    expect(html).toContain("#s10");
    expect(html).toContain("hf-glitch-jitter-s10");
  });
});
