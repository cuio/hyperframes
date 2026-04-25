import { memo, useCallback, useEffect, useState } from "react";
import { VariantsModal } from "./VariantsModal";

interface ScriptTabProps {
  projectId: string;
}

const CAPTIONS_STORAGE_KEY = "hf-captions-visible";
const CAPTIONS_CHANNEL = "hf-captions";

function readStoredCaptionsVisible(): boolean {
  try {
    const stored = localStorage.getItem(CAPTIONS_STORAGE_KEY);
    return stored !== "0";
  } catch {
    return true;
  }
}

function writeStoredCaptionsVisible(visible: boolean): void {
  try {
    localStorage.setItem(CAPTIONS_STORAGE_KEY, visible ? "1" : "0");
  } catch {
    /* private mode / disabled storage */
  }
}

interface SceneRef {
  id: string;
  text: string;
  template: string;
  props: Record<string, unknown>;
  hook?: boolean;
  voiceId?: string;
  durationHint?: number;
  reasoning?: string;
}

interface Script {
  meta: {
    title?: string;
    voiceId?: string;
    audience?: string;
    tone?: string;
    overallReasoning?: string;
    warnings?: string[];
  };
  scenes: SceneRef[];
}

type KeySource = "process" | "project-env" | "global-env" | "none";
interface KeyStatus {
  hasKey: boolean;
  source: KeySource;
}

interface BusyState {
  kind: "idle" | "loading" | "planning" | "generating";
  message?: string;
}

export const ScriptTab = memo(function ScriptTab({ projectId }: ScriptTabProps) {
  const [text, setText] = useState("");
  const [audience, setAudience] = useState("");
  const [tone, setTone] = useState("");
  // Total duration is derived from the script's natural read time — no
  // user-set target. Removed in PR #10 because target-driven planning
  // forced the AI to truncate or pad scenes to hit a number, which read
  // as either rushed or stretched. The script's length IS the duration.
  const [script, setScript] = useState<Script | null>(null);
  const [busy, setBusy] = useState<BusyState>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [anthropicKey, setAnthropicKey] = useState<KeyStatus | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [defaultVoiceId, setDefaultVoiceId] = useState<string | null>(null);
  const [expandedScene, setExpandedScene] = useState<string | null>(null);
  const [variantSceneId, setVariantSceneId] = useState<string | null>(null);
  const [fidelity, setFidelity] = useState<"verbatim" | "split-merge" | "refine">("split-merge");
  const [filesStatus, setFilesStatus] = useState<{
    hasDesign: boolean;
    hasDesignArt: boolean;
    hasResearch: boolean;
  } | null>(null);
  const [scaffolding, setScaffolding] = useState(false);
  const [captionsVisible, setCaptionsVisible] = useState<boolean>(readStoredCaptionsVisible);

  const loadAnthropicKeyStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/anthropic/key`);
      if (res.ok) setAnthropicKey((await res.json()) as KeyStatus);
    } catch {
      /* ignore */
    }
  }, [projectId]);

  const loadExistingScript = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/script`);
      if (!res.ok) return;
      const data = (await res.json()) as { script: Script | null };
      if (data.script) setScript(data.script);
    } catch {
      /* ignore */
    }
  }, [projectId]);

  const loadFilesStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/script/files-status`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        hasDesign: boolean;
        hasDesignArt: boolean;
        hasResearch: boolean;
      };
      setFilesStatus(data);
    } catch {
      /* ignore */
    }
  }, [projectId]);

  const scaffoldFiles = useCallback(
    async (which: { research?: boolean; designArt?: boolean }) => {
      setScaffolding(true);
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/script/scaffold`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(which),
        });
        if (res.ok) await loadFilesStatus();
      } finally {
        setScaffolding(false);
      }
    },
    [projectId, loadFilesStatus],
  );

  const downloadCaptions = useCallback(
    (format: "srt" | "vtt") => {
      const url = `/api/projects/${encodeURIComponent(projectId)}/script/captions.${format}`;
      const a = document.createElement("a");
      a.href = url;
      a.download = `captions.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    },
    [projectId],
  );

  const broadcastCaptions = useCallback((visible: boolean) => {
    writeStoredCaptionsVisible(visible);
    // BroadcastChannel reaches same-origin windows (other studio tabs and any
    // already-mounted preview iframes that subscribe). New iframes that mount
    // after the toggle hydrate from localStorage on load — that's why we
    // write storage above, not just inside the player's message handler.
    try {
      const ch = new BroadcastChannel(CAPTIONS_CHANNEL);
      ch.postMessage({ type: "captions", visible });
      ch.close();
    } catch {
      /* unsupported */
    }
    // Back-compat: also postMessage into existing iframes for projects whose
    // assembled HTML predates the BroadcastChannel listener.
    const iframes = document.querySelectorAll("iframe");
    for (const f of iframes) {
      try {
        f.contentWindow?.postMessage({ source: "hf-host", type: "captions", visible }, "*");
      } catch {
        /* ignore cross-origin */
      }
    }
  }, []);

  const toggleCaptions = useCallback(() => {
    setCaptionsVisible((prev) => {
      const next = !prev;
      broadcastCaptions(next);
      return next;
    });
  }, [broadcastCaptions]);

  // Subscribe to broadcasts from other studio tabs so the toggle stays in sync.
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    let ch: BroadcastChannel | null = null;
    try {
      ch = new BroadcastChannel(CAPTIONS_CHANNEL);
      ch.onmessage = (ev) => {
        const data = ev.data as { type?: string; visible?: boolean } | null;
        if (data?.type === "captions" && typeof data.visible === "boolean") {
          setCaptionsVisible(data.visible);
        }
      };
    } catch {
      /* unsupported */
    }
    return () => {
      ch?.close();
    };
  }, []);

  const loadDefaultVoice = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/elevenlabs/settings`);
      if (!res.ok) return;
      const data = (await res.json()) as { defaultVoiceId?: string | null };
      setDefaultVoiceId(typeof data.defaultVoiceId === "string" ? data.defaultVoiceId : null);
    } catch {
      /* ignore */
    }
  }, [projectId]);

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    void loadAnthropicKeyStatus();
    void loadExistingScript();
    void loadDefaultVoice();
    void loadFilesStatus();
  }, [loadAnthropicKeyStatus, loadExistingScript, loadDefaultVoice, loadFilesStatus]);

  const saveAnthropicKey = useCallback(async () => {
    const value = keyDraft.trim();
    if (!value) return;
    setKeyBusy(true);
    setKeyError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/anthropic/key`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setKeyError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setAnthropicKey((await res.json()) as KeyStatus);
      setKeyDraft("");
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : String(err));
    } finally {
      setKeyBusy(false);
    }
  }, [projectId, keyDraft]);

  const handlePlan = useCallback(async () => {
    if (!text.trim()) return;
    setBusy({ kind: "planning", message: "Planning with Claude..." });
    setError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/script/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          // No targetDurationSeconds — duration follows the script's natural length
          fidelity,
          meta: {
            audience: audience.trim() || undefined,
            tone: tone.trim() || undefined,
          },
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { script: Script };
      setScript(data.script);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy({ kind: "idle" });
    }
  }, [projectId, text, audience, tone, fidelity]);

  const handleGenerate = useCallback(async () => {
    if (!script) return;
    setBusy({ kind: "generating", message: "Synthesizing audio + assembling..." });
    setError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/script/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy({ kind: "idle" });
    }
  }, [projectId, script]);

  const planning = busy.kind === "planning";
  const generating = busy.kind === "generating";
  const needsAnthropicKey = anthropicKey != null && !anthropicKey.hasKey;

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      {needsAnthropicKey && (
        <div className="p-3 border-b border-neutral-800/50">
          <div className="text-[11px] font-medium text-neutral-200 mb-1">
            Claude API key not set
          </div>
          <div className="text-[10px] text-neutral-500 mb-2">
            Required for AI scene planning. Saved to{" "}
            <code className="font-mono text-neutral-400">&lt;project&gt;/.env</code>.
          </div>
          <div className="flex flex-col gap-1.5">
            <input
              type="password"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && keyDraft.trim() && !keyBusy) void saveAnthropicKey();
              }}
              placeholder="sk-ant-..."
              autoComplete="off"
              spellCheck={false}
              className="h-7 bg-neutral-900 border border-neutral-800 rounded-md px-2 text-[11px] text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-neutral-700 font-mono"
            />
            <button
              type="button"
              onClick={() => void saveAnthropicKey()}
              disabled={!keyDraft.trim() || keyBusy}
              className="h-7 rounded-md text-[11px] font-medium border border-studio-accent/40 bg-studio-accent/10 text-studio-accent hover:bg-studio-accent/15 disabled:opacity-40"
            >
              {keyBusy ? "Saving…" : "Save key"}
            </button>
            {keyError && <div className="text-[10px] text-red-400">{keyError}</div>}
          </div>
        </div>
      )}

      <div className="p-3 border-b border-neutral-800/50 flex flex-col gap-2">
        <div className="text-[10px] uppercase tracking-wider text-neutral-500">Script</div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste your script (markdown or plain text)…"
          rows={8}
          className="w-full bg-neutral-900 border border-neutral-800 rounded-md p-2 text-[11px] text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-neutral-700 font-mono resize-none"
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            type="text"
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            placeholder="Audience (optional)"
            className="h-7 bg-neutral-900 border border-neutral-800 rounded-md px-2 text-[11px] text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-neutral-700"
          />
          <input
            type="text"
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            placeholder="Tone (optional)"
            className="h-7 bg-neutral-900 border border-neutral-800 rounded-md px-2 text-[11px] text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-neutral-700"
          />
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <label className="text-[10px] text-neutral-500">Fidelity</label>
          <select
            value={fidelity}
            onChange={(e) => setFidelity(e.target.value as "verbatim" | "split-merge" | "refine")}
            className="h-7 bg-neutral-900 border border-neutral-800 rounded-md px-2 text-[11px] text-neutral-200 focus:outline-none focus:border-neutral-700 cursor-pointer"
            title={
              fidelity === "verbatim"
                ? "AI uses your script word-for-word, no edits, only segments it"
                : fidelity === "refine"
                  ? "AI may remove filler and tighten phrasing — numbers/claims preserved"
                  : "AI may split or merge sentences — words and order preserved (default)"
            }
          >
            <option value="verbatim">verbatim</option>
            <option value="split-merge">split-merge</option>
            <option value="refine">refine</option>
          </select>
          <button
            type="button"
            onClick={() => void handlePlan()}
            disabled={!text.trim() || planning || generating || needsAnthropicKey}
            className="ml-auto h-7 px-3 rounded-md text-[11px] font-medium border border-studio-accent/40 bg-studio-accent/10 text-studio-accent hover:bg-studio-accent/15 disabled:opacity-40"
          >
            {planning ? "Planning…" : script ? "Re-plan with AI" : "Plan with AI"}
          </button>
        </div>
        <div className="text-[10px] text-neutral-600 leading-relaxed">
          {fidelity === "verbatim" && (
            <>
              <span className="text-studio-accent">verbatim</span> — exact words, no edits, no swaps
            </>
          )}
          {fidelity === "split-merge" && (
            <>
              <span className="text-studio-accent">split-merge</span> — sentences may be split or
              merged, words preserved
            </>
          )}
          {fidelity === "refine" && (
            <>
              <span className="text-studio-accent">refine</span> — light editorial (filler removal,
              tighter phrasing) — numbers preserved
            </>
          )}
        </div>
        {error && <div className="text-[10px] text-red-400">{error}</div>}
      </div>

      {script && (
        <div className="p-3 border-b border-neutral-800/50">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] uppercase tracking-wider text-neutral-500">
              {script.scenes.length} scenes
              {script.meta.title ? ` · ${script.meta.title}` : ""}
            </div>
            <button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={generating || planning || (!script.meta.voiceId && !defaultVoiceId)}
              className="h-7 px-3 rounded-md text-[11px] font-medium border border-studio-accent/40 bg-studio-accent/10 text-studio-accent hover:bg-studio-accent/15 disabled:opacity-40"
              title={
                !script.meta.voiceId && !defaultVoiceId
                  ? "Pick a default voice in the Voices tab first"
                  : "Generate audio + index.html"
              }
            >
              {generating ? "Generating…" : "Generate"}
            </button>
          </div>
          <div className="text-[10px] text-neutral-500 mb-2 font-mono">
            voice:{" "}
            {script.meta.voiceId ? (
              <span className="text-neutral-300">{script.meta.voiceId}</span>
            ) : defaultVoiceId ? (
              <span className="text-neutral-300">
                {defaultVoiceId} <span className="text-neutral-600">(project default)</span>
              </span>
            ) : (
              <span className="text-amber-400">none — pick one in Voices tab</span>
            )}
          </div>
          {script.meta.overallReasoning && (
            <div className="mb-2 text-[10px] text-neutral-400 italic leading-relaxed border-l-2 border-studio-accent/40 pl-2">
              {script.meta.overallReasoning}
            </div>
          )}
          {(() => {
            const rawWarnings = script.meta.warnings ?? [];
            // Suppress "No FOO.md found" presence checks once the file exists.
            // Other warnings (e.g. orphan numeric claims) require a re-plan to
            // re-validate, so they stay visible until the next plan.
            const visibleWarnings = rawWarnings.filter((w) => {
              if (!filesStatus) return true;
              if (filesStatus.hasResearch && w.includes("No RESEARCH.md found")) return false;
              if (filesStatus.hasDesignArt && w.includes("No DESIGN-ART.md found")) return false;
              if (filesStatus.hasDesign && w.includes("No DESIGN.md found")) return false;
              return true;
            });
            if (visibleWarnings.length === 0) return null;
            const showScaffold =
              filesStatus && (!filesStatus.hasResearch || !filesStatus.hasDesignArt);
            return (
              <div className="mb-2 rounded-md border border-amber-900/40 bg-amber-950/30 px-2 py-1.5">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[9px] uppercase tracking-wider text-amber-400">
                    Planner warnings
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadFilesStatus()}
                    className="text-[9px] uppercase tracking-wider text-amber-400/70 hover:text-amber-300"
                    title="Re-check which design files exist on disk"
                  >
                    ⟳ Re-validate
                  </button>
                </div>
                <ul className="text-[10px] text-amber-200/80 space-y-0.5">
                  {visibleWarnings.map((w, i) => (
                    <li key={i}>· {w}</li>
                  ))}
                </ul>
                {showScaffold && (
                  <div className="mt-2 pt-2 border-t border-amber-900/40 flex flex-wrap gap-1.5">
                    {!filesStatus.hasResearch && (
                      <button
                        type="button"
                        onClick={() => void scaffoldFiles({ research: true })}
                        disabled={scaffolding}
                        className="h-6 px-2 rounded-md text-[10px] font-medium border border-amber-700/40 bg-amber-900/20 text-amber-200 hover:bg-amber-900/30 disabled:opacity-40"
                        title="Create RESEARCH.md from a starter template"
                      >
                        + Create RESEARCH.md
                      </button>
                    )}
                    {!filesStatus.hasDesignArt && (
                      <button
                        type="button"
                        onClick={() => void scaffoldFiles({ designArt: true })}
                        disabled={scaffolding}
                        className="h-6 px-2 rounded-md text-[10px] font-medium border border-amber-700/40 bg-amber-900/20 text-amber-200 hover:bg-amber-900/30 disabled:opacity-40"
                        title="Create DESIGN-ART.md from a starter template"
                      >
                        + Create DESIGN-ART.md
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
          <div className="mb-2 flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={toggleCaptions}
              className={`h-6 px-2 rounded-md text-[10px] font-medium border transition-colors ${
                captionsVisible
                  ? "border-studio-accent/40 bg-studio-accent/10 text-studio-accent"
                  : "border-neutral-800 text-neutral-500 hover:text-neutral-300 hover:border-neutral-700"
              }`}
              title={captionsVisible ? "Hide captions in preview" : "Show captions in preview"}
            >
              CC {captionsVisible ? "on" : "off"}
            </button>
            <button
              type="button"
              onClick={() => downloadCaptions("srt")}
              className="h-6 px-2 rounded-md text-[10px] font-medium border border-neutral-800 text-neutral-400 hover:text-neutral-200 hover:border-neutral-700"
              title="Download SubRip captions"
            >
              ↓ .srt
            </button>
            <button
              type="button"
              onClick={() => downloadCaptions("vtt")}
              className="h-6 px-2 rounded-md text-[10px] font-medium border border-neutral-800 text-neutral-400 hover:text-neutral-200 hover:border-neutral-700"
              title="Download WebVTT captions"
            >
              ↓ .vtt
            </button>
          </div>
          <div className="flex flex-col gap-1.5">
            {script.scenes.map((scene) => (
              <SceneCard
                key={scene.id}
                scene={scene}
                expanded={expandedScene === scene.id}
                onToggle={() => setExpandedScene((prev) => (prev === scene.id ? null : scene.id))}
                onVariants={() => setVariantSceneId(scene.id)}
              />
            ))}
          </div>
        </div>
      )}
      {variantSceneId &&
        script &&
        (() => {
          const target = script.scenes.find((s) => s.id === variantSceneId);
          if (!target) return null;
          return (
            <VariantsModal
              projectId={projectId}
              sceneId={target.id}
              sceneText={target.text}
              currentTemplate={target.template}
              onClose={() => setVariantSceneId(null)}
              onPick={(variant) => {
                setScript((prev) => {
                  if (!prev) return prev;
                  return {
                    ...prev,
                    scenes: prev.scenes.map((s) =>
                      s.id === variant.id
                        ? {
                            ...s,
                            template: variant.template,
                            props: variant.props,
                            reasoning: variant.reasoning,
                          }
                        : s,
                    ),
                  };
                });
              }}
            />
          );
        })()}
    </div>
  );
});

interface SceneCardProps {
  scene: SceneRef;
  expanded: boolean;
  onToggle: () => void;
  onVariants: () => void;
}

function SceneCard({ scene, expanded, onToggle, onVariants }: SceneCardProps) {
  const chartType =
    scene.template === "chart-scene" && scene.props
      ? (() => {
          const chart = (scene.props as Record<string, unknown>).chart;
          if (chart && typeof chart === "object" && "type" in chart) {
            const t = (chart as Record<string, unknown>).type;
            return typeof t === "string" ? t : null;
          }
          return null;
        })()
      : null;
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/60 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-2 py-1.5 hover:bg-neutral-800/40 transition-colors"
      >
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-mono text-neutral-500">{scene.id}</span>
          <span className="text-[10px] text-studio-accent">{scene.template}</span>
          {chartType && (
            <span className="text-[9px] font-mono text-neutral-400">→ {chartType}</span>
          )}
          {scene.hook && (
            <span className="text-[9px] uppercase tracking-wider text-amber-400">hook</span>
          )}
          <span className="ml-auto text-[10px] text-neutral-600">{expanded ? "−" : "+"}</span>
        </div>
        {scene.text && (
          <div className={`text-[11px] text-neutral-300 mt-1 ${expanded ? "" : "line-clamp-2"}`}>
            {scene.text}
          </div>
        )}
      </button>
      {expanded && (
        <div className="border-t border-neutral-800 px-2 py-2 bg-neutral-950/40">
          {scene.reasoning ? (
            <>
              <div className="text-[9px] uppercase tracking-wider text-neutral-500 mb-1">
                Why this visual
              </div>
              <div className="text-[10px] text-neutral-400 leading-relaxed italic">
                {scene.reasoning}
              </div>
            </>
          ) : (
            <div className="text-[10px] text-neutral-600 italic">
              (No reasoning provided — re-plan or fetch variants.)
            </div>
          )}
          <div className="mt-2 flex items-center gap-1.5">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onVariants();
              }}
              className="h-6 px-2 rounded-md text-[10px] font-medium border border-studio-accent/40 bg-studio-accent/10 text-studio-accent hover:bg-studio-accent/20 transition-colors"
              title="Generate 3 alternative visual treatments and pick one"
            >
              ⟳ Variants
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
