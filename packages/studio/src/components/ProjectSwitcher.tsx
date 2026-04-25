import { memo, useCallback, useEffect, useRef, useState } from "react";

interface ProjectSummary {
  id: string;
  title?: string;
}

interface ProjectSwitcherProps {
  currentId: string;
}

export const ProjectSwitcher = memo(function ProjectSwitcher({ currentId }: ProjectSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      if (!res.ok) return;
      const data = (await res.json()) as { projects: ProjectSummary[] };
      setProjects(data.projects ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (open) void loadProjects();
  }, [open, loadProjects]);

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const switchTo = useCallback(
    (id: string) => {
      if (id === currentId) {
        setOpen(false);
        return;
      }
      window.location.hash = `#project/${id}`;
      window.location.reload();
    },
    [currentId],
  );

  const create = useCallback(async () => {
    const id = draftName.trim();
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, title: id }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { project: ProjectSummary };
      setDraftName("");
      setCreating(false);
      switchTo(data.project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [draftName, switchTo]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="h-7 px-2 flex items-center gap-1.5 rounded-md border border-neutral-800 hover:border-neutral-700 text-[11px] font-medium text-neutral-300 hover:text-neutral-100 transition-colors"
        title="Switch project"
      >
        <span className="font-medium">{currentId}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 w-64 rounded-md border border-neutral-800 bg-neutral-950 shadow-2xl">
          <div className="p-2 border-b border-neutral-800/50">
            <div className="text-[10px] uppercase tracking-wider text-neutral-500">Projects</div>
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {projects.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-neutral-500">No projects yet.</div>
            ) : (
              projects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => switchTo(p.id)}
                  className={`w-full text-left px-3 py-1.5 text-[11px] hover:bg-neutral-800/50 transition-colors flex items-center justify-between gap-2 ${
                    p.id === currentId ? "text-studio-accent" : "text-neutral-200"
                  }`}
                >
                  <span className="truncate font-medium">{p.title || p.id}</span>
                  {p.id === currentId && <span className="text-[9px] uppercase">active</span>}
                </button>
              ))
            )}
          </div>
          <div className="border-t border-neutral-800/50 p-2">
            {!creating ? (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="w-full h-7 rounded-md text-[11px] font-medium border border-studio-accent/40 bg-studio-accent/10 text-studio-accent hover:bg-studio-accent/15"
              >
                + New project
              </button>
            ) : (
              <div className="flex flex-col gap-1.5">
                <input
                  type="text"
                  autoFocus
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && draftName.trim() && !busy) void create();
                    if (e.key === "Escape") {
                      setCreating(false);
                      setDraftName("");
                      setError(null);
                    }
                  }}
                  placeholder="my-next-video"
                  className="h-7 bg-neutral-900 border border-neutral-800 rounded-md px-2 text-[11px] text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-neutral-700 font-mono"
                />
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => void create()}
                    disabled={!draftName.trim() || busy}
                    className="flex-1 h-7 rounded-md text-[11px] font-medium border border-studio-accent/40 bg-studio-accent/10 text-studio-accent hover:bg-studio-accent/15 disabled:opacity-40"
                  >
                    {busy ? "Creating…" : "Create"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCreating(false);
                      setDraftName("");
                      setError(null);
                    }}
                    className="h-7 px-2 rounded-md text-[11px] text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/50"
                  >
                    Cancel
                  </button>
                </div>
                {error && <div className="text-[10px] text-red-400">{error}</div>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});
