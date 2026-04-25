import { memo, useCallback, useEffect, useRef, useState } from "react";

interface SceneVariant {
  id: string;
  text: string;
  template: string;
  props: Record<string, unknown>;
  hook?: boolean;
  reasoning?: string;
  label?: string;
}

interface VariantsModalProps {
  projectId: string;
  sceneId: string;
  sceneText: string;
  currentTemplate: string;
  onClose: () => void;
  onPick: (variant: SceneVariant) => void;
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

export const VariantsModal = memo(function VariantsModal({
  projectId,
  sceneId,
  sceneText,
  currentTemplate,
  onClose,
  onPick,
}: VariantsModalProps) {
  const [loading, setLoading] = useState(true);
  const [variants, setVariants] = useState<SceneVariant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);

  // Abort controllers: load() may be re-invoked (Regenerate button); pick is one-shot.
  // Both are cancelled on unmount so a late response cannot setState on a dead component
  // or invoke onPick (which mutates parent script) with stale variants.
  const loadAcRef = useRef<AbortController | null>(null);
  const pickAcRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    loadAcRef.current?.abort();
    const ac = new AbortController();
    loadAcRef.current = ac;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/script/scenes/${encodeURIComponent(sceneId)}/variants`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ count: 3 }),
          signal: ac.signal,
        },
      );
      if (ac.signal.aborted) return;
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (ac.signal.aborted) return;
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { variants: SceneVariant[] };
      if (ac.signal.aborted) return;
      setVariants(data.variants ?? []);
    } catch (err) {
      if (isAbort(err) || ac.signal.aborted) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [projectId, sceneId]);

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    void load();
    return () => loadAcRef.current?.abort();
  }, [load]);

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    return () => pickAcRef.current?.abort();
  }, []);

  const handlePick = useCallback(
    async (variant: SceneVariant) => {
      pickAcRef.current?.abort();
      const ac = new AbortController();
      pickAcRef.current = ac;
      setPicking(variant.label ?? variant.template);
      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/script/scenes/${encodeURIComponent(sceneId)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ scene: variant }),
            signal: ac.signal,
          },
        );
        if (ac.signal.aborted) return;
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          if (ac.signal.aborted) return;
          setError(data.error ?? `HTTP ${res.status}`);
          return;
        }
        // The server has accepted the variant; commit it to parent state and close.
        // onPick / onClose are parent setters — safe to call (parent owns its lifecycle).
        onPick(variant);
        onClose();
      } catch (err) {
        if (isAbort(err) || ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!ac.signal.aborted) setPicking(null);
      }
    },
    [projectId, sceneId, onPick, onClose],
  );

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="relative w-[min(1100px,92vw)] max-h-[88vh] overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-neutral-800 bg-neutral-950/95 backdrop-blur px-6 py-4">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.18em] text-neutral-500 mb-1">
              Pick a visual treatment for {sceneId}
            </div>
            <div className="text-[15px] text-neutral-100 leading-snug max-w-[800px]">
              {sceneText}
            </div>
            <div className="text-[10px] text-neutral-500 mt-1">
              Currently using: <span className="text-neutral-300 font-mono">{currentTemplate}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="h-7 px-3 rounded-md text-[11px] font-medium border border-neutral-800 text-neutral-400 hover:text-neutral-200 hover:border-neutral-700 disabled:opacity-40"
            >
              {loading ? "Generating…" : "↻ Regenerate"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="h-7 w-7 flex items-center justify-center rounded-md text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6">
          {loading && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-[280px] rounded-lg border border-neutral-800 bg-neutral-900/60 animate-pulse"
                />
              ))}
            </div>
          )}
          {!loading && error && (
            <div className="rounded-lg border border-red-900/50 bg-red-950/30 p-4 text-[12px] text-red-300">
              {error}
            </div>
          )}
          {!loading && !error && variants.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {variants.map((v, i) => (
                <button
                  key={v.label ?? `${v.template}-${i}`}
                  type="button"
                  onClick={() => void handlePick(v)}
                  disabled={picking != null}
                  className="text-left flex flex-col gap-3 rounded-lg border border-neutral-800 bg-neutral-900/60 p-4 hover:border-studio-accent/60 hover:bg-neutral-900 transition-colors group disabled:opacity-50"
                >
                  <div className="flex items-center gap-2">
                    <div className="h-7 w-7 rounded-md bg-studio-accent/10 border border-studio-accent/30 flex items-center justify-center text-[11px] font-mono text-studio-accent font-bold">
                      {String.fromCharCode(65 + i)}
                    </div>
                    <div className="text-[12px] font-medium text-neutral-100 truncate flex-1">
                      {v.label || v.template}
                    </div>
                  </div>
                  <div className="text-[10px] font-mono text-studio-accent">
                    {v.template}
                    {v.template === "chart-scene" &&
                      (() => {
                        const chart = v.props?.chart;
                        const type =
                          chart && typeof chart === "object" && "type" in chart
                            ? (chart as Record<string, unknown>).type
                            : null;
                        return typeof type === "string" ? (
                          <span className="text-neutral-400">
                            {" → "}
                            {type}
                          </span>
                        ) : null;
                      })()}
                  </div>
                  {v.reasoning && (
                    <div className="text-[11px] text-neutral-400 leading-relaxed line-clamp-6 italic">
                      {v.reasoning}
                    </div>
                  )}
                  <div className="mt-auto pt-2 border-t border-neutral-800">
                    <div className="text-[10px] text-neutral-500 group-hover:text-studio-accent transition-colors">
                      {picking === (v.label ?? v.template) ? "Applying…" : "→ Pick this treatment"}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
