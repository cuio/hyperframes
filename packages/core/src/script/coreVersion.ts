/**
 * Resolve the running `@hyperframes/core` package version. Used by
 * `assemble.ts` to stamp the assembled HTML so the studio can detect
 * version drift, and by the staleness route to compare against the
 * stamp.
 *
 * Reads from `packages/core/package.json` at module-load time. We avoid
 * the simpler `import pkg from "../../package.json" assert { type: "json" }`
 * because Node's import-attribute support varies across the bun + tsx
 * + node combinations the CLI runs under, and the studio dev server
 * bundles this file with vite which has its own preferences.
 *
 * The fallback string is `0.0.0-dev` — emitted when the package.json read
 * fails for any reason (test fixtures, source-mode where the file path
 * doesn't resolve cleanly). Any non-default value indicates a real
 * shipped package.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FALLBACK = "0.0.0-dev";

let cached: string | null = null;

export function getCoreVersion(): string {
  if (cached !== null) return cached;
  cached = resolveCoreVersion();
  return cached;
}

function resolveCoreVersion(): string {
  // Walk upward from this module's directory until we hit the nearest
  // package.json. Source layout: packages/core/src/script/coreVersion.ts
  // → look at packages/core/package.json. After tsc build the file lives
  // at packages/core/dist/script/coreVersion.js, so the same walk works.
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    let dir = here;
    for (let i = 0; i < 6; i++) {
      try {
        const candidate = join(dir, "package.json");
        const pkg = JSON.parse(readFileSync(candidate, "utf-8")) as {
          name?: string;
          version?: string;
        };
        if (pkg.name === "@hyperframes/core" && typeof pkg.version === "string") {
          return pkg.version;
        }
      } catch {
        /* not here, walk up */
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    /* fallthrough */
  }
  return FALLBACK;
}

/**
 * Test seam — lets unit tests inject a deterministic version without
 * monkey-patching the cache. NOT exported via the package index.
 */
export function __setCoreVersionForTesting(version: string | null): void {
  cached = version;
}
