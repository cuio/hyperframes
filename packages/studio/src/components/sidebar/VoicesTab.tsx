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

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
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

  // One audio element at a time. We track the voice id it represents so a stale
  // onended/onerror firing after a project switch can't clobber the new state.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioVoiceIdRef = useRef<string | null>(null);

  // AbortControllers per concurrent call site. Aborted on unmount or project switch.
  const voicesAcRef = useRef<AbortController | null>(null);
  const keyStatusAcRef = useRef<AbortController | null>(null);
  const settingsAcRef = useRef<AbortController | null>(null);
  const keyOpAcRef = useRef<AbortController | null>(null);
  const useVoiceAcRef = useRef<AbortController | null>(null);

  const stopAudio = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      a.pause();
      // Clearing src releases the network connection and underlying buffer.
      try {
        a.removeAttribute("src");
        a.load();
      } catch {
        /* ignore */
      }
    }
    audioRef.current = null;
    audioVoiceIdRef.current = null;
  }, []);

  const refreshKeyStatus = useCallback(async () => {
    keyStatusAcRef.current?.abort();
    const ac = new AbortController();
    keyStatusAcRef.current = ac;
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/elevenlabs/key`, {
        signal: ac.signal,
      });
      if (ac.signal.aborted) return;
      if (!res.ok) return;
      const data = (await res.json()) as KeyStatus;
      if (ac.signal.aborted) return;
      setKeyStatus(data);
    } catch (err) {
      if (isAbort(err) || ac.signal.aborted) return;
      console.warn("[VoicesTab] refreshKeyStatus failed", err);
    }
  }, [projectId]);

  const fetchVoices = useCallback(async () => {
    voicesAcRef.current?.abort();
    const ac = new AbortController();
    voicesAcRef.current = ac;
    setLoad((prev) => ({ ...prev, status: "loading", error: undefined, needsKey: false }));
    try {
      const res = await fetch(`/api/elevenlabs/voices?project=${encodeURIComponent(projectId)}`, {
        signal: ac.signal,
      });
      if (ac.signal.aborted) return;
      if (res.status === 401) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (ac.signal.aborted) return;
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
        if (ac.signal.aborted) return;
        setLoad({
          status: "error",
          voices: [],
          error: data.error ?? `HTTP ${res.status}`,
        });
        return;
      }
      const data = (await res.json()) as { voices?: ElevenLabsVoice[] };
      if (ac.signal.aborted) return;
      setLoad({ status: "ready", voices: data.voices ?? [] });
    } catch (err) {
      if (isAbort(err) || ac.signal.aborted) return;
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
    keyOpAcRef.current?.abort();
    const ac = new AbortController();
    keyOpAcRef.current = ac;
    setKeyBusy(true);
    setKeyError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/elevenlabs/key`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
        signal: ac.signal,
      });
      if (ac.signal.aborted) return;
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (ac.signal.aborted) return;
        setKeyError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as KeyStatus;
      if (ac.signal.aborted) return;
      setKeyStatus(data);
      setKeyDraft("");
      void fetchVoices();
    } catch (err) {
      if (isAbort(err) || ac.signal.aborted) return;
      setKeyError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!ac.signal.aborted) setKeyBusy(false);
    }
  }, [projectId, keyDraft, fetchVoices]);

  const handleClearKey = useCallback(async () => {
    keyOpAcRef.current?.abort();
    const ac = new AbortController();
    keyOpAcRef.current = ac;
    setKeyBusy(true);
    setKeyError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/elevenlabs/key`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: null }),
        signal: ac.signal,
      });
      if (ac.signal.aborted) return;
      if (res.ok) {
        const data = (await res.json()) as KeyStatus;
        if (ac.signal.aborted) return;
        setKeyStatus(data);
        void fetchVoices();
      }
    } catch (err) {
      if (isAbort(err) || ac.signal.aborted) return;
      console.warn("[VoicesTab] clearKey failed", err);
    } finally {
      if (!ac.signal.aborted) setKeyBusy(false);
    }
  }, [projectId, fetchVoices]);

  // Initial load + when project changes. All in-flight requests for the previous
  // project are aborted on cleanup so their late responses can't write into the
  // new project's state.
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    settingsAcRef.current?.abort();
    const ac = new AbortController();
    settingsAcRef.current = ac;
    void fetchVoices();
    void refreshKeyStatus();
    fetch(`/api/projects/${encodeURIComponent(projectId)}/elevenlabs/settings`, {
      signal: ac.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { defaultVoiceId?: string | null } | null) => {
        if (ac.signal.aborted) return;
        if (data && typeof data.defaultVoiceId === "string") {
          setDefaultVoiceId(data.defaultVoiceId);
        }
      })
      .catch((err: unknown) => {
        if (isAbort(err) || ac.signal.aborted) return;
        console.warn("[VoicesTab] load settings failed", err);
      });
    return () => {
      voicesAcRef.current?.abort();
      keyStatusAcRef.current?.abort();
      settingsAcRef.current?.abort();
      keyOpAcRef.current?.abort();
      useVoiceAcRef.current?.abort();
      stopAudio();
    };
  }, [projectId, fetchVoices, refreshKeyStatus, stopAudio]);

  const handlePreview = useCallback(
    (voiceId: string) => {
      // Toggle: clicking the same playing voice stops it.
      if (playingId === voiceId && audioRef.current) {
        stopAudio();
        setPlayingId(null);
        return;
      }
      stopAudio();
      const url = `/api/elevenlabs/voices/${encodeURIComponent(voiceId)}/preview?project=${encodeURIComponent(projectId)}`;
      const audio = new Audio(url);
      audio.onended = () => {
        // Only update state if this audio element is still the active one.
        if (audioVoiceIdRef.current === voiceId && audioRef.current === audio) {
          setPlayingId((current) => (current === voiceId ? null : current));
          audioRef.current = null;
          audioVoiceIdRef.current = null;
        }
      };
      audio.onerror = () => {
        if (audioVoiceIdRef.current === voiceId && audioRef.current === audio) {
          setPlayingId((current) => (current === voiceId ? null : current));
          audioRef.current = null;
          audioVoiceIdRef.current = null;
        }
      };
      audioRef.current = audio;
      audioVoiceIdRef.current = voiceId;
      setPlayingId(voiceId);
      void audio.play().catch(() => {
        if (audioVoiceIdRef.current === voiceId) setPlayingId(null);
      });
    },
    [playingId, projectId, stopAudio],
  );

  const handleUseVoice = useCallback(
    async (voiceId: string) => {
      useVoiceAcRef.current?.abort();
      const ac = new AbortController();
      useVoiceAcRef.current = ac;
      setSavingId(voiceId);
      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/elevenlabs/settings`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ defaultVoiceId: voiceId }),
            signal: ac.signal,
          },
        );
        if (ac.signal.aborted) return;
        if (res.ok) {
          const data = (await res.json()) as { defaultVoiceId?: string | null };
          if (ac.signal.aborted) return;
          setDefaultVoiceId(data.defaultVoiceId ?? voiceId);
        }
      } catch (err) {
        if (isAbort(err) || ac.signal.aborted) return;
        console.warn("[VoicesTab] handleUseVoice failed", err);
      } finally {
        if (!ac.signal.aborted) setSavingId(null);
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
