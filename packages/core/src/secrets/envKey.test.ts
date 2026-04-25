import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getKeyStatus, loadKey, writeKeyToEnvFile } from "./envKey.js";

let tmp: string;
const SAVED_ENV: Record<string, string | undefined> = {};

function setEnv(name: string, value: string | undefined): void {
  if (!(name in SAVED_ENV)) SAVED_ENV[name] = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "envkey-test-"));
});

afterEach(() => {
  for (const [k, v] of Object.entries(SAVED_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    delete SAVED_ENV[k];
  }
  rmSync(tmp, { recursive: true, force: true });
});

describe("loadKey precedence", () => {
  it("returns process.env when set", () => {
    setEnv("HF_TEST", "from-process");
    const projectDir = join(tmp, "proj");
    mkdirSync(projectDir);
    writeFileSync(join(projectDir, ".env"), "HF_TEST=from-project\n");
    expect(loadKey("HF_TEST", projectDir)).toBe("from-process");
  });

  it("falls back to project .env when process.env not set", () => {
    setEnv("HF_TEST", undefined);
    const projectDir = join(tmp, "proj");
    mkdirSync(projectDir);
    writeFileSync(join(projectDir, ".env"), "HF_TEST=from-project\n");
    expect(loadKey("HF_TEST", projectDir)).toBe("from-project");
  });

  it("returns null when no source has the key", () => {
    setEnv("HF_TEST", undefined);
    const projectDir = join(tmp, "proj");
    mkdirSync(projectDir);
    expect(loadKey("HF_TEST", projectDir)).toBeNull();
  });

  it("does not throw on missing project .env", () => {
    setEnv("HF_TEST", undefined);
    expect(() => loadKey("HF_TEST", join(tmp, "no-such-project"))).not.toThrow();
  });
});

describe("getKeyStatus reports source without leaking value", () => {
  it("reports process source", () => {
    setEnv("HF_TEST", "secret-value");
    const status = getKeyStatus("HF_TEST", tmp);
    expect(status).toEqual({ hasKey: true, source: "process" });
    expect(JSON.stringify(status)).not.toContain("secret-value");
  });

  it("reports project-env source", () => {
    setEnv("HF_TEST", undefined);
    const projectDir = join(tmp, "proj");
    mkdirSync(projectDir);
    writeFileSync(join(projectDir, ".env"), "HF_TEST=secret\n");
    expect(getKeyStatus("HF_TEST", projectDir)).toEqual({
      hasKey: true,
      source: "project-env",
    });
  });

  it("reports none when missing everywhere", () => {
    setEnv("HF_TEST", undefined);
    expect(getKeyStatus("HF_TEST", tmp)).toEqual({ hasKey: false, source: "none" });
  });
});

describe("writeKeyToEnvFile", () => {
  it("creates a new .env with mode 0600 and trailing newline", () => {
    const path = join(tmp, "sub", "deeper", ".env");
    writeKeyToEnvFile(path, "API_KEY", "abc123");
    const content = readFileSync(path, "utf-8");
    expect(content).toBe("API_KEY=abc123\n");
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("creates parent directory chain when missing", () => {
    const path = join(tmp, "a", "b", "c", ".env");
    writeKeyToEnvFile(path, "K", "v");
    expect(readFileSync(path, "utf-8")).toBe("K=v\n");
  });

  it("replaces an existing key in place, preserving other lines", () => {
    const path = join(tmp, ".env");
    writeFileSync(path, "# comment\nFOO=old\nBAR=keep\n");
    writeKeyToEnvFile(path, "FOO", "new");
    expect(readFileSync(path, "utf-8")).toBe("# comment\nFOO=new\nBAR=keep\n");
  });

  it("appends a new key with a separator blank line when file is non-empty", () => {
    const path = join(tmp, ".env");
    writeFileSync(path, "EXISTING=1\n");
    writeKeyToEnvFile(path, "NEW", "2");
    expect(readFileSync(path, "utf-8")).toContain("EXISTING=1");
    expect(readFileSync(path, "utf-8")).toContain("NEW=2");
  });

  it("removes the key when value is null", () => {
    const path = join(tmp, ".env");
    writeFileSync(path, "FOO=bar\nKEEP=this\n");
    writeKeyToEnvFile(path, "FOO", null);
    const after = readFileSync(path, "utf-8");
    expect(after).not.toMatch(/^FOO=/m);
    expect(after).toContain("KEEP=this");
  });

  it("is a no-op when removing a missing key", () => {
    const path = join(tmp, ".env");
    writeFileSync(path, "KEEP=this\n");
    expect(() => writeKeyToEnvFile(path, "MISSING", null)).not.toThrow();
    expect(readFileSync(path, "utf-8")).toBe("KEEP=this\n");
  });

  it("round-trips values containing spaces, quotes, hashes, and backslashes", () => {
    const path = join(tmp, ".env");
    const tricky = `weird "value" with $vars # and \\ backslash`;
    writeKeyToEnvFile(path, "K", tricky);
    setEnv("K", undefined);
    expect(loadKey("K", tmp)).toBe(tricky);
  });

  it("writes empty string as quoted empty but loadKey treats it as unset", () => {
    const path = join(tmp, ".env");
    writeKeyToEnvFile(path, "EMPTY", "");
    expect(readFileSync(path, "utf-8")).toContain('EMPTY=""');
    setEnv("EMPTY", undefined);
    expect(loadKey("EMPTY", tmp)).toBeNull();
    expect(getKeyStatus("EMPTY", tmp)).toEqual({ hasKey: false, source: "none" });
  });

  it("round-trips multiple keys without corrupting each other", () => {
    const path = join(tmp, ".env");
    writeKeyToEnvFile(path, "A", "one");
    writeKeyToEnvFile(path, "B", "two with space");
    writeKeyToEnvFile(path, "A", "one-updated");
    setEnv("A", undefined);
    setEnv("B", undefined);
    expect(loadKey("A", tmp)).toBe("one-updated");
    expect(loadKey("B", tmp)).toBe("two with space");
  });

  it("ignores malformed key names in existing file (no key=value injection)", () => {
    const path = join(tmp, ".env");
    writeFileSync(path, "1BAD=should-be-ignored\nGOOD=ok\n");
    setEnv("1BAD", undefined);
    setEnv("GOOD", undefined);
    expect(loadKey("1BAD", tmp)).toBeNull();
    expect(loadKey("GOOD", tmp)).toBe("ok");
  });

  it("does not leave a temp file behind on success", () => {
    const path = join(tmp, ".env");
    writeKeyToEnvFile(path, "K", "v");
    const dirEntries = readFileSync(path, "utf-8");
    expect(dirEntries).toBe("K=v\n");
    const fs = require("node:fs");
    const entries: string[] = fs.readdirSync(tmp);
    expect(entries.filter((e) => e.includes(".tmp."))).toEqual([]);
  });
});
