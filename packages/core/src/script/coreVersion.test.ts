import { describe, it, expect } from "vitest";
import { getCoreVersion } from "./coreVersion.js";

describe("getCoreVersion", () => {
  it("returns the core package version (or the dev fallback)", () => {
    const v = getCoreVersion();
    expect(typeof v).toBe("string");
    // Either a real semver-ish version (e.g. 0.4.27) or the explicit
    // fallback. The exact value drifts across releases, so we assert
    // shape only.
    expect(v.length).toBeGreaterThan(0);
    expect(/^\d+\.\d+\.\d+/.test(v) || v === "0.0.0-dev").toBe(true);
  });

  it("is memoized — repeated calls return the same value", () => {
    const a = getCoreVersion();
    const b = getCoreVersion();
    expect(a).toBe(b);
  });
});
