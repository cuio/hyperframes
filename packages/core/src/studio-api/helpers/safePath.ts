import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

/**
 * Find the realpath of the deepest existing ancestor of `p` (inclusive).
 * Used by isSafePath to defeat symlink-based escapes in write paths.
 *
 * Returns null if no ancestor exists (shouldn't happen — `/` always exists).
 */
function realpathOfDeepestExisting(p: string): string | null {
  let cur = resolve(p);
  // Cap iterations to avoid pathological inputs.
  for (let i = 0; i < 64; i++) {
    try {
      lstatSync(cur);
      return realpathSync(cur);
    } catch {
      const parent = dirname(cur);
      if (parent === cur) return null;
      cur = parent;
    }
  }
  return null;
}

/**
 * Reject paths that escape the project directory, even via symlinks.
 *
 * The check resolves both `base` and `resolved` through `realpathSync` so a
 * symlink under base that points outside is detected. For write paths where
 * `resolved` does not yet exist, we resolve the deepest existing ancestor and
 * require that to live under the base — any not-yet-created descendant
 * components cannot introduce a symlink (they don't exist yet).
 */
export function isSafePath(base: string, resolved: string): boolean {
  let realBase: string;
  try {
    realBase = realpathSync(resolve(base));
  } catch {
    return false;
  }
  const target = resolve(resolved);
  const realAncestor = realpathOfDeepestExisting(target);
  if (realAncestor == null) return false;
  const norm = realBase + sep;
  return realAncestor === realBase || realAncestor.startsWith(norm);
}

const IGNORE_DIRS = new Set([".thumbnails", "node_modules", ".git"]);

/** Recursively walk a directory and return relative file paths. */
export function walkDir(dir: string, prefix = ""): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...walkDir(join(dir, entry.name), rel));
    } else {
      files.push(rel);
    }
  }
  return files;
}
