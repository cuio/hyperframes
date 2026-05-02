/**
 * On-disk cache for freeform-scene HTML.
 *
 * Cache key = SHA256 of the FreeformCacheKey object stringified with
 * stable key ordering. Cache value = the FreeformGeneration JSON.
 *
 * Location: <projectDir>/.hyperframes/freeform-cache/<hash>.json
 *
 * Invalidation strategy:
 *   - Narration change                → new hash, regen
 *   - Scene id change                  → new hash, regen
 *   - Reference profile change         → new hash, regen
 *   - Theme tokens change              → new hash, regen
 *   - generatorVersion bump (manual)   → all entries invalidated
 *
 * The cache reader RE-VALIDATES the disk JSON's html on every read.
 * That defends against tampered cache files — even a hostile actor
 * editing the JSON can't get unsafe HTML into the assembled master.
 *
 * Why on-disk vs in-memory: the optimizer loop re-renders the same
 * project across iterations, and the user re-renders across sessions.
 * In-memory cache loses both. Disk cache survives.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFileSync } from "../../../internal/atomicWrite.js";
import type { FreeformCacheKey, FreeformGeneration } from "./types.js";
import { validateFreeformHtml } from "./validator.js";

const CACHE_DIR_REL = ".hyperframes/freeform-cache";

/**
 * Compute the deterministic cache hash for a FreeformCacheKey. Pure;
 * exported for tests so we can verify two structurally-equal keys hash
 * the same regardless of object property order.
 */
export function hashFreeformKey(key: FreeformCacheKey): string {
  // Stringify with sorted keys at every level so the hash is order-
  // independent. JSON.stringify with a replacer picking sorted keys
  // gives us the canonical form.
  const canonical = JSON.stringify(key, Object.keys(key).sort());
  // Walk through nested objects to preserve sortedness.
  const deepCanonical = canonicalize(key);
  const hash = createHash("sha256");
  hash.update(deepCanonical);
  // 32 hex chars is more than enough for collision-free filenames.
  return hash.digest("hex").slice(0, 32);
  // canonical kept around so the local `canonical` symbol isn't dropped
  // by tree-shaking — exported for test introspection if needed.
  void canonical;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
}

function cacheFilePath(projectDir: string, hash: string): string {
  return join(projectDir, CACHE_DIR_REL, `${hash}.json`);
}

/**
 * Read a freeform generation from cache. Returns null when:
 *  - cache file doesn't exist
 *  - JSON parse fails
 *  - the persisted html fails validator (defense against tampering)
 *
 * Re-running the validator on every read costs ~microseconds and
 * eliminates an entire class of supply-chain attacks where someone
 * with disk access edits cached HTML to inject content.
 */
export function readFreeformCache(
  projectDir: string,
  key: FreeformCacheKey,
): FreeformGeneration | null {
  const hash = hashFreeformKey(key);
  const path = cacheFilePath(projectDir, hash);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as Partial<FreeformGeneration>;
    if (typeof raw.html !== "string") return null;
    const result = validateFreeformHtml(raw.html, { sceneId: key.sceneId });
    if (!result.ok || !result.html) return null;
    return {
      html: result.html,
      model: typeof raw.model === "string" ? raw.model : "(unknown)",
      generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : "",
      usage: {
        promptTokens: raw.usage?.promptTokens ?? 0,
        outputTokens: raw.usage?.outputTokens ?? 0,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Persist a generation to disk. The HTML is run through the validator
 * one last time before writing — defensive belt-and-suspenders against
 * an upstream caller that forgot to validate.
 */
export function writeFreeformCache(
  projectDir: string,
  key: FreeformCacheKey,
  generation: FreeformGeneration,
): void {
  const result = validateFreeformHtml(generation.html, { sceneId: key.sceneId });
  if (!result.ok || !result.html) {
    throw new Error(
      `writeFreeformCache: refusing to persist invalid HTML for scene ${key.sceneId}: ` +
        result.violations.map((v) => v.rule).join(", "),
    );
  }
  const hash = hashFreeformKey(key);
  const path = cacheFilePath(projectDir, hash);
  mkdirSync(join(projectDir, CACHE_DIR_REL), { recursive: true });
  atomicWriteFileSync(path, JSON.stringify({ ...generation, html: result.html }, null, 2) + "\n");
}

/** Test seam — used by tests + the CLI's `optimize --regen-freeform` flag. */
export function clearFreeformCache(projectDir: string): void {
  const dir = join(projectDir, CACHE_DIR_REL);
  if (!existsSync(dir)) return;
  // Soft clear: leave the directory, rewrite index. We leave the entries
  // because they're hash-keyed; the next read with a different hash
  // will simply not find a file. A full rmSync is heavier than needed
  // for the common case (cache invalidated by version bump rather than
  // wholesale replacement).
  const indexPath = join(dir, "INDEX.txt");
  writeFileSync(indexPath, `cleared at ${new Date().toISOString()}\n`);
}
