import { memo, useCallback, useEffect, useRef, useState } from "react";

interface ImageFocal {
  x: number;
  y: number;
}

type ImageRole = "hero" | "subject" | "atmosphere" | "graphic";

type ImageAnalysisStatus = "pending" | "complete" | "failed";

interface ImageEntry {
  id: string;
  src: string;
  format: "webp" | "png" | "jpg";
  width: number;
  height: number;
  aspect: number;
  bytes: number;
  dominantColor: string;
  palette: string[];
  role: ImageRole | null;
  description: string;
  tags: string[];
  focalPoint: ImageFocal;
  importedAt: string;
  // Analyzer fields (Gemini Flash). Soft priors, all optional. See
  // packages/core/src/images/manifest.ts for the source of truth.
  vibe?: string;
  suggestedTreatment?: string | null;
  retentionStrengthAtAttachment?: number;
  analysisStatus?: ImageAnalysisStatus;
  analysisError?: string;
  analyzedAt?: string;
  analysisRationale?: string;
}

interface ImageManifest {
  version: 1;
  images: ImageEntry[];
}

interface ImagesTabProps {
  projectId: string;
}

const ROLES: ReadonlyArray<{ id: ImageRole; label: string; hint: string }> = [
  { id: "hero", label: "hero", hint: "Full-bleed dominant subject. Big moments, hooks." },
  { id: "subject", label: "subject", hint: "Detail / supporting shot. Crops, callouts, PIP." },
  { id: "atmosphere", label: "atmosphere", hint: "Mood. Lives behind text. Gradients, blurs." },
  { id: "graphic", label: "graphic", hint: "Abstract / iconographic. Accents, transitions." },
];

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1_048_576) return `${Math.round(n / 1024)}KB`;
  return `${(n / 1_048_576).toFixed(1)}MB`;
}

export const ImagesTab = memo(function ImagesTab({ projectId }: ImagesTabProps) {
  const [manifest, setManifest] = useState<ImageManifest | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const loadAcRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    loadAcRef.current?.abort();
    const ac = new AbortController();
    loadAcRef.current = ac;
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/images`, {
        signal: ac.signal,
      });
      if (ac.signal.aborted) return;
      if (!res.ok) {
        setLoadError(`HTTP ${res.status}`);
        return;
      }
      const next = (await res.json()) as ImageManifest;
      if (ac.signal.aborted) return;
      setManifest(next);
      setLoadError(null);
    } catch (err) {
      if (isAbort(err) || ac.signal.aborted) return;
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, [projectId]);

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    void refresh();
    return () => loadAcRef.current?.abort();
  }, [refresh]);

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      if (!files || files.length === 0) return;
      setUploading(true);
      setLoadError(null);
      try {
        for (const file of Array.from(files)) {
          const form = new FormData();
          form.append("file", file);
          const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/images`, {
            method: "POST",
            body: form,
          });
          if (!res.ok) {
            const data = (await res.json().catch(() => ({}))) as { error?: string };
            console.warn(`[images] upload failed for ${file.name}:`, data.error ?? res.status);
            setLoadError(`Upload failed for ${file.name}: ${data.error ?? res.status}`);
          }
        }
        await refresh();
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        setUploading(false);
      }
    },
    [projectId, refresh],
  );

  const onPickFiles = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) void uploadFiles(e.target.files);
      // Reset so the same file can be picked again after a delete.
      e.target.value = "";
    },
    [uploadFiles],
  );

  const patchEntry = useCallback(
    async (
      id: string,
      patch: Partial<Pick<ImageEntry, "role" | "description" | "tags" | "focalPoint">>,
    ) => {
      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/images/${encodeURIComponent(id)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
          },
        );
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          setLoadError(data.error ?? `HTTP ${res.status}`);
          return;
        }
        const data = (await res.json()) as { entry: ImageEntry };
        setManifest((prev) =>
          prev ? { ...prev, images: prev.images.map((i) => (i.id === id ? data.entry : i)) } : prev,
        );
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    },
    [projectId],
  );

  const removeEntry = useCallback(
    async (id: string) => {
      if (!confirm(`Remove image '${id}'? The file on disk will be unlinked.`)) return;
      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/images/${encodeURIComponent(id)}`,
          {
            method: "DELETE",
          },
        );
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          setLoadError(data.error ?? `HTTP ${res.status}`);
          return;
        }
        if (selectedId === id) setSelectedId(null);
        await refresh();
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    },
    [projectId, refresh, selectedId],
  );

  const reanalyzeEntry = useCallback(
    async (id: string) => {
      // Optimistically flip the entry to "pending" so the chip shows
      // "analyzing…" the moment the user clicks. The server's response
      // will replace it with either complete or failed.
      setManifest((prev) =>
        prev
          ? {
              ...prev,
              images: prev.images.map((i) =>
                i.id === id ? { ...i, analysisStatus: "pending", analysisError: undefined } : i,
              ),
            }
          : prev,
      );
      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/images/${encodeURIComponent(id)}/analyze`,
          { method: "POST" },
        );
        const data = (await res.json().catch(() => ({}))) as { entry?: ImageEntry; error?: string };
        if (data.entry) {
          setManifest((prev) =>
            prev
              ? {
                  ...prev,
                  images: prev.images.map((i) => (i.id === id ? (data.entry as ImageEntry) : i)),
                }
              : prev,
          );
        }
        if (!res.ok && data.error) {
          // Don't blow away the manifest with a top-level error — the
          // entry already shows "analysis failed" with the reason.
          console.warn(`[images] analyze failed: ${data.error}`);
        }
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    },
    [projectId],
  );

  const selected = manifest?.images.find((i) => i.id === selectedId) ?? null;

  return (
    <div
      className="flex flex-col flex-1 min-h-0"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer?.files?.length) void uploadFiles(e.dataTransfer.files);
      }}
    >
      {/* Drop zone / picker */}
      <div className="px-3 py-2 border-b border-neutral-800/50">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className={`w-full h-16 rounded-md border border-dashed flex items-center justify-center text-[11px] font-medium transition-colors ${
            dragOver
              ? "border-studio-accent bg-studio-accent/10 text-studio-accent"
              : uploading
                ? "border-neutral-700 text-neutral-500 cursor-wait"
                : "border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
          }`}
        >
          {uploading
            ? "Uploading…"
            : dragOver
              ? "Drop to upload"
              : "+ Drop or pick images (jpg/png/webp/heic)"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*"
          className="hidden"
          onChange={onPickFiles}
        />
        {loadError && <div className="mt-1.5 text-[10px] text-red-400">{loadError}</div>}
      </div>

      {/* Image list */}
      <div className="flex-1 overflow-y-auto">
        {!manifest && !loadError && (
          <div className="p-3 text-[11px] text-neutral-500">Loading…</div>
        )}
        {manifest && manifest.images.length === 0 && !uploading && (
          <div className="p-3 text-[11px] text-neutral-500 leading-relaxed">
            No images yet. Drop your Midjourney exports above and tag each with a role (hero /
            subject / atmosphere / graphic) so the visual director can use them.
          </div>
        )}
        {manifest && manifest.images.length > 0 && (
          <div className="p-2 flex flex-col gap-1.5">
            {manifest.images.map((img) => {
              const isSelected = selectedId === img.id;
              return (
                <div
                  key={img.id}
                  className={`rounded-md border bg-neutral-900/60 overflow-hidden transition-colors ${
                    isSelected
                      ? "border-studio-accent/40"
                      : "border-neutral-800 hover:border-neutral-700"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedId(isSelected ? null : img.id)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-neutral-800/40 text-left"
                  >
                    <div
                      className="h-8 w-8 rounded border border-neutral-800 flex-shrink-0 bg-cover bg-center"
                      style={{
                        backgroundImage: `url(/api/projects/${encodeURIComponent(projectId)}/images/${encodeURIComponent(img.id)}/file)`,
                        backgroundColor: img.dominantColor,
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[12px] font-medium text-neutral-200 truncate">
                          {img.id}
                        </span>
                        {img.role ? (
                          <span className="text-[9px] uppercase tracking-wider text-studio-accent">
                            {img.role}
                          </span>
                        ) : (
                          <span className="text-[9px] uppercase tracking-wider text-amber-400">
                            no role
                          </span>
                        )}
                        {img.analysisStatus === "pending" && (
                          <span
                            className="text-[9px] uppercase tracking-wider text-neutral-500"
                            title="Gemini analyzing — usually 1–2s"
                          >
                            analyzing…
                          </span>
                        )}
                        {img.analysisStatus === "complete" &&
                          typeof img.retentionStrengthAtAttachment === "number" && (
                            <span
                              className={`text-[9px] uppercase tracking-wider ${
                                img.retentionStrengthAtAttachment >= 7
                                  ? "text-emerald-400"
                                  : img.retentionStrengthAtAttachment >= 4
                                    ? "text-amber-400"
                                    : "text-rose-400"
                              }`}
                              title={
                                img.analysisRationale ?? "Analyzer retention-strength estimate"
                              }
                            >
                              R{img.retentionStrengthAtAttachment}
                            </span>
                          )}
                        {img.analysisStatus === "failed" && (
                          <span
                            className="text-[9px] uppercase tracking-wider text-rose-400"
                            title={img.analysisError ?? "Analysis failed"}
                          >
                            analysis failed
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-neutral-500 truncate">
                        {img.width}×{img.height} · {fmtBytes(img.bytes)} ·{" "}
                        {img.description.trim().length > 0 ? (
                          img.description
                        ) : img.vibe ? (
                          <span className="text-neutral-400 italic">{img.vibe}</span>
                        ) : (
                          <span className="text-neutral-600">no description</span>
                        )}
                      </div>
                    </div>
                  </button>
                  {isSelected && (
                    <ImageEditor
                      key={img.id}
                      img={img}
                      projectId={projectId}
                      onPatch={(patch) => patchEntry(img.id, patch)}
                      onRemove={() => removeEntry(img.id)}
                      onReanalyze={() => reanalyzeEntry(img.id)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Hidden mention to please lint when selected is unused; selected is read above */}
      {selected != null && null}
    </div>
  );
});

interface ImageEditorProps {
  img: ImageEntry;
  projectId: string;
  onPatch: (
    patch: Partial<Pick<ImageEntry, "role" | "description" | "tags" | "focalPoint">>,
  ) => Promise<void>;
  onRemove: () => Promise<void>;
  onReanalyze: () => Promise<void>;
}

function ImageEditor({ img, projectId, onPatch, onRemove, onReanalyze }: ImageEditorProps) {
  const [description, setDescription] = useState(img.description);
  const [tagsRaw, setTagsRaw] = useState(img.tags.join(", "));
  const previewRef = useRef<HTMLDivElement | null>(null);

  // Sync local edit state when the image entry changes underneath us
  // (e.g. focal point updated by clicking).
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    setDescription(img.description);
    setTagsRaw(img.tags.join(", "));
  }, [img.id, img.description, img.tags]);

  const onClickFocal = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = previewRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
      void onPatch({ focalPoint: { x, y } });
    },
    [onPatch],
  );

  return (
    <div className="border-t border-neutral-800 p-2 flex flex-col gap-2 bg-neutral-950/60">
      {/* Focal-point picker */}
      <div className="flex flex-col gap-1">
        <div className="text-[9px] uppercase tracking-wider text-neutral-500">
          Focal point — click on the image
        </div>
        <div
          ref={previewRef}
          onClick={onClickFocal}
          className="relative w-full rounded border border-neutral-800 overflow-hidden cursor-crosshair"
          style={{ aspectRatio: img.width / img.height }}
        >
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage: `url(/api/projects/${encodeURIComponent(projectId)}/images/${encodeURIComponent(img.id)}/file)`,
            }}
          />
          <div
            className="absolute h-3 w-3 -ml-1.5 -mt-1.5 rounded-full border-2 border-white shadow-[0_0_0_2px_rgba(0,0,0,0.6)]"
            style={{
              left: `${img.focalPoint.x * 100}%`,
              top: `${img.focalPoint.y * 100}%`,
              backgroundColor: "rgba(0,0,0,0.4)",
            }}
          />
        </div>
        <div className="text-[10px] text-neutral-500 font-mono">
          x: {img.focalPoint.x.toFixed(2)} · y: {img.focalPoint.y.toFixed(2)}
        </div>
      </div>

      {/* Role chips */}
      <div className="flex flex-col gap-1">
        <div className="text-[9px] uppercase tracking-wider text-neutral-500">Role</div>
        <div className="flex flex-wrap gap-1">
          {ROLES.map((r) => {
            const active = img.role === r.id;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => void onPatch({ role: r.id })}
                title={r.hint}
                className={`h-6 px-2 rounded-md text-[10px] font-medium border transition-colors ${
                  active
                    ? "border-studio-accent/40 bg-studio-accent/10 text-studio-accent"
                    : "border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
                }`}
              >
                {r.label}
              </button>
            );
          })}
          {img.role && (
            <button
              type="button"
              onClick={() => void onPatch({ role: null as ImageRole | null })}
              className="h-6 px-2 rounded-md text-[10px] text-neutral-500 hover:text-red-400"
              title="Clear role"
            >
              clear
            </button>
          )}
        </div>
      </div>

      {/* Description */}
      <div className="flex flex-col gap-1">
        <div className="text-[9px] uppercase tracking-wider text-neutral-500">Description</div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => {
            if (description !== img.description) void onPatch({ description });
          }}
          placeholder="Lone cowboy under flying birds, dusk sky, editorial mood…"
          rows={3}
          className="w-full bg-neutral-900 border border-neutral-800 rounded-md p-1.5 text-[11px] text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-neutral-700 resize-none"
        />
      </div>

      {/* Tags */}
      <div className="flex flex-col gap-1">
        <div className="text-[9px] uppercase tracking-wider text-neutral-500">
          Tags (comma-separated)
        </div>
        <input
          type="text"
          value={tagsRaw}
          onChange={(e) => setTagsRaw(e.target.value)}
          onBlur={() => {
            const tags = tagsRaw
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean);
            if (JSON.stringify(tags) !== JSON.stringify(img.tags)) void onPatch({ tags });
          }}
          placeholder="people, editorial, kitchen"
          className="h-7 bg-neutral-900 border border-neutral-800 rounded-md px-2 text-[11px] text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-neutral-700"
        />
      </div>

      {/* Analyzer panel (Gemini Flash priors). Appears once any analyzer
          field is present OR when analysis is pending/failed; the rerun
          button lets the user refresh after editing description/role. */}
      <AnalyzerPanel img={img} onReanalyze={onReanalyze} />

      {/* Palette + remove */}
      <div className="flex items-center gap-2">
        <div className="flex gap-1">
          {img.palette.map((hex, i) => (
            <span
              key={`${hex}-${i}`}
              className="inline-block h-3 w-3 rounded-sm border border-neutral-800"
              style={{ backgroundColor: hex }}
              title={hex}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => void onRemove()}
          className="ml-auto h-6 px-2 rounded-md text-[10px] text-neutral-500 hover:text-red-400 hover:bg-red-950/30 border border-transparent hover:border-red-900/40"
        >
          Remove
        </button>
      </div>
    </div>
  );
}

interface AnalyzerPanelProps {
  img: ImageEntry;
  onReanalyze: () => Promise<void>;
}

function AnalyzerPanel({ img, onReanalyze }: AnalyzerPanelProps) {
  const status = img.analysisStatus;
  const score = img.retentionStrengthAtAttachment;
  return (
    <div className="flex flex-col gap-1 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] uppercase tracking-wider text-neutral-500">
          Gemini analysis
        </span>
        {status === "pending" && (
          <span className="text-[9px] uppercase tracking-wider text-neutral-400">analyzing…</span>
        )}
        {status === "complete" && (
          <span className="text-[9px] uppercase tracking-wider text-emerald-500">complete</span>
        )}
        {status === "failed" && (
          <span className="text-[9px] uppercase tracking-wider text-rose-400">failed</span>
        )}
        <button
          type="button"
          onClick={() => void onReanalyze()}
          disabled={status === "pending"}
          className="ml-auto h-5 px-1.5 rounded-md text-[10px] text-neutral-400 hover:text-neutral-100 disabled:opacity-50 disabled:cursor-not-allowed border border-transparent hover:border-neutral-700"
          title={
            status === "complete"
              ? "Re-run Gemini analysis (e.g. after editing description)"
              : status === "failed"
                ? "Retry Gemini analysis"
                : "Run Gemini analysis"
          }
        >
          {status === "pending" ? "…" : status ? "↻" : "▷"}
        </button>
      </div>
      {status === "failed" && img.analysisError && (
        <div className="text-[10px] text-rose-300/80 leading-snug break-words">
          {img.analysisError}
        </div>
      )}
      {status === "complete" && (
        <div className="flex flex-col gap-0.5 text-[10px] text-neutral-300">
          {img.vibe && (
            <div>
              <span className="text-neutral-500">vibe:</span> {img.vibe}
            </div>
          )}
          {img.suggestedTreatment && (
            <div>
              <span className="text-neutral-500">treatment prior:</span>{" "}
              <code className="text-neutral-200">{img.suggestedTreatment}</code>
            </div>
          )}
          {typeof score === "number" && (
            <div>
              <span className="text-neutral-500">retention strength:</span>{" "}
              <span
                className={
                  score >= 7 ? "text-emerald-400" : score >= 4 ? "text-amber-400" : "text-rose-400"
                }
              >
                {score}/10
              </span>
            </div>
          )}
          {img.analysisRationale && (
            <div className="text-neutral-400 leading-snug">{img.analysisRationale}</div>
          )}
        </div>
      )}
      {!status && (
        <div className="text-[10px] text-neutral-500 leading-snug">
          No analysis yet. Click ▷ to run.
        </div>
      )}
    </div>
  );
}
