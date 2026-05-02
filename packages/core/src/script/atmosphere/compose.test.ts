import { describe, it, expect } from "vitest";
import {
  compose,
  BUILTIN_COMPOSITIONS,
  resolveAtmosphereOrComposition,
  listAllAtmosphereIds,
} from "./compose.js";
import { BUILTIN_ATMOSPHERES } from "./builtin.js";
import type { AtmosphereContext } from "./types.js";
import { DEFAULT_TOKENS } from "../templates/index.js";

const CTX: AtmosphereContext = {
  sceneId: "s01",
  tokens: DEFAULT_TOKENS,
};

describe("compose()", () => {
  it("creates a composition that joins layer HTML in order", () => {
    const c = compose("test-stack", "stack two layers", ["studio-flat", "noise-grain"]);
    expect(c.id).toBe("test-stack");
    expect(c.layers).toEqual(["studio-flat", "noise-grain"]);
    const html = c.render(CTX);
    // studio-flat renders nothing (it's the no-op atmosphere) — only the
    // separator + noise-grain output should be present, with the
    // separator marking where the layer split sits.
    expect(html).toContain("<!-- layer -->");
    expect(html).toContain("hf-atmo-grain");
  });

  it("silently drops unknown layer ids with a warning", () => {
    const warnings: unknown[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    try {
      const c = compose("partial", "stack with one bad id", ["aurora", "definitely-not-real"]);
      expect(c.layers).toEqual(["aurora"]);
      expect(warnings.length).toBe(1);
    } finally {
      console.warn = origWarn;
    }
  });

  it("a single-layer composition behaves like the underlying preset", () => {
    const c = compose("just-aurora", "aurora alone", ["aurora"]);
    expect(c.layers).toEqual(["aurora"]);
    const composed = c.render(CTX);
    const direct = BUILTIN_ATMOSPHERES.find((a) => a.id === "aurora")!.render(CTX);
    expect(composed).toBe(direct);
  });

  it("preserves order — layer 0 appears before layer 1 in output", () => {
    const c = compose("ordered", "two layers", ["aurora", "noise-grain"]);
    const html = c.render(CTX);
    expect(html.indexOf("hf-atmo-aurora")).toBeLessThan(html.indexOf("hf-atmo-grain"));
  });
});

describe("BUILTIN_COMPOSITIONS", () => {
  it("ships clean-fade as a layered composition", () => {
    const cleanFade = BUILTIN_COMPOSITIONS.find((c) => c.id === "clean-fade");
    expect(cleanFade).toBeDefined();
    expect(cleanFade?.layers.length).toBeGreaterThan(0);
  });

  it("every composition only references valid layer ids", () => {
    const valid = new Set(BUILTIN_ATMOSPHERES.map((a) => a.id));
    for (const c of BUILTIN_COMPOSITIONS) {
      for (const layerId of c.layers) {
        expect(valid.has(layerId)).toBe(true);
      }
    }
  });

  it("no composition uses cosmic-dust / particle-field / geometric-grid (the dotty ones the user disliked)", () => {
    const banned = new Set(["cosmic-dust", "particle-field", "geometric-grid"]);
    for (const c of BUILTIN_COMPOSITIONS) {
      for (const layerId of c.layers) {
        expect(banned.has(layerId)).toBe(false);
      }
    }
  });
});

describe("resolveAtmosphereOrComposition", () => {
  it("returns a composition when the id matches", () => {
    const a = resolveAtmosphereOrComposition("clean-fade");
    expect(a?.id).toBe("clean-fade");
  });

  it("returns a leaf preset when the id matches a single-layer atmosphere", () => {
    const a = resolveAtmosphereOrComposition("aurora");
    expect(a?.id).toBe("aurora");
  });

  it("returns null for unknown ids", () => {
    expect(resolveAtmosphereOrComposition("not-a-real-atmosphere")).toBeNull();
  });
});

describe("listAllAtmosphereIds", () => {
  it("includes both single-layer atmospheres and compositions", () => {
    const all = listAllAtmosphereIds();
    expect(all).toContain("aurora");
    expect(all).toContain("clean-fade");
    expect(all).toContain("editorial-grit");
  });

  it("ids are unique across the combined list", () => {
    const all = listAllAtmosphereIds();
    expect(new Set(all).size).toBe(all.length);
  });
});
