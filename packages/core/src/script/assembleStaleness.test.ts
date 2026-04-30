import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ASSEMBLED_AT_META, CORE_VERSION_META } from "./assemble.js";
import { computeAssemblyStatus, extractMetaContent, readStamp } from "./assembleStaleness.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "hf-staleness-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writeHtml(version: string, assembledAt: string, extraHead = ""): void {
  const html = `<!doctype html>
<html><head>
<meta charset="UTF-8" />
<meta name="${ASSEMBLED_AT_META}" content="${assembledAt}" />
<meta name="${CORE_VERSION_META}" content="${version}" />
${extraHead}
</head><body></body></html>`;
  writeFileSync(join(tmp, "index.html"), html);
}

function setMtime(absPath: string, msSinceEpoch: number): void {
  const seconds = msSinceEpoch / 1000;
  utimesSync(absPath, seconds, seconds);
}

describe("extractMetaContent", () => {
  it("extracts the content of a named meta", () => {
    expect(extractMetaContent('<meta name="x" content="hello" />', "x")).toBe("hello");
  });

  it("returns null when the meta is absent", () => {
    expect(extractMetaContent('<meta name="y" content="hi" />', "x")).toBeNull();
  });

  it("tolerates single-quoted attributes", () => {
    expect(extractMetaContent("<meta name='x' content='hi' />", "x")).toBe("hi");
  });

  it("is case-insensitive on the tag/attr names", () => {
    expect(extractMetaContent('<META NAME="x" CONTENT="ok" />', "x")).toBe("ok");
  });

  it("never matches when the name has special regex chars but is escaped on lookup", () => {
    // Confirms we don't treat the name as a regex pattern.
    expect(extractMetaContent('<meta name="a.b" content="x" />', "a*b")).toBeNull();
    expect(extractMetaContent('<meta name="a.b" content="x" />', "a.b")).toBe("x");
  });
});

describe("readStamp", () => {
  it("returns nulls when the file does not exist", () => {
    expect(readStamp(join(tmp, "missing.html"))).toEqual({
      assembledAt: null,
      coreVersion: null,
    });
  });

  it("reads both stamps from a freshly assembled file", () => {
    writeHtml("1.2.3", "2026-01-01T00:00:00.000Z");
    expect(readStamp(join(tmp, "index.html"))).toEqual({
      assembledAt: "2026-01-01T00:00:00.000Z",
      coreVersion: "1.2.3",
    });
  });

  it("returns nulls when stamps are missing (older HTML)", () => {
    writeFileSync(join(tmp, "index.html"), "<!doctype html><html><head></head></html>");
    expect(readStamp(join(tmp, "index.html"))).toEqual({
      assembledAt: null,
      coreVersion: null,
    });
  });
});

describe("computeAssemblyStatus", () => {
  it("flags missing index.html as stale with reason no-html", () => {
    const status = computeAssemblyStatus({
      projectDir: tmp,
      currentCoreVersion: "1.0.0",
    });
    expect(status.exists).toBe(false);
    expect(status.stale).toBe(true);
    expect(status.reasons).toEqual(["no-html"]);
  });

  it("returns stale=false when stamps match and no source file is newer", () => {
    writeHtml("1.0.0", "2026-01-01T00:00:00.000Z");
    const status = computeAssemblyStatus({
      projectDir: tmp,
      currentCoreVersion: "1.0.0",
    });
    expect(status.exists).toBe(true);
    expect(status.stale).toBe(false);
    expect(status.reasons).toEqual([]);
    expect(status.coreVersionChanged).toBe(false);
  });

  it("flags core-version-changed when stamp != current", () => {
    writeHtml("1.0.0", "2026-01-01T00:00:00.000Z");
    const status = computeAssemblyStatus({
      projectDir: tmp,
      currentCoreVersion: "1.1.0",
    });
    expect(status.coreVersion).toBe("1.0.0");
    expect(status.currentCoreVersion).toBe("1.1.0");
    expect(status.coreVersionChanged).toBe(true);
    expect(status.reasons).toContain("core-version-changed");
    expect(status.stale).toBe(true);
  });

  it("flags no-stamp when an older HTML lacks meta tags", () => {
    writeFileSync(join(tmp, "index.html"), "<!doctype html><html><head></head></html>");
    const status = computeAssemblyStatus({
      projectDir: tmp,
      currentCoreVersion: "1.0.0",
    });
    expect(status.coreVersion).toBeNull();
    expect(status.coreVersionChanged).toBe(false); // no stamp → no comparison
    expect(status.reasons).toContain("no-stamp");
    expect(status.stale).toBe(true);
  });

  it("flags source-files-newer when script.json is touched after assembly", () => {
    writeHtml("1.0.0", "2026-01-01T00:00:00.000Z");
    const htmlPath = join(tmp, "index.html");
    const scriptPath = join(tmp, "script.json");
    writeFileSync(scriptPath, "{}");
    setMtime(htmlPath, Date.now() - 60_000);
    setMtime(scriptPath, Date.now()); // newer
    const status = computeAssemblyStatus({
      projectDir: tmp,
      currentCoreVersion: "1.0.0",
    });
    expect(status.reasons).toContain("source-files-newer");
    expect(status.sourceFilesNewer).toContain("script.json");
    expect(status.stale).toBe(true);
  });

  it("flags newer files inside tracked directories (e.g. assets/images)", () => {
    writeHtml("1.0.0", "2026-01-01T00:00:00.000Z");
    const htmlPath = join(tmp, "index.html");
    mkdirSync(join(tmp, "assets", "images"), { recursive: true });
    const imgPath = join(tmp, "assets", "images", "hero.webp");
    writeFileSync(imgPath, "fake bytes");
    setMtime(htmlPath, Date.now() - 60_000);
    setMtime(imgPath, Date.now());
    const status = computeAssemblyStatus({
      projectDir: tmp,
      currentCoreVersion: "1.0.0",
    });
    expect(status.reasons).toContain("source-files-newer");
    // The relative path can use forward slashes on POSIX or backslashes on
    // Windows; we only assert membership in a normalized form.
    expect(status.sourceFilesNewer.length).toBeGreaterThan(0);
    expect(
      status.sourceFilesNewer.some((p) =>
        p.replace(/\\/g, "/").endsWith("assets/images/hero.webp"),
      ),
    ).toBe(true);
  });

  it("ignores dotfiles inside tracked directories", () => {
    writeHtml("1.0.0", "2026-01-01T00:00:00.000Z");
    const htmlPath = join(tmp, "index.html");
    mkdirSync(join(tmp, "voiceovers"), { recursive: true });
    writeFileSync(join(tmp, "voiceovers", ".DS_Store"), "garbage");
    setMtime(htmlPath, Date.now() - 60_000);
    setMtime(join(tmp, "voiceovers", ".DS_Store"), Date.now());
    const status = computeAssemblyStatus({
      projectDir: tmp,
      currentCoreVersion: "1.0.0",
    });
    expect(status.sourceFilesNewer).toEqual([]);
    expect(status.stale).toBe(false);
  });

  it("collects multiple reasons when both core-version and source-files apply", () => {
    writeHtml("1.0.0", "2026-01-01T00:00:00.000Z");
    const htmlPath = join(tmp, "index.html");
    const scriptPath = join(tmp, "script.json");
    writeFileSync(scriptPath, "{}");
    setMtime(htmlPath, Date.now() - 60_000);
    setMtime(scriptPath, Date.now());
    const status = computeAssemblyStatus({
      projectDir: tmp,
      currentCoreVersion: "1.5.0",
    });
    expect(status.reasons).toContain("core-version-changed");
    expect(status.reasons).toContain("source-files-newer");
    expect(status.message).toContain("core 1.0.0 → 1.5.0");
    expect(status.message).toContain("script.json");
  });

  it("caps reported source files to a small list", () => {
    writeHtml("1.0.0", "2026-01-01T00:00:00.000Z");
    const htmlPath = join(tmp, "index.html");
    setMtime(htmlPath, Date.now() - 60_000);
    // Touch many tracked files.
    const filesToTouch = [
      "script.json",
      "script.generated.json",
      "visual-direction.json",
      "DESIGN.md",
      "DESIGN-ART.md",
      "RESEARCH.md",
    ];
    for (const f of filesToTouch) {
      const p = join(tmp, f);
      writeFileSync(p, "x");
      setMtime(p, Date.now());
    }
    const status = computeAssemblyStatus({
      projectDir: tmp,
      currentCoreVersion: "1.0.0",
    });
    expect(status.sourceFilesNewer.length).toBeLessThanOrEqual(5);
  });

  it("respects custom htmlPath when project keeps a non-default name", () => {
    const html = `<!doctype html>
<html><head>
<meta name="${ASSEMBLED_AT_META}" content="2026-01-01T00:00:00.000Z" />
<meta name="${CORE_VERSION_META}" content="1.0.0" />
</head></html>`;
    mkdirSync(join(tmp, "build"), { recursive: true });
    writeFileSync(join(tmp, "build", "render.html"), html);
    const status = computeAssemblyStatus({
      projectDir: tmp,
      htmlPath: "build/render.html",
      currentCoreVersion: "1.0.0",
    });
    expect(status.exists).toBe(true);
    expect(status.htmlPath).toBe("build/render.html");
    expect(status.coreVersion).toBe("1.0.0");
    expect(status.stale).toBe(false);
  });
});
