import { memo, useCallback, useEffect, useRef, useState } from "react";

interface CostBadgeProps {
  projectId: string;
}

interface CostsResponse {
  totalCostUsd: number;
  totalWallMs: number;
  entryCount: number;
  byOp: Array<{ label: string; count: number; costUsd: number; wallMs: number }>;
  byKind: Array<{ label: string; count: number; costUsd: number; wallMs: number }>;
  recent: Array<{
    ts: string;
    op: string;
    costUsd: number;
    wallMs: number;
    details: { kind: string };
  }>;
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

function fmtUsd(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function fmtWallMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

/**
 * Top-bar badge showing the running cost of the active project. Polls the
 * studio cost endpoint every 5s while mounted; clicking opens a popover
 * with the per-kind breakdown and recent activity. Designed to be
 * lightweight — one small fetch on a 5s cadence is negligible while still
 * feeling live during a plan / generate / render run.
 */
export const CostBadge = memo(function CostBadge({ projectId }: CostBadgeProps) {
  const [data, setData] = useState<CostsResponse | null>(null);
  const [open, setOpen] = useState(false);
  const acRef = useRef<AbortController | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    acRef.current?.abort();
    const ac = new AbortController();
    acRef.current = ac;
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/costs?limit=8`, {
        signal: ac.signal,
      });
      if (ac.signal.aborted) return;
      if (!res.ok) return;
      const next = (await res.json()) as CostsResponse;
      if (ac.signal.aborted) return;
      setData(next);
    } catch (err) {
      if (isAbort(err) || ac.signal.aborted) return;
      console.warn("[CostBadge] refresh failed", err);
    }
  }, [projectId]);

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 5_000);
    return () => {
      clearInterval(id);
      acRef.current?.abort();
    };
  }, [refresh]);

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const total = data?.totalCostUsd ?? 0;
  const tone =
    total === 0
      ? "text-neutral-500 border-neutral-800"
      : total < 1
        ? "text-studio-accent border-studio-accent/30 bg-studio-accent/5"
        : "text-amber-300 border-amber-700/40 bg-amber-950/30";

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`h-7 px-2 flex items-center gap-1.5 rounded-md border text-[11px] font-mono transition-colors ${tone}`}
        title="Project production cost — Anthropic + ElevenLabs + render. Click for breakdown."
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path
            d="M12 2v20M5 8c0-1.7 1.5-3 3.5-3h7c2 0 3.5 1.3 3.5 3s-1.5 3-3.5 3h-7c-2 0-3.5 1.3-3.5 3s1.5 3 3.5 3h7c2 0 3.5 1.3 3.5 3"
            stroke="currentColor"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
        <span>{fmtUsd(total)}</span>
        {data && data.entryCount > 0 && (
          <span className="text-neutral-600">· {data.entryCount}</span>
        )}
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 z-50 w-80 rounded-md border border-neutral-800 bg-neutral-950 shadow-2xl">
          <div className="px-3 py-2 border-b border-neutral-800/50 flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-wider text-neutral-500">
              Production cost
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              className="text-[10px] text-neutral-500 hover:text-neutral-300"
              title="Refresh"
            >
              ↻
            </button>
          </div>

          <div className="px-3 py-2.5 border-b border-neutral-800/50">
            <div className="text-[20px] font-mono text-neutral-100">{fmtUsd(total)}</div>
            <div className="text-[10px] text-neutral-500 mt-0.5">
              {data?.entryCount ?? 0} ops · {fmtWallMs(data?.totalWallMs ?? 0)} wall time
            </div>
          </div>

          {data && data.byKind.length > 0 && (
            <div className="px-3 py-2 border-b border-neutral-800/50">
              <div className="text-[9px] uppercase tracking-wider text-neutral-500 mb-1">
                By kind
              </div>
              {data.byKind.map((row) => (
                <div
                  key={row.label}
                  className="flex items-center justify-between text-[11px] py-0.5"
                >
                  <span className="text-neutral-300">{row.label}</span>
                  <span className="font-mono text-neutral-400">
                    {row.count} · <span className="text-studio-accent">{fmtUsd(row.costUsd)}</span>
                  </span>
                </div>
              ))}
            </div>
          )}

          {data && data.recent.length > 0 && (
            <div className="px-3 py-2 max-h-56 overflow-y-auto">
              <div className="text-[9px] uppercase tracking-wider text-neutral-500 mb-1">
                Recent
              </div>
              {data.recent.map((e, i) => (
                <div
                  key={`${e.ts}-${i}`}
                  className="flex items-baseline justify-between text-[10px] py-0.5"
                >
                  <span className="text-neutral-400 truncate flex-1">{e.op}</span>
                  <span className="font-mono text-neutral-500 ml-2">{fmtWallMs(e.wallMs)}</span>
                  <span className="font-mono text-studio-accent ml-2">{fmtUsd(e.costUsd)}</span>
                </div>
              ))}
            </div>
          )}

          {(!data || data.entryCount === 0) && (
            <div className="px-3 py-3 text-[11px] text-neutral-500 leading-relaxed">
              No costs logged yet. Plan a script, synthesize voice, or render — costs accumulate per
              project.
            </div>
          )}

          <div className="px-3 py-1.5 border-t border-neutral-800/50 text-[9px] text-neutral-600">
            Logged to <code className="font-mono text-neutral-500">.hyperframes/costs.jsonl</code>
          </div>
        </div>
      )}
    </div>
  );
});
