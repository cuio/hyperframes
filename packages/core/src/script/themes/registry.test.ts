import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadThemeRegistry,
  getLoadedThemeByName,
  getDefaultLoadedTheme,
  invalidateThemeRegistry,
} from "./registry.js";

let tmp: string;

const MIN_TOKENS = {
  colors: { bg: "#000", fg: "#fff", accent: "#f00" },
  fonts: { display: "A", body: "B", mono: "C" },
  motion: { ease: "power2.out", enterMs: 400, staggerMs: 60 },
};

function writeTheme(folder: string, manifest: Record<string, unknown>): void {
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "theme.json"), JSON.stringify(manifest, null, 2));
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "registry-test-"));
  invalidateThemeRegistry();
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  invalidateThemeRegistry();
});

describe("loadThemeRegistry", () => {
  it("returns built-ins when no disk roots are configured", () => {
    const reg = loadThemeRegistry({});
    const ids = reg.map((t) => t.id);
    expect(ids).toContain("hackernoon-ft");
    expect(ids).toContain("data-drift-dark");
    expect(ids).toContain("dreamspace");
  });

  it("merges disk themes in alongside built-ins", () => {
    const projectDir = join(tmp, "proj");
    mkdirSync(projectDir);
    writeTheme(join(projectDir, "themes", "custom-x"), {
      id: "custom-x",
      name: "Custom X",
      tokens: MIN_TOKENS,
    });
    const reg = loadThemeRegistry({ projectDir });
    const found = reg.find((t) => t.id === "custom-x");
    expect(found).toBeDefined();
    expect(found?.name).toBe("Custom X");
  });

  it("disk theme overrides a built-in on id collision", () => {
    const projectDir = join(tmp, "proj");
    mkdirSync(projectDir);
    writeTheme(join(projectDir, "themes", "dreamspace"), {
      id: "dreamspace",
      name: "Project Dreamspace",
      description: "overridden",
      tokens: MIN_TOKENS,
    });
    const reg = loadThemeRegistry({ projectDir });
    const found = reg.find((t) => t.id === "dreamspace");
    expect(found?.name).toBe("Project Dreamspace");
    expect(found?.description).toBe("overridden");
  });

  it("inherits built-in googleFonts when disk theme omits them", () => {
    const projectDir = join(tmp, "proj");
    mkdirSync(projectDir);
    writeTheme(join(projectDir, "themes", "dreamspace"), {
      id: "dreamspace",
      tokens: MIN_TOKENS,
      // no fonts.googleFonts → should fall back to built-in's
    });
    const reg = loadThemeRegistry({ projectDir });
    const found = reg.find((t) => t.id === "dreamspace");
    expect(found?.fonts.googleFonts.length).toBeGreaterThan(0);
  });

  it("getLoadedThemeByName returns null for missing", () => {
    expect(getLoadedThemeByName("not-a-real-theme")).toBeNull();
    expect(getLoadedThemeByName(null)).toBeNull();
    expect(getLoadedThemeByName(undefined)).toBeNull();
  });

  it("getDefaultLoadedTheme returns the configured default first", () => {
    const def = getDefaultLoadedTheme();
    expect(def.id).toBe("hackernoon-ft");
  });

  it("caches the registry within the TTL window", () => {
    const projectDir = join(tmp, "proj");
    mkdirSync(projectDir);
    writeTheme(join(projectDir, "themes", "before"), {
      id: "before",
      tokens: MIN_TOKENS,
    });
    const first = loadThemeRegistry({ projectDir });
    expect(first.find((t) => t.id === "before")).toBeDefined();

    // Add a second theme on disk; without invalidation we should still see
    // the cached registry, NOT the new theme.
    writeTheme(join(projectDir, "themes", "after"), {
      id: "after",
      tokens: MIN_TOKENS,
    });
    const cached = loadThemeRegistry({ projectDir });
    expect(cached.find((t) => t.id === "after")).toBeUndefined();

    invalidateThemeRegistry();
    const fresh = loadThemeRegistry({ projectDir });
    expect(fresh.find((t) => t.id === "after")).toBeDefined();
  });

  it("ignores manifests with malformed token arrays (V2 hardening)", () => {
    const projectDir = join(tmp, "proj");
    mkdirSync(projectDir);
    writeTheme(join(projectDir, "themes", "broken-prefs"), {
      id: "broken-prefs",
      tokens: MIN_TOKENS,
      // Wrong type — should NOT throw, should fall back to empty.
      preferences: { atmospheres: "aurora", transitions: 42, icons: null },
    });
    const reg = loadThemeRegistry({ projectDir });
    const found = reg.find((t) => t.id === "broken-prefs");
    expect(found).toBeDefined();
    expect(found?.preferences.atmospheres).toEqual([]);
    expect(found?.preferences.transitions).toEqual([]);
    expect(found?.preferences.icons).toEqual([]);
  });

  it("rejects manifests missing required tokens", () => {
    const projectDir = join(tmp, "proj");
    mkdirSync(projectDir);
    writeTheme(join(projectDir, "themes", "missing-tokens"), {
      id: "missing-tokens",
      // tokens missing → must NOT appear in registry
    });
    const reg = loadThemeRegistry({ projectDir });
    expect(reg.find((t) => t.id === "missing-tokens")).toBeUndefined();
  });

  it("rejects manifests where id is missing or non-string", () => {
    const projectDir = join(tmp, "proj");
    mkdirSync(projectDir);
    writeTheme(join(projectDir, "themes", "no-id"), {
      tokens: MIN_TOKENS,
    });
    const reg = loadThemeRegistry({ projectDir });
    expect(reg.find((t) => t.source.includes("no-id"))).toBeUndefined();
  });
});
