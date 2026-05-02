import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  normalizeProfile,
  validateReferenceInputs,
  readPersistedProfile,
  REFERENCE_PROFILE_REL_PATH,
} from "./referenceProfile.js";
import { GeminiError } from "../gemini/client.js";

const KNOWN_ATMOS = ["aurora", "gradient-mesh", "studio-flat", "noise-grain", "cosmic-dust"];
const KNOWN_TPLS = ["hook-bigtext", "kinetic-words", "chart-scene", "outro-cta"];
const KNOWN_TREATMENTS = ["editorial-bleed", "duotone-bg", "type-mask-fill"];

const CATALOGS = {
  knownAtmospheres: KNOWN_ATMOS,
  knownTemplates: KNOWN_TPLS,
  knownTreatments: KNOWN_TREATMENTS,
};

describe("normalizeProfile", () => {
  it("passes through a fully-valid response", () => {
    const out = normalizeProfile(
      {
        vibe: "gritty editorial documentary",
        palette: ["#1a1a2e", "#e8b46e", "#f6f6f8", "#3a3a48"],
        typographyEnergy: "soft",
        pacingDensity: "slow",
        motionVibe: "slow zooms, no rotation",
        recommendedAtmospheres: ["studio-flat", "noise-grain"],
        avoidAtmospheres: ["cosmic-dust"],
        treatmentBias: "editorial-bleed",
        preferredTemplates: ["hook-bigtext", "kinetic-words"],
        avoidTemplates: ["chart-scene"],
        rationale: "Soft tonal palette with grain texture.",
      },
      CATALOGS,
      {},
      1_700_000_000_000,
    );
    expect(out.version).toBe(1);
    expect(out.vibe).toBe("gritty editorial documentary");
    expect(out.palette).toEqual(["#1a1a2e", "#e8b46e", "#f6f6f8", "#3a3a48"]);
    expect(out.typographyEnergy).toBe("soft");
    expect(out.pacingDensity).toBe("slow");
    expect(out.recommendedAtmospheres).toEqual(["studio-flat", "noise-grain"]);
    expect(out.avoidAtmospheres).toEqual(["cosmic-dust"]);
    expect(out.treatmentBias).toBe("editorial-bleed");
    expect(out.preferredTemplates).toEqual(["hook-bigtext", "kinetic-words"]);
    expect(out.avoidTemplates).toEqual(["chart-scene"]);
    expect(out.extractedAt).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it("drops palette entries that are not valid hex", () => {
    const out = normalizeProfile(
      {
        vibe: "x",
        palette: ["#abc123", "red", "rgb(0,0,0)", "#FF00FF"],
        typographyEnergy: "medium",
        pacingDensity: "medium",
        motionVibe: "x",
        recommendedAtmospheres: [],
        avoidAtmospheres: [],
        preferredTemplates: [],
        avoidTemplates: [],
        rationale: "x",
      },
      CATALOGS,
      {},
    );
    // Only 6-char hex passes
    expect(out.palette).toEqual(["#abc123", "#FF00FF"]);
  });

  it("filters out unknown atmosphere ids the model invented", () => {
    const out = normalizeProfile(
      {
        vibe: "x",
        palette: [],
        typographyEnergy: "medium",
        pacingDensity: "medium",
        motionVibe: "x",
        recommendedAtmospheres: ["aurora", "made-up", "STUDIO-FLAT"],
        avoidAtmospheres: ["cosmic-dust"],
        preferredTemplates: [],
        avoidTemplates: [],
        rationale: "x",
      },
      CATALOGS,
      {},
    );
    // "made-up" dropped; "STUDIO-FLAT" case-mismatch dropped; aurora kept.
    expect(out.recommendedAtmospheres).toEqual(["aurora"]);
    expect(out.avoidAtmospheres).toEqual(["cosmic-dust"]);
  });

  it("dedupes id arrays", () => {
    const out = normalizeProfile(
      {
        vibe: "x",
        palette: [],
        typographyEnergy: "medium",
        pacingDensity: "medium",
        motionVibe: "x",
        recommendedAtmospheres: ["aurora", "aurora", "noise-grain"],
        avoidAtmospheres: [],
        preferredTemplates: [],
        avoidTemplates: [],
        rationale: "x",
      },
      CATALOGS,
      {},
    );
    expect(out.recommendedAtmospheres).toEqual(["aurora", "noise-grain"]);
  });

  it("falls back to medium when typographyEnergy/pacingDensity invalid", () => {
    const out = normalizeProfile(
      {
        vibe: "x",
        palette: [],
        typographyEnergy: "extreme",
        pacingDensity: "supersonic",
        motionVibe: "x",
        recommendedAtmospheres: [],
        avoidAtmospheres: [],
        preferredTemplates: [],
        avoidTemplates: [],
        rationale: "x",
      },
      CATALOGS,
      {},
    );
    expect(out.typographyEnergy).toBe("medium");
    expect(out.pacingDensity).toBe("medium");
  });

  it("clips vibe + motionVibe + rationale to safe lengths", () => {
    const long = "a".repeat(500);
    const out = normalizeProfile(
      {
        vibe: long,
        palette: [],
        typographyEnergy: "medium",
        pacingDensity: "medium",
        motionVibe: long,
        recommendedAtmospheres: [],
        avoidAtmospheres: [],
        preferredTemplates: [],
        avoidTemplates: [],
        rationale: long,
      },
      CATALOGS,
      {},
    );
    expect(out.vibe.length).toBeLessThanOrEqual(120);
    expect(out.motionVibe.length).toBeLessThanOrEqual(200);
    expect(out.rationale.length).toBeLessThanOrEqual(240);
  });

  it("returns null treatmentBias when unknown", () => {
    expect(
      normalizeProfile(
        {
          vibe: "x",
          palette: [],
          typographyEnergy: "medium",
          pacingDensity: "medium",
          motionVibe: "x",
          recommendedAtmospheres: [],
          avoidAtmospheres: [],
          treatmentBias: "made-up-treatment",
          preferredTemplates: [],
          avoidTemplates: [],
          rationale: "x",
        },
        CATALOGS,
        {},
      ).treatmentBias,
    ).toBeNull();
  });

  it("threads source through unchanged", () => {
    const src = {
      videoPath: "/a.mp4",
      videoSeconds: 30,
      imagePaths: ["/b.png"],
      userIntent: "less polkadot",
    };
    const out = normalizeProfile(
      {
        vibe: "x",
        palette: [],
        typographyEnergy: "medium",
        pacingDensity: "medium",
        motionVibe: "x",
        recommendedAtmospheres: [],
        avoidAtmospheres: [],
        preferredTemplates: [],
        avoidTemplates: [],
        rationale: "x",
      },
      CATALOGS,
      src,
    );
    expect(out.source).toEqual(src);
  });
});

describe("validateReferenceInputs", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "hf-ref-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("throws when no inputs provided", () => {
    expect(() => validateReferenceInputs({})).toThrow(GeminiError);
  });

  it("throws when video path doesn't exist", () => {
    expect(() => validateReferenceInputs({ videoPath: "/nonexistent.mp4" })).toThrow(
      /does not exist/,
    );
  });

  it("rejects unsupported video extensions", () => {
    const p = join(tmp, "ref.avi");
    writeFileSync(p, "fake bytes");
    expect(() => validateReferenceInputs({ videoPath: p })).toThrow(/unsupported video extension/);
  });

  it("accepts mp4/mov/webm video extensions", () => {
    for (const ext of [".mp4", ".mov", ".webm"]) {
      const p = join(tmp, `ref${ext}`);
      writeFileSync(p, "fake");
      expect(() => validateReferenceInputs({ videoPath: p })).not.toThrow();
    }
  });

  it("rejects non-existent images", () => {
    expect(() => validateReferenceInputs({ imagePaths: ["/missing.jpg"] })).toThrow(
      /does not exist/,
    );
  });
});

describe("readPersistedProfile", () => {
  it("returns null when the file is missing", () => {
    const tmp = mkdtempSync(join(tmpdir(), "hf-ref-"));
    expect(readPersistedProfile(tmp)).toBeNull();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns null when the file is malformed", () => {
    const tmp = mkdtempSync(join(tmpdir(), "hf-ref-"));
    mkdirSync(join(tmp, ".hyperframes"), { recursive: true });
    writeFileSync(join(tmp, REFERENCE_PROFILE_REL_PATH), "{not json");
    expect(readPersistedProfile(tmp)).toBeNull();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("rejects profiles with the wrong version", () => {
    const tmp = mkdtempSync(join(tmpdir(), "hf-ref-"));
    mkdirSync(join(tmp, ".hyperframes"), { recursive: true });
    writeFileSync(
      join(tmp, REFERENCE_PROFILE_REL_PATH),
      JSON.stringify({ version: 99, vibe: "x" }),
    );
    expect(readPersistedProfile(tmp)).toBeNull();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns a valid profile", () => {
    const tmp = mkdtempSync(join(tmpdir(), "hf-ref-"));
    mkdirSync(join(tmp, ".hyperframes"), { recursive: true });
    const profile = {
      version: 1,
      extractedAt: new Date(0).toISOString(),
      source: {},
      vibe: "x",
      palette: [],
      typographyEnergy: "medium",
      pacingDensity: "medium",
      motionVibe: "x",
      recommendedAtmospheres: [],
      avoidAtmospheres: [],
      treatmentBias: null,
      preferredTemplates: [],
      avoidTemplates: [],
      rationale: "x",
    };
    writeFileSync(join(tmp, REFERENCE_PROFILE_REL_PATH), JSON.stringify(profile));
    expect(readPersistedProfile(tmp)?.vibe).toBe("x");
    rmSync(tmp, { recursive: true, force: true });
  });
});
