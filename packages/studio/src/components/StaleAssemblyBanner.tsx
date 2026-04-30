import { memo, useCallback, useEffect, useRef, useState } from "react";

/**
 * Mirrors `AssemblyStatus` from packages/core/src/script/assembleStaleness.ts.
 * Kept as a local type to avoid the studio package taking a runtime import on
 * core internals.
 */
type StaleReason = "no-html" | "no-stamp" | "core-version-changed" | "source-files-newer";

interface AssemblyStatus {
  htmlPath: string;
  exists: boolean;
  assembledAt: string | null;
  coreVersion: string | null;
  currentCoreVersion: string;
  sourceFilesNewer: ReadonlyArray<string>;
  coreVersionChanged: boolean;
  stale: boolean;
  reasons: ReadonlyArray<StaleReason>;
  message: string;
}

interface StaleAssemblyBannerProps {
  projectId: string;
  /** Bumped externally to force a re-poll (e.g. after a script mutation). */
  refreshKey?: number;
}

const POLL_INTERVAL_MS = 30_000;

/**
 * Lightweight chip for the studio topbar that surfaces "your index.html is
 * stale, click to re-assemble" without nagging.
 *
 * Behavior:
 * - Polls /script/assembly-status every 30s + on mount + when refreshKey
 *   changes. Cheap call, no LLM.
 * - When `stale === true`, renders an amber chip with the reason. Click to
 *   POST /script/assemble; chip flips to "Regenerating…" then back to
 *   "Up to date" on success (or shows the error if it fails).
 * - Renders nothing when status === up-to-date — keeps the topbar clean
 *   for the 99% case.
 *
 * The reason copy is deliberately compact: full detail lives in the
 * tooltip so the topbar stays scannable.
 */
export const StaleAssemblyBanner = memo(function StaleAssemblyBanner({
  projectId,
  refreshKey,
}: StaleAssemblyBannerProps) {
  const [status, setStatus] = useState<AssemblyStatus | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const acRef = useRef<AbortController | null>(null);

  const fetchStatus = useCallback(async () => {
    acRef.current?.abort();
    const ac = new AbortController();
    acRef.current = ac;
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/script/assembly-status`,
        { signal: ac.signal },
      );
      if (ac.signal.aborted) return;
      if (!res.ok) {
        // 404 (no project) or 500 — silently swallow; banner just hides.
        setStatus(null);
        return;
      }
      const data = (await res.json()) as AssemblyStatus;
      if (ac.signal.aborted) return;
      setStatus(data);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      // Network error — hide rather than scream.
      setStatus(null);
    }
  }, [projectId]);

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    void fetchStatus();
    const id = window.setInterval(fetchStatus, POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(id);
      acRef.current?.abort();
    };
  }, [fetchStatus, refreshKey]);

  const onRegenerate = useCallback(async () => {
    setRegenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/script/assemble`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json().catch(() => ({}))) as {
        status?: AssemblyStatus;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      if (data.status) setStatus(data.status);
      else await fetchStatus();
      // Force the preview iframe to reload — the assembled HTML changed.
      // Listeners can subscribe to the same event from elsewhere.
      try {
        window.dispatchEvent(new CustomEvent("hf:assembly-regenerated"));
      } catch {
        /* ignore */
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRegenerating(false);
    }
  }, [projectId, fetchStatus]);

  if (!status || !status.stale) return null;

  // Map reasons to a 1-word leading label. The full sentence lives in
  // status.message and is shown via the title attribute.
  const headline = pickHeadline(status);

  return (
    <div className="flex items-center gap-1.5 h-7 px-2 rounded-md border border-amber-700/40 bg-amber-950/30 text-amber-200/90">
      <span aria-hidden className="text-[11px]">
        ⚠
      </span>
      <span
        className="text-[11px] font-medium leading-none"
        title={error ? `Regenerate failed: ${error}\n\n${status.message}` : status.message}
      >
        {headline}
      </span>
      <button
        type="button"
        onClick={() => void onRegenerate()}
        disabled={regenerating}
        className="ml-1 h-5 px-2 rounded-md text-[10px] font-medium uppercase tracking-wider border border-amber-700/50 bg-amber-900/30 hover:bg-amber-900/60 text-amber-100 disabled:opacity-50 disabled:cursor-not-allowed"
        title="Re-assemble index.html (no audio re-synth, ~2s)"
      >
        {regenerating ? "Regenerating…" : "Regenerate"}
      </button>
    </div>
  );
});

function pickHeadline(status: AssemblyStatus): string {
  if (status.reasons.includes("no-html")) return "No index.html";
  if (status.reasons.includes("core-version-changed")) {
    return `Core ${status.coreVersion} → ${status.currentCoreVersion}`;
  }
  if (status.reasons.includes("source-files-newer")) {
    const n = status.sourceFilesNewer.length;
    if (n === 0) return "Stale";
    return `${n} source file${n === 1 ? "" : "s"} newer than index.html`;
  }
  if (status.reasons.includes("no-stamp")) return "Older index.html (no stamp)";
  return "Stale";
}
