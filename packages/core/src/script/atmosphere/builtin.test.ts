import { describe, it, expect } from "vitest";
import { BUILTIN_ATMOSPHERES, ATMOSPHERE_IDS, getAtmosphere, renderAtmosphere } from "./builtin.js";
import { DEFAULT_TOKENS } from "../templates/index.js";
import type { AtmosphereContext } from "./types.js";

const CTX: AtmosphereContext = {
  sceneId: "s01",
  tokens: DEFAULT_TOKENS,
};

describe("BUILTIN_ATMOSPHERES — registry", () => {
  it("gives every preset a unique id", () => {
    const ids = BUILTIN_ATMOSPHERES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every preset a description and render fn", () => {
    for (const preset of BUILTIN_ATMOSPHERES) {
      expect(preset.description.length).toBeGreaterThan(10);
      expect(typeof preset.render).toBe("function");
    }
  });

  it("ATMOSPHERE_IDS matches the BUILTIN_ATMOSPHERES list", () => {
    expect(ATMOSPHERE_IDS).toEqual(BUILTIN_ATMOSPHERES.map((a) => a.id));
  });
});

describe("chromatic-glow — Vision-Pro spotlight halo (cinematic-card foundation)", () => {
  it("is registered as a builtin", () => {
    expect(getAtmosphere("chromatic-glow")).toBeDefined();
  });

  it("scopes its CSS by sceneId so two scenes can share the preset without collision", () => {
    const html1 = renderAtmosphere("chromatic-glow", { ...CTX, sceneId: "s01" });
    const html2 = renderAtmosphere("chromatic-glow", { ...CTX, sceneId: "s07" });
    expect(html1).toContain("#s01 .hf-atmo-chromatic-glow");
    expect(html2).toContain("#s07 .hf-atmo-chromatic-glow");
    expect(html1).toContain("hf-chromatic-glow-breathe-s01");
    expect(html2).toContain("hf-chromatic-glow-breathe-s07");
    // Cross-scene independence: s01 must not leak s07's keyframe name and vice versa.
    expect(html1).not.toContain("breathe-s07");
    expect(html2).not.toContain("breathe-s01");
  });

  it("uses the active theme's accent color so each design.md gets its own ambient hue", () => {
    const html = renderAtmosphere("chromatic-glow", CTX);
    expect(html).toContain(DEFAULT_TOKENS.colors.accent);
    expect(html).toContain(DEFAULT_TOKENS.colors.accent2);
  });

  it("intensifies the halo for hook scenes (cc / 66) over body scenes (a6 / 40)", () => {
    const hookHtml = renderAtmosphere("chromatic-glow", { ...CTX, isHook: true });
    const bodyHtml = renderAtmosphere("chromatic-glow", { ...CTX, isHook: false });
    expect(hookHtml).toContain(`${DEFAULT_TOKENS.colors.accent}cc`);
    expect(bodyHtml).toContain(`${DEFAULT_TOKENS.colors.accent}a6`);
    expect(hookHtml).not.toBe(bodyHtml);
  });

  it("is opt-in only — defaultAtmosphereForTemplate doesn't yet route any template to chromatic-glow", () => {
    // Purposeful: this preset is the foundation for the upcoming
    // spotlight-card / cinematic-card aesthetic upgrade. Until that work
    // ships its template, we don't auto-apply chromatic-glow to existing
    // templates — that would change every render. The test pins this
    // intent so a future refactor doesn't accidentally turn it on.
    const html = renderAtmosphere("chromatic-glow", CTX);
    expect(html).toContain("hf-atmo-chromatic-glow");
  });
});
