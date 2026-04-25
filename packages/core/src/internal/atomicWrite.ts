import { chmodSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Atomic on-disk write: write content to a sibling temp file, fsync (via
 * writeFileSync's flush), then rename onto the target. POSIX `rename` is
 * atomic on the same filesystem, so a crash mid-write cannot leave a partial
 * file at the target path. Parent directories are created if missing.
 *
 * Use this for any small file whose corruption would be a problem — secrets,
 * project configs, manifests. Not appropriate for very large files (the temp
 * doubles peak disk usage).
 */
export function atomicWriteFileSync(
  filePath: string,
  content: string | Uint8Array,
  options: { mode?: number; dirMode?: number } = {},
): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true, mode: options.dirMode ?? 0o755 });
  const tmp = `${filePath}.tmp.${process.pid}.${randomBytes(6).toString("hex")}`;
  try {
    if (options.mode != null) {
      writeFileSync(tmp, content, { mode: options.mode });
      // Some platforms ignore the mode arg or apply umask; chmod to be sure.
      chmodSync(tmp, options.mode);
    } else {
      writeFileSync(tmp, content);
    }
    renameSync(tmp, filePath);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      /* tmp may not exist */
    }
    throw err;
  }
}

/**
 * Single-flight mutex keyed by an arbitrary string. Subsequent calls with the
 * same key wait for the previous promise to settle before running, so two
 * concurrent settings PATCHes on the same project serialize cleanly without
 * needing a real on-disk lockfile.
 */
const locks = new Map<string, Promise<unknown>>();

export async function withMutex<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  // Track the next slot so a third call queues behind it. Clean up when done so
  // we don't accumulate completed promises forever.
  locks.set(
    key,
    next.finally(() => {
      if (locks.get(key) === next) locks.delete(key);
    }),
  );
  return next;
}
