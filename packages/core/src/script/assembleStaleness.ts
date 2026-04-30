/**
 * Assembly-staleness detection — answers the question "is the project's
 * `index.html` out of date?" The studio shows a "Regenerate" CTA when this
 * returns stale, with a tooltip explaining why.
 *
 * Two signals collapse into one stale flag:
 *
 *   1. **Source-files-newer-than-html** — at least one tracked input file
 *      has an mtime later than `index.html`. This catches the common case:
 *      user edited script.json, added an image, generated music, etc., and
 *      forgot to re-assemble.
 *   2. **Core-version-changed** — `index.html`'s embedded core-version
 *      stamp doesn't match the running `@hyperframes/core` version. This
 *      catches feature/bug-fix drift: e.g. PR #20 fixed letter-dropouts
 *      in hook-bigtext, but a project assembled before that merge still
 *      ships the broken version.
 *
 * Both signals are collected (not collapsed) so the UI can explain
 * precisely what's stale, and the user can decide whether the drift
 * matters for their workflow.
 *
 * The module is pure — file-system reads only, no writes, no LLM calls.
 * Failure modes (missing index.html, missing stamp, unparseable file)
 * collapse to a graceful "no stamp / unknown" rather than throwing.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ASSEMBLED_AT_META, CORE_VERSION_META } from "./assemble.js";
import { getCoreVersion } from "./coreVersion.js";

/**
 * Project-relative paths whose mtime we compare against `index.html`.
 * Order matters only for the human-readable message — the FIRST file in
 * this list that's newer wins the "primary culprit" slot. Putting
 * `script.json` first means the most common case (user edited the
 * script) is shown clearly.
 */
const TRACKED_FILES_RELATIVE: ReadonlyArray<string> = [
  "script.json",
  "script.generated.json",
  "visual-direction.json",
  "assets/images.json",
  "assets/sfx/sfx.manifest.json",
  "assets/music/music.manifest.json",
  "DESIGN.md",
  "DESIGN-ART.md",
  "design-art.md",
  "RESEARCH.md",
  "research.md",
];

/**
 * Directories scanned recursively for newer files. Adding a new image,
 * generating SFX, or regenerating voiceovers should mark the HTML stale
 * even if the manifest itself wasn't touched (e.g. deduped or replaced
 * in place).
 */
const TRACKED_DIRECTORIES_RELATIVE: ReadonlyArray<string> = [
  "voiceovers",
  "assets/sfx",
  "assets/music",
  "assets/images",
];

/** Maximum number of "newer source files" we report. The UI shows them
 *  inline — five is more than enough to communicate the issue. */
const MAX_NEWER_FILES_REPORTED = 5;

export type StaleReason = "no-html" | "no-stamp" | "core-version-changed" | "source-files-newer";

export interface AssemblyStatus {
  /** Project-relative path of the assembled HTML (default: index.html). */
  htmlPath: string;
  /** True iff the HTML file exists at htmlPath. */
  exists: boolean;
  /** ISO timestamp from the `hyperframes:assembled-at` meta. null when
   *  the HTML is missing or doesn't carry the stamp. */
  assembledAt: string | null;
  /** Core version recorded in the HTML's stamp. null when missing. */
  coreVersion: string | null;
  /** Core version of the currently-running `@hyperframes/core`. */
  currentCoreVersion: string;
  /** Project-relative paths of files whose mtime exceeds the HTML's. */
  sourceFilesNewer: ReadonlyArray<string>;
  /** True when coreVersion is set AND differs from currentCoreVersion. */
  coreVersionChanged: boolean;
  /** Top-level summary: should the UI show the Regenerate CTA? */
  stale: boolean;
  /** Machine-readable list of reasons (UI maps these to copy). */
  reasons: ReadonlyArray<StaleReason>;
  /** Human-readable summary, suitable for a tooltip. */
  message: string;
}

export interface AssemblyStatusOptions {
  projectDir: string;
  /** Default: "index.html". */
  htmlPath?: string;
  /**
   * Test seam — overrides the running core version detection. Production
   * callers leave this undefined.
   */
  currentCoreVersion?: string;
}

/**
 * Compute the staleness status for a project's assembled HTML. Pure with
 * respect to the project (no writes). Designed to run on every studio
 * refresh and on every Storyline tab mount — no I/O beyond a handful of
 * stat() calls and one readFileSync() of the HTML head.
 */
export function computeAssemblyStatus(opts: AssemblyStatusOptions): AssemblyStatus {
  const htmlPath = opts.htmlPath ?? "index.html";
  const absHtml = join(opts.projectDir, htmlPath);
  const currentCoreVersion = opts.currentCoreVersion ?? getCoreVersion();

  if (!existsSync(absHtml)) {
    return {
      htmlPath,
      exists: false,
      assembledAt: null,
      coreVersion: null,
      currentCoreVersion,
      sourceFilesNewer: [],
      coreVersionChanged: false,
      stale: true,
      reasons: ["no-html"],
      message: `No ${htmlPath} found. Generate or assemble the project to produce one.`,
    };
  }

  const stamp = readStamp(absHtml);
  const htmlMtimeMs = safeStatMs(absHtml);
  const sourceFilesNewer = htmlMtimeMs
    ? listSourceFilesNewerThan(opts.projectDir, htmlMtimeMs).slice(0, MAX_NEWER_FILES_REPORTED)
    : [];

  const coreVersionChanged = Boolean(stamp.coreVersion && stamp.coreVersion !== currentCoreVersion);
  const reasons: StaleReason[] = [];
  if (!stamp.coreVersion && !stamp.assembledAt) reasons.push("no-stamp");
  if (coreVersionChanged) reasons.push("core-version-changed");
  if (sourceFilesNewer.length > 0) reasons.push("source-files-newer");

  const stale = reasons.length > 0;
  return {
    htmlPath,
    exists: true,
    assembledAt: stamp.assembledAt,
    coreVersion: stamp.coreVersion,
    currentCoreVersion,
    sourceFilesNewer,
    coreVersionChanged,
    stale,
    reasons,
    message: buildMessage({
      reasons,
      stamp,
      currentCoreVersion,
      sourceFilesNewer,
    }),
  };
}

interface ParsedStamp {
  assembledAt: string | null;
  coreVersion: string | null;
}

/**
 * Parse the `<meta name="hyperframes:assembled-at" …>` and core-version
 * meta tags out of the HTML's head. Reads at most the first 16KB so the
 * scan stays cheap even on multi-MB assembled files. Exported for tests.
 */
export function readStamp(absHtmlPath: string): ParsedStamp {
  try {
    // The head fits comfortably in 16KB even for projects with 30+ scenes.
    // We only need the meta tags so don't bother streaming the whole file.
    const head = readFileSync(absHtmlPath, "utf-8").slice(0, 16_384);
    return {
      assembledAt: extractMetaContent(head, ASSEMBLED_AT_META),
      coreVersion: extractMetaContent(head, CORE_VERSION_META),
    };
  } catch {
    return { assembledAt: null, coreVersion: null };
  }
}

/**
 * Extract `<meta name="X" content="Y">` value from an HTML head. Tolerates
 * single/double-quoted attrs and whitespace variation. Returns null when
 * the meta is absent.
 */
export function extractMetaContent(html: string, metaName: string): string | null {
  // Build the regex from a fixed metaName — never user-controlled — so we
  // don't risk regex injection.
  const escaped = metaName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<meta\\s+name=["']${escaped}["']\\s+content=["']([^"']*)["']\\s*/?>`, "i");
  const m = re.exec(html);
  return m && m[1] ? m[1] : null;
}

function safeStatMs(absPath: string): number | null {
  try {
    return statSync(absPath).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Walk the curated tracked-files / tracked-directories list and return
 * project-relative paths whose mtime is later than the threshold. Pure;
 * doesn't follow symlinks or descend into non-default directories.
 */
function listSourceFilesNewerThan(projectDir: string, htmlMtimeMs: number): string[] {
  const out: string[] = [];

  for (const rel of TRACKED_FILES_RELATIVE) {
    const abs = join(projectDir, rel);
    const m = safeStatMs(abs);
    if (m !== null && m > htmlMtimeMs) {
      out.push(rel);
    }
  }

  for (const dirRel of TRACKED_DIRECTORIES_RELATIVE) {
    const newest = newestFileInDirectory(projectDir, dirRel, htmlMtimeMs);
    if (newest) out.push(newest);
  }

  // Stable order so tests can assert without sorting.
  return out;
}

/**
 * Return the project-relative path of the newest file under `dirRel`
 * whose mtime exceeds the threshold, or null if the directory is missing
 * / empty / older than the threshold. We only need ONE representative
 * file per directory — listing every regenerated voiceover is noise in
 * the UI.
 *
 * One level deep is sufficient for current layout (voiceovers/, sfx/,
 * music/, images/ — all flat). Recursing further isn't worth the cost.
 */
function newestFileInDirectory(
  projectDir: string,
  dirRel: string,
  thresholdMs: number,
): string | null {
  const absDir = join(projectDir, dirRel);
  if (!existsSync(absDir)) return null;
  let bestMs = thresholdMs;
  let bestPath: string | null = null;
  let entries: string[] = [];
  try {
    // These directories have at most ~50 entries — sync read is fine.
    entries = readdirSync(absDir);
  } catch {
    return null;
  }
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const abs = join(absDir, name);
    const m = safeStatMs(abs);
    if (m !== null && m > bestMs) {
      bestMs = m;
      bestPath = relative(projectDir, abs);
    }
  }
  return bestPath;
}

/** Pretty human-readable message for the studio tooltip. */
function buildMessage(args: {
  reasons: StaleReason[];
  stamp: ParsedStamp;
  currentCoreVersion: string;
  sourceFilesNewer: ReadonlyArray<string>;
}): string {
  if (args.reasons.length === 0) return "Up to date.";
  const parts: string[] = [];
  if (args.reasons.includes("core-version-changed") && args.stamp.coreVersion) {
    parts.push(
      `core ${args.stamp.coreVersion} → ${args.currentCoreVersion}; new features and bug-fixes have shipped since this index.html was assembled.`,
    );
  }
  if (args.reasons.includes("no-stamp")) {
    parts.push(
      `index.html was assembled by an older Hyperframes version that didn't stamp itself; we can't tell which features it includes.`,
    );
  }
  if (args.reasons.includes("source-files-newer") && args.sourceFilesNewer.length > 0) {
    const list = args.sourceFilesNewer.slice(0, 3).join(", ");
    const suffix =
      args.sourceFilesNewer.length > 3 ? ` and ${args.sourceFilesNewer.length - 3} more` : "";
    parts.push(`source files newer than index.html: ${list}${suffix}.`);
  }
  return parts.join(" ");
}
