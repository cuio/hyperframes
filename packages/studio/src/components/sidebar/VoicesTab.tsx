import { memo, useCallback, useEffect, useRef, useState } from "react";

interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
  description?: string;
  preview_url?: string;
}

interface VoicesTabProps {
  projectId: string;
}

interface LoadState {
  status: "idle" | "loading" | "ready" | "error";
  error?: string;
  needsKey?: boolean;
  voices: ElevenLabsVoice[];
}

type KeySource = "process" | "project-env" | "global-env" | "none";

interface KeyStatus {
  hasKey: boolean;
  source: KeySource;
}

const POPULAR_LABELS = ["accent", "gender", "age", "use_case", "use case", "description"];

function joinLabels(labels?: Record<string, string>): string {
  if (!labels) return "";
  const ordered = POPULAR_LABELS.flatMap((key) => (labels[key] ? [`${labels[key]}`] : []));
  if (ordered.length > 0) return ordered.join(" · ");
  return Object.values(labels).slice(0, 3).join(" · ");
}

export const VoicesTab = memo(function VoicesTab({ projectId }: VoicesTabProps) {
  const [load, setLoad] = useState<LoadState>({ status: "idle", voices: [] });
  const [defaultVoiceId, setDefaultVoiceId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const refreshKeyStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/elevenlabs/key`);
      if (!res.ok) return;
      const data = (await res.json()) as KeyStatus;
      setKeyStatus(data);
    } catch {
      /* ignore */
    }
  }, [projectId]);

  const fetchVoices = useCallback(async () => {
    setLoad((prev) => ({ ...prev, status: "loading", error: undefined, needsKey: false }));
    try {
      const res = await fetch(`/api/elevenlabs/voices?project=${encodeURIComponent(projectId)}`);
      if (res.status === 401) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setLoad({
          status: "error",
          voices: [],
          needsKey: true,
          error: data.error ?? "API key not set",
        });
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setLoad({
          status: "error",
          voices: [],
          error: data.error ?? `HTTP ${res.status}`,
        });
        return;
      }
      const data = (await res.json()) as { voices?: ElevenLabsVoice[] };
      setLoad({ status: "ready", voices: data.voices ?? [] });
    } catch (err) {
      setLoad({
        status: "error",
        voices: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, [projectId]);

  const handleSaveKey = useCallback(async () => {
    const value = keyDraft.trim();
    if (!value) return;
    setKeyBusy(true);
    setKeyError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/elevenlabs/key`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setKeyError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as KeyStatus;
      setKeyStatus(data);
      setKeyDraft("");
      void fetchVoices();
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : String(err));
    } finally {
      setKeyBusy(false);
    }
  }, [projectId, keyDraft, fetchVoices]);

  const handleClearKey = useCallback(async () => {
    setKeyBusy(true);
    setKeyError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/elevenlabs/key`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: null }),
      });
      if (res.ok) {
        const data = (await res.json()) as KeyStatus;
        setKeyStatus(data);
        void fetchVoices();
      }
    } finally {
      setKeyBusy(false);
    }
  }, [projectId, fetchVoices]);

  // Initial load + when project changes.
  // Direct subscription to a route param is fine here; no derived state.
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    void fetchVoices();
    void refreshKeyStatus();
    fetch(`/api/projects/${encodeURIComponent(projectId)}/elevenlabs/settings`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { defaultVoiceId?: string | null } | null) => {
        if (data && typeof data.defaultVoiceId === "string") {
          setDefaultVoiceId(data.defaultVoiceId);
        }
      })
      .catch(() => {});
  }, [projectId, fetchVoices, refreshKeyStatus]);

  // Stop audio on unmount or project switch.
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, [projectId]);

  const handlePreview = useCallback(
    (voiceId: string) => {
      // Toggle: clicking the same playing voice stops it.
      if (playingId === voiceId && audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
        setPlayingId(null);
        return;
      }
      // Stop any current playback.
      audioRef.current?.pause();
      const url = `/api/elevenlabs/voices/${encodeURIComponent(voiceId)}/preview?project=${encodeURIComponent(projectId)}`;
      const audio = new Audio(url);
      audio.onended = () => {
        setPlayingId((current) => (current === voiceId ? null : current));
      };
      audio.onerror = () => {
        setPlayingId((current) => (current === voiceId ? null : current));
      };
      audioRef.current = audio;
      setPlayingId(voiceId);
      void audio.play().catch(() => setPlayingId(null));
    },
    [playingId, projectId],
  );

  const handleUseVoice = useCallback(
    async (voiceId: string) => {
      setSavingId(voiceId);
      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/elevenlabs/settings`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ defaultVoiceId: voiceId }),
          },
        );
        if (res.ok) {
          const data = (await res.json()) as { defaultVoiceId?: string | null };
          setDefaultVoiceId(data.defaultVoiceId ?? voiceId);
        }
      } finally {
        setSavingId(null);
      }
    },
    [projectId],
  );

  const filtered = load.voices.filter((v) => {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    if (v.name?.toLowerCase().includes(q)) return true;
    if (v.voice_id.toLowerCase().includes(q)) return true;
    if (v.category?.toLowerCase().includes(q)) return true;
    if (v.labels) {
      for (const value of Object.values(v.labels)) {
        if (value?.toLowerCase().includes(q)) return true;
      }
    }
    return false;
  });

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="px-3 py-2 border-b border-neutral-800/50 flex items-center gap-2">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search voices…"
          className="flex-1 h-7 bg-neutral-900 border border-neutral-800 rounded-md px-2 text-[11px] text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-neutral-700"
        />
        <button
          type="button"
          onClick={() => void fetchVoices()}
          disabled={load.status === "loading"}
          className="h-7 px-2 rounded-md text-[11px] font-medium border border-neutral-800 text-neutral-400 hover:text-neutral-200 hover:border-neutral-700 disabled:opacity-40"
          title="Refresh"
        >
          ↻
        </button>
      </div>

      {keyStatus?.hasKey && (
        <div className="px-3 py-1.5 border-b border-neutral-800/50 flex items-center justify-between text-[10px] text-neutral-500 bg-neutral-900/40">
          <span>
            Key:{" "}
            <span className="text-studio-accent">
              {keyStatus.source === "process"
                ? "shell env"
                : keyStatus.source === "project-env"
                  ? "project .env"
                  : "global .env"}
            </span>
          </span>
          {keyStatus.source === "project-env" && (
            <button
              type="button"
              onClick={() => void handleClearKey()}
              disabled={keyBusy}
              className="text-neutral-500 hover:text-red-400 disabled:opacity-40"
              title="Remove key from project .env"
            >
              clear
            </button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {load.status === "loading" && (
          <div className="p-4 text-[11px] text-neutral-500">Loading voices…</div>
        )}

        {load.status === "error" && load.needsKey && (
          <div className="p-4 text-[11px] text-neutral-400 leading-relaxed">
            <div className="font-medium text-neutral-200 mb-1.5">ElevenLabs API key not set</div>
            <div className="mb-2 text-neutral-500">
              Paste your key below — it'll be written to{" "}
              <code className="font-mono text-neutral-400">&lt;project&gt;/.env</code> and added to{" "}
              <code className="font-mono text-neutral-400">.gitignore</code>.
            </div>
            <div className="flex flex-col gap-1.5">
              <input
                type="password"
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && keyDraft.trim() && !keyBusy) {
                    void handleSaveKey();
                  }
                }}
                placeholder="sk_..."
                autoComplete="off"
                spellCheck={false}
                className="h-7 bg-neutral-900 border border-neutral-800 rounded-md px-2 text-[11px] text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-neutral-700 font-mono"
              />
              <button
                type="button"
                onClick={() => void handleSaveKey()}
                disabled={!keyDraft.trim() || keyBusy}
                className="h-7 rounded-md text-[11px] font-medium border border-studio-accent/40 bg-studio-accent/10 text-studio-accent hover:bg-studio-accent/15 disabled:opacity-40 disabled:hover:bg-studio-accent/10"
              >
                {keyBusy ? "Saving…" : "Save key"}
              </button>
              {keyError && <div className="text-[10px] text-red-400">{keyError}</div>}
              <div className="text-[10px] text-neutral-600 mt-1">
                Or set it manually in <code className="font-mono">&lt;project&gt;/.env</code>,{" "}
                <code className="font-mono">~/.hyperframes/.env</code>, or your shell env.
              </div>
            </div>
          </div>
        )}

        {load.status === "error" && !load.needsKey && (
          <div className="p-4 text-[11px] text-red-400">
            {load.error ?? "Failed to load voices"}
          </div>
        )}

        {load.status === "ready" && filtered.length === 0 && (
          <div className="p-4 text-[11px] text-neutral-500">
            {filter ? "No voices match your filter." : "No voices available on this account."}
          </div>
        )}

        {load.status === "ready" && filtered.length > 0 && (
          <div className="p-2 flex flex-col gap-1.5">
            {filtered.map((voice) => {
              const isDefault = defaultVoiceId === voice.voice_id;
              const isPlaying = playingId === voice.voice_id;
              const isSaving = savingId === voice.voice_id;
              return (
                <div
                  key={voice.voice_id}
                  className={`group rounded-md border bg-neutral-900/60 px-2.5 py-2 transition-colors ${
                    isDefault
                      ? "border-studio-accent/40 bg-studio-accent/[0.04]"
                      : "border-neutral-800 hover:border-neutral-700"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[12px] font-medium text-neutral-100 truncate">
                          {voice.name || voice.voice_id}
                        </span>
                        {isDefault && (
                          <span className="text-[9px] uppercase tracking-wider text-studio-accent">
                            default
                          </span>
                        )}
                      </div>
                      {(voice.category || voice.labels) && (
                        <div className="text-[10px] text-neutral-500 mt-0.5 truncate">
                          {[voice.category, joinLabels(voice.labels)].filter(Boolean).join(" · ")}
                        </div>
                      )}
                      <div className="text-[9px] text-neutral-600 mt-0.5 font-mono truncate">
                        {voice.voice_id}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => handlePreview(voice.voice_id)}
                        className={`h-6 w-6 rounded-md border flex items-center justify-center transition-colors ${
                          isPlaying
                            ? "border-studio-accent/40 bg-studio-accent/10 text-studio-accent"
                            : "border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
                        }`}
                        title={isPlaying ? "Stop preview" : "Play preview"}
                        aria-label={isPlaying ? "Stop preview" : "Play preview"}
                      >
                        {isPlaying ? (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                            <rect x="6" y="5" width="4" height="14" />
                            <rect x="14" y="5" width="4" height="14" />
                          </svg>
                        ) : (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                            <polygon points="6 4 20 12 6 20" />
                          </svg>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleUseVoice(voice.voice_id)}
                        disabled={isSaving || isDefault}
                        className={`h-6 px-2 rounded-md text-[10px] font-medium border transition-colors ${
                          isDefault
                            ? "border-studio-accent/30 text-studio-accent cursor-default"
                            : "border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200 disabled:opacity-40"
                        }`}
                        title={isDefault ? "Already the default voice" : "Set as default"}
                      >
                        {isSaving ? "…" : isDefault ? "✓" : "Use"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});
