import { memo, useCallback, useEffect, useState } from "react";

interface ScriptTabProps {
  projectId: string;
}

interface SceneRef {
  id: string;
  text: string;
  template: string;
  props: Record<string, unknown>;
  hook?: boolean;
  voiceId?: string;
  durationHint?: number;
}

interface Script {
  meta: { title?: string; voiceId?: string; audience?: string; tone?: string };
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
  const [target, setTarget] = useState("60");
  const [script, setScript] = useState<Script | null>(null);
  const [busy, setBusy] = useState<BusyState>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [anthropicKey, setAnthropicKey] = useState<KeyStatus | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [defaultVoiceId, setDefaultVoiceId] = useState<string | null>(null);

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
  }, [loadAnthropicKeyStatus, loadExistingScript, loadDefaultVoice]);

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
          targetDurationSeconds: target ? parseFloat(target) : undefined,
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
  }, [projectId, text, target, audience, tone]);

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
        <div className="flex gap-2 items-center">
          <label className="text-[10px] text-neutral-500">Target (s)</label>
          <input
            type="number"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            min={10}
            max={600}
            className="h-7 w-20 bg-neutral-900 border border-neutral-800 rounded-md px-2 text-[11px] text-neutral-200 focus:outline-none focus:border-neutral-700"
          />
          <button
            type="button"
            onClick={() => void handlePlan()}
            disabled={!text.trim() || planning || generating || needsAnthropicKey}
            className="ml-auto h-7 px-3 rounded-md text-[11px] font-medium border border-studio-accent/40 bg-studio-accent/10 text-studio-accent hover:bg-studio-accent/15 disabled:opacity-40"
          >
            {planning ? "Planning…" : "Plan with AI"}
          </button>
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
          <div className="flex flex-col gap-1.5">
            {script.scenes.map((scene) => (
              <div
                key={scene.id}
                className="rounded-md border border-neutral-800 bg-neutral-900/60 px-2 py-1.5"
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-mono text-neutral-500">{scene.id}</span>
                  <span className="text-[10px] text-studio-accent">{scene.template}</span>
                  {scene.hook && (
                    <span className="text-[9px] uppercase tracking-wider text-amber-400">hook</span>
                  )}
                </div>
                {scene.text && (
                  <div className="text-[11px] text-neutral-300 mt-1 line-clamp-2">{scene.text}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
