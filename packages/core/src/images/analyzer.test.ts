import { describe, it, expect } from "vitest";
import { defaultTreatmentForRole, normalizeAnalysis } from "./analyzer.js";

// Pure-helper tests only — no Gemini calls. The analyzer's actual API
// surface is exercised end-to-end by the studio routes; these focus on
// the resilience layer that protects callers from a model that emits
// out-of-range or mistyped values.

describe("normalizeAnalysis", () => {
  it("passes through a fully valid response unchanged", () => {
    const out = normalizeAnalysis({
      role: "hero",
      vibe: "gritty desert noir",
      suggestedTreatment: "editorial-bleed",
      retentionStrengthAtAttachment: 9,
      rationale: "Dominant silhouette against open sky reads instantly.",
    });
    expect(out).toEqual({
      role: "hero",
      vibe: "gritty desert noir",
      suggestedTreatment: "editorial-bleed",
      retentionStrengthAtAttachment: 9,
      rationale: "Dominant silhouette against open sky reads instantly.",
    });
  });

  it("lowercases an upper-case role", () => {
    const out = normalizeAnalysis({
      role: "HERO",
      vibe: "x",
      suggestedTreatment: "editorial-bleed",
      retentionStrengthAtAttachment: 5,
      rationale: "y",
    });
    expect(out.role).toBe("hero");
  });

  it("falls back to 'subject' when role is unrecognized", () => {
    const out = normalizeAnalysis({
      role: "champion",
      vibe: "x",
      suggestedTreatment: "duotone-bg",
      retentionStrengthAtAttachment: 5,
      rationale: "y",
    });
    expect(out.role).toBe("subject");
  });

  it("falls back to 'subject' when role is missing", () => {
    const out = normalizeAnalysis({
      vibe: "x",
      suggestedTreatment: "duotone-bg",
      retentionStrengthAtAttachment: 5,
      rationale: "y",
    });
    expect(out.role).toBe("subject");
  });

  it("clamps retention score below the floor up to 1", () => {
    const out = normalizeAnalysis({
      role: "subject",
      vibe: "x",
      suggestedTreatment: "duotone-bg",
      retentionStrengthAtAttachment: -3,
      rationale: "y",
    });
    expect(out.retentionStrengthAtAttachment).toBe(1);
  });

  it("clamps retention score above the ceiling down to 10", () => {
    const out = normalizeAnalysis({
      role: "subject",
      vibe: "x",
      suggestedTreatment: "duotone-bg",
      retentionStrengthAtAttachment: 42,
      rationale: "y",
    });
    expect(out.retentionStrengthAtAttachment).toBe(10);
  });

  it("rounds fractional scores", () => {
    const out = normalizeAnalysis({
      role: "subject",
      vibe: "x",
      suggestedTreatment: "duotone-bg",
      retentionStrengthAtAttachment: 7.4,
      rationale: "y",
    });
    expect(out.retentionStrengthAtAttachment).toBe(7);
  });

  it("defaults retention score to 5 when missing or non-numeric", () => {
    expect(
      normalizeAnalysis({
        role: "subject",
        vibe: "x",
        suggestedTreatment: "duotone-bg",
        rationale: "y",
      }).retentionStrengthAtAttachment,
    ).toBe(5);
    expect(
      normalizeAnalysis({
        role: "subject",
        vibe: "x",
        suggestedTreatment: "duotone-bg",
        retentionStrengthAtAttachment: Number.NaN,
        rationale: "y",
      }).retentionStrengthAtAttachment,
    ).toBe(5);
  });

  it("returns null suggestedTreatment when value is unknown", () => {
    const out = normalizeAnalysis({
      role: "subject",
      vibe: "x",
      suggestedTreatment: "made-up-treatment",
      retentionStrengthAtAttachment: 5,
      rationale: "y",
    });
    expect(out.suggestedTreatment).toBeNull();
  });

  it("returns null suggestedTreatment when value is null", () => {
    const out = normalizeAnalysis({
      role: "subject",
      vibe: "x",
      suggestedTreatment: null,
      retentionStrengthAtAttachment: 5,
      rationale: "y",
    });
    expect(out.suggestedTreatment).toBeNull();
  });

  it("trims and clips vibe to 60 chars", () => {
    const long = " ".repeat(2) + "a".repeat(120);
    const out = normalizeAnalysis({
      role: "subject",
      vibe: long,
      suggestedTreatment: "duotone-bg",
      retentionStrengthAtAttachment: 5,
      rationale: "y",
    });
    expect(out.vibe.length).toBe(60);
    expect(out.vibe.startsWith("a")).toBe(true);
  });

  it("trims and clips rationale to 240 chars", () => {
    const out = normalizeAnalysis({
      role: "subject",
      vibe: "x",
      suggestedTreatment: "duotone-bg",
      retentionStrengthAtAttachment: 5,
      rationale: "x".repeat(500),
    });
    expect(out.rationale.length).toBe(240);
  });

  it("returns empty strings rather than throwing on missing string fields", () => {
    const out = normalizeAnalysis({
      role: "subject",
      suggestedTreatment: "duotone-bg",
      retentionStrengthAtAttachment: 5,
    });
    expect(out.vibe).toBe("");
    expect(out.rationale).toBe("");
  });
});

describe("defaultTreatmentForRole", () => {
  it("maps hero to editorial-bleed", () => {
    expect(defaultTreatmentForRole("hero")).toBe("editorial-bleed");
  });
  it("maps subject to editorial-bleed", () => {
    expect(defaultTreatmentForRole("subject")).toBe("editorial-bleed");
  });
  it("maps atmosphere to duotone-bg", () => {
    expect(defaultTreatmentForRole("atmosphere")).toBe("duotone-bg");
  });
  it("maps graphic to duotone-bg", () => {
    expect(defaultTreatmentForRole("graphic")).toBe("duotone-bg");
  });
});
