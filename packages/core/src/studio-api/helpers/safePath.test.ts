import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isSafePath } from "./safePath.js";

let tmp: string;
let projectDir: string;
let outsideDir: string;

beforeEach(() => {
  // realpath the tmp root so cross-OS symlink prefixes (e.g. /var → /private/var on macOS)
  // do not skew the comparisons inside the helper.
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "safepath-test-")));
  projectDir = join(tmp, "project");
  outsideDir = join(tmp, "outside");
  mkdirSync(projectDir);
  mkdirSync(outsideDir);
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("isSafePath", () => {
  it("accepts the base directory itself", () => {
    expect(isSafePath(projectDir, projectDir)).toBe(true);
  });

  it("accepts paths inside base (existing)", () => {
    const file = join(projectDir, "a.txt");
    writeFileSync(file, "x");
    expect(isSafePath(projectDir, file)).toBe(true);
  });

  it("accepts not-yet-existing paths inside base", () => {
    expect(isSafePath(projectDir, join(projectDir, "new", "deeply", "nested.txt"))).toBe(true);
  });

  it("rejects parent traversal", () => {
    expect(isSafePath(projectDir, join(projectDir, "..", "outside", "x"))).toBe(false);
  });

  it("rejects absolute paths outside base", () => {
    expect(isSafePath(projectDir, "/etc/passwd")).toBe(false);
  });

  it("rejects a sibling directory that shares a prefix substring", () => {
    // <tmp>/project vs <tmp>/projectx — startsWith without separator would falsely accept.
    const sibling = join(tmp, "projectx");
    mkdirSync(sibling);
    expect(isSafePath(projectDir, join(sibling, "a"))).toBe(false);
  });

  it("rejects a path through a symlinked dir that points outside base", () => {
    // Inside the project, create a symlink to outside; writing through it must be rejected.
    const escapeLink = join(projectDir, "escape");
    symlinkSync(outsideDir, escapeLink);
    expect(isSafePath(projectDir, join(escapeLink, "secret.txt"))).toBe(false);
  });

  it("rejects a symlink target itself when it points outside", () => {
    const link = join(projectDir, "link-to-outside");
    symlinkSync(outsideDir, link);
    expect(isSafePath(projectDir, link)).toBe(false);
  });

  it("accepts an inner symlink that resolves back inside base", () => {
    const real = join(projectDir, "real");
    mkdirSync(real);
    const link = join(projectDir, "link-inside");
    symlinkSync(real, link);
    expect(isSafePath(projectDir, join(link, "a.txt"))).toBe(true);
  });

  it("rejects when the base does not exist", () => {
    expect(isSafePath(join(tmp, "nope"), join(projectDir, "a"))).toBe(false);
  });

  it("rejects when the deepest existing ancestor cannot be resolved", () => {
    // Path with no existing ancestor inside our tmp space — root won't be under projectDir.
    expect(isSafePath(projectDir, "/this/does/not/exist/anywhere")).toBe(false);
  });
});
