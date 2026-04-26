import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SceneCard, type AIActionId, type SceneSuggestion } from "../storyline/SceneCard";
import {
  applyInlineEdit,
  pickFocalCardIndex,
  type CardRect,
  type StorylineSceneInput,
} from "../storyline/sceneHelpers";

/**
 * Storyline tab — the creative cockpit.
 *
 * Three layers of control, each independent:
 *
 *   1. Per-scene Haiku actions  — Compress · Suggest emphasis · Sharpen why ·
 *      Re-pick template. Each returns a partial scene patch the user accepts
 *      with one click. Multiple proposals stack on a card; apply à la carte.
 *
 *   2. Storyline-level intent — free-form prompt at the top ("punch up
 *      retention in the first 10s"). Haiku reads the whole script + the
 *      intent and returns a list of per-scene patches. Same apply path.
 *
 *   3. Structural ops — reorder / insert / delete scenes via the bulk-ops
 *      endpoint. No re-synth needed; audio + visual are preserved on reorder.
 *
 * All three feed the same `applyPatch` flow so the data path is single-track.
 */

interface StorylineTabProps {
  projectId: string;
}

interface PlannedSceneApiShape {
  id: string;
  text: string;
  template: string;
  hook?: boolean;
  durationHint?: number;
  voiceId?: string;
  reasoning?: string;
  props: Record<string, unknown>;
  audio?: { path?: string; durationSeconds?: number };
}

interface PlannedScriptApiShape {
  meta?: { title?: string };
  scenes: PlannedSceneApiShape[];
}

interface ImageManifestEntry {
  id: string;
  dominantColor?: string;
}

interface IntentPatch {
  sceneId: string;
  preview: string;
  note: string;
  patch: { template?: string; props?: Record<string, unknown>; reasoning?: string };
}

interface ProjectIntentResponse {
  overallNote: string;
  themeSuggestion: {
    currentThemeId: string;
    suggestedThemeId: string | null;
    rationale: string;
  } | null;
  designBriefAddendum: { text: string; rationale: string } | null;
  patches: IntentPatch[];
}

type DirectorScope = "storyline" | "project";

const SCRIPT_GENERATED = "script.generated.json";

/** Custom DOM event dispatched when the focal scene card changes during
 * scroll. The Player listens for this and seeks the timeline so the right
 * panel preview tracks what the user's reading on the left. */
const FOCAL_EVENT = "hf:storyline-focal";

const ACTION_PATH: Record<AIActionId, string> = {
  compress: "compress",
  suggestEmphasis: "suggest-emphasis",
  refineReasoning: "refine-reasoning",
  rePickTemplate: "re-pick-template",
};

const SUGGESTION_PROMPTS_BY_SCOPE: Record<DirectorScope, string[]> = {
  storyline: [
    "punch up retention in the first 10 seconds",
    "tighten every hook to ≤6 words",
    "make the data scenes feel more urgent",
    "add an editorial breath scene before the climax",
  ],
  project: [
    "make the whole video feel investigative",
    "shift the brand toward cinematic / documentary",
    "tighten the brand voice — more confident, less academic",
    "swap to a darker theme so the data lands harder",
  ],
};

export const StorylineTab = memo(function StorylineTab({ projectId }: StorylineTabProps) {
  const [script, setScript] = useState<PlannedScriptApiShape | null>(null);
  const [imageMap, setImageMap] = useState<Map<string, ImageManifestEntry>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<
    Record<string, Partial<Record<AIActionId, "idle" | "running" | "error">>>
  >({});
  const [suggestionsByScene, setSuggestionsByScene] = useState<Record<string, SceneSuggestion[]>>(
    {},
  );

  // Director state — single textarea, two scopes (storyline vs project).
  const [directorScope, setDirectorScope] = useState<DirectorScope>("storyline");
  const [intent, setIntent] = useState("");
  const [intentRunning, setIntentRunning] = useState(false);
  const [intentResult, setIntentResult] = useState<{
    overallNote: string;
    patches: IntentPatch[];
  } | null>(null);
  const [projectIntentResult, setProjectIntentResult] = useState<ProjectIntentResponse | null>(
    null,
  );
  const [intentError, setIntentError] = useState<string | null>(null);

  // Counter to force a fresh GET after a write — avoids cached responses.
  const [reloadKey, setReloadKey] = useState(0);

  // Refs from each scene-card root → used by the IntersectionObserver-driven
  // focal-scene picker that auto-seeks the right-panel preview.
  const cardRefs = useRef<Map<string, HTMLElement>>(new Map());
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const lastFocalIndexRef = useRef<number>(-1);

  // Load the planned script + the image manifest on mount, project change, and
  // after every successful write.
  useEffect(() => {
    let cancelled = false;
    async function loadGeneratedOrPlanned(): Promise<PlannedScriptApiShape | null> {
      const generatedRes = await fetch(
        `/api/projects/${projectId}/files/${SCRIPT_GENERATED}`,
      ).catch(() => null);
      if (generatedRes && generatedRes.ok) {
        const { content } = (await generatedRes.json()) as { content?: string };
        if (typeof content === "string" && content.trim().length > 0) {
          try {
            return JSON.parse(content) as PlannedScriptApiShape;
          } catch {
            /* fall through to plan-only fallback */
          }
        }
      }
      const plannedRes = await fetch(`/api/projects/${projectId}/script`);
      if (!plannedRes.ok) throw new Error(`Failed to load script (${plannedRes.status})`);
      const json = (await plannedRes.json()) as { script?: PlannedScriptApiShape | null };
      return json.script ?? null;
    }

    async function load(): Promise<void> {
      setLoading(true);
      setError(null);
      try {
        const [planned, imagesRes] = await Promise.all([
          loadGeneratedOrPlanned(),
          fetch(`/api/projects/${projectId}/images`).catch(() => null),
        ]);
        if (cancelled) return;
        setScript(planned);
        if (imagesRes && imagesRes.ok) {
          const imgJson = (await imagesRes.json()) as { images?: ImageManifestEntry[] };
          const map = new Map<string, ImageManifestEntry>();
          for (const img of imgJson.images ?? []) {
            map.set(img.id, img);
          }
          if (!cancelled) setImageMap(map);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [projectId, reloadKey]);

  const scenesWithStart = useMemo(() => {
    if (!script) return [] as Array<{ scene: StorylineSceneInput; startSeconds: number }>;
    const out: Array<{ scene: StorylineSceneInput; startSeconds: number }> = [];
    let cursor = 0;
    for (const raw of script.scenes) {
      const scene: StorylineSceneInput = {
        id: raw.id,
        text: raw.text,
        template: raw.template,
        props: raw.props ?? {},
        hook: raw.hook,
        durationHint: raw.durationHint,
        voiceId: raw.voiceId,
        reasoning: raw.reasoning,
        ...(raw.audio ? { audio: raw.audio } : {}),
      };
      out.push({ scene, startSeconds: cursor });
      const dur = raw.audio?.durationSeconds ?? raw.durationHint ?? 0;
      cursor += dur;
    }
    return out;
  }, [script]);

  const totalDuration = useMemo(
    () =>
      scenesWithStart.reduce(
        (sum, { scene }) => sum + (scene.audio?.durationSeconds ?? scene.durationHint ?? 0),
        0,
      ),
    [scenesWithStart],
  );

  // ── Per-scene Haiku action ─────────────────────────────────────────────────

  const handleAIAction = useCallback(
    async (action: AIActionId, scene: StorylineSceneInput): Promise<void> => {
      setAiStatus((prev) => ({
        ...prev,
        [scene.id]: { ...(prev[scene.id] ?? {}), [action]: "running" },
      }));
      try {
        const res = await fetch(`/api/projects/${projectId}/storyline/${ACTION_PATH[action]}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sceneId: scene.id }),
        });
        if (!res.ok) {
          const errBody = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(errBody.error ?? `HTTP ${res.status}`);
        }
        const json = (await res.json()) as {
          preview?: string;
          rationale?: string;
          patch?: { template?: string; props?: Record<string, unknown>; reasoning?: string };
        };
        const suggestion: SceneSuggestion = {
          id: `${scene.id}-${action}-${Date.now()}`,
          action,
          preview: json.preview ?? "",
          rationale: json.rationale ?? "",
          patch: json.patch ?? {},
        };
        setSuggestionsByScene((prev) => ({
          ...prev,
          [scene.id]: [...(prev[scene.id] ?? []), suggestion],
        }));
        setAiStatus((prev) => ({
          ...prev,
          [scene.id]: { ...(prev[scene.id] ?? {}), [action]: "idle" },
        }));
      } catch (err) {
        setAiStatus((prev) => ({
          ...prev,
          [scene.id]: { ...(prev[scene.id] ?? {}), [action]: "error" },
        }));
        window.alert(
          `Couldn't run ${action} on ${scene.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [projectId],
  );

  // ── Apply / dismiss a suggestion ───────────────────────────────────────────

  const applyPatch = useCallback(
    async (
      sceneId: string,
      patch: { template?: string; props?: Record<string, unknown>; reasoning?: string },
    ): Promise<void> => {
      const current = script?.scenes.find((s) => s.id === sceneId);
      if (!current) throw new Error(`scene ${sceneId} not in current state`);
      const merged = {
        template: patch.template ?? current.template,
        props: patch.props ?? current.props,
        reasoning: patch.reasoning ?? current.reasoning,
        hook: current.hook,
      };
      const res = await fetch(`/api/projects/${projectId}/script/scenes/${sceneId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scene: merged }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
    },
    [projectId, script],
  );

  const handleApplySuggestion = useCallback(
    async (suggestion: SceneSuggestion, scene: StorylineSceneInput): Promise<void> => {
      try {
        await applyPatch(scene.id, suggestion.patch);
        setSuggestionsByScene((prev) => ({
          ...prev,
          [scene.id]: (prev[scene.id] ?? []).filter((s) => s.id !== suggestion.id),
        }));
        setReloadKey((k) => k + 1);
      } catch (err) {
        window.alert(`Couldn't apply: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [applyPatch],
  );

  const handleDismissSuggestion = useCallback((suggestionId: string) => {
    setSuggestionsByScene((prev) => {
      const next: typeof prev = {};
      for (const [sceneId, list] of Object.entries(prev)) {
        const filtered = list.filter((s) => s.id !== suggestionId);
        if (filtered.length > 0) next[sceneId] = filtered;
      }
      return next;
    });
  }, []);

  // ── Storyline intent ───────────────────────────────────────────────────────

  const runIntent = useCallback(async (): Promise<void> => {
    const trimmed = intent.trim();
    if (!trimmed) return;
    setIntentRunning(true);
    setIntentError(null);
    setIntentResult(null);
    setProjectIntentResult(null);
    try {
      const endpoint = directorScope === "project" ? "project-intent" : "intent";
      const res = await fetch(`/api/projects/${projectId}/storyline/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: trimmed }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json = await res.json();
      if (directorScope === "project") {
        setProjectIntentResult(json as ProjectIntentResponse);
      } else {
        const r = json as { overallNote?: string; patches?: IntentPatch[] };
        setIntentResult({ overallNote: r.overallNote ?? "", patches: r.patches ?? [] });
      }
    } catch (err) {
      setIntentError(err instanceof Error ? err.message : String(err));
    } finally {
      setIntentRunning(false);
    }
  }, [intent, projectId, directorScope]);

  const applyIntentPatch = useCallback(
    async (patch: IntentPatch): Promise<void> => {
      try {
        await applyPatch(patch.sceneId, patch.patch);
        setIntentResult((prev) =>
          prev
            ? { ...prev, patches: prev.patches.filter((p) => p.sceneId !== patch.sceneId) }
            : prev,
        );
        setProjectIntentResult((prev) =>
          prev
            ? { ...prev, patches: prev.patches.filter((p) => p.sceneId !== patch.sceneId) }
            : prev,
        );
        setReloadKey((k) => k + 1);
      } catch (err) {
        window.alert(`Couldn't apply: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [applyPatch],
  );

  const applyAllIntentPatches = useCallback(async (): Promise<void> => {
    const source = projectIntentResult ?? intentResult;
    if (!source || source.patches.length === 0) return;
    if (!window.confirm(`Apply ${source.patches.length} scene patches?`)) return;
    let failed = 0;
    for (const p of source.patches) {
      try {
        await applyPatch(p.sceneId, p.patch);
      } catch {
        failed += 1;
      }
    }
    setIntentResult(null);
    setProjectIntentResult(null);
    setReloadKey((k) => k + 1);
    if (failed > 0) window.alert(`${failed} patches failed — see console.`);
  }, [intentResult, projectIntentResult, applyPatch]);

  // ── Inline edit (Phase 3 feature 3) ────────────────────────────────────────
  // Save a single field edit (headline / subtext / accent) by computing the
  // updated props blob and PUTing the merged scene. Same write-back path as
  // every other apply — no parallel data flow.

  const handleInlineEdit = useCallback(
    async (sceneId: string, field: string, value: string): Promise<void> => {
      const current = script?.scenes.find((s) => s.id === sceneId);
      if (!current) return;
      const newProps = applyInlineEdit(current.props ?? {}, field, value);
      try {
        await applyPatch(sceneId, { props: newProps });
        setReloadKey((k) => k + 1);
      } catch (err) {
        window.alert(`Couldn't save: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [script, applyPatch],
  );

  // ── Bulk ops: reorder / delete / insert ────────────────────────────────────

  const runBulkOp = useCallback(
    async (op: BulkOpRequest): Promise<void> => {
      try {
        const res = await fetch(`/api/projects/${projectId}/storyline/scenes`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ops: [op] }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        setReloadKey((k) => k + 1);
      } catch (err) {
        window.alert(
          `Couldn't update scene order: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [projectId],
  );

  const handleMove = useCallback(
    (sceneId: string, direction: "up" | "down") => {
      if (!script) return;
      const ids = script.scenes.map((s) => s.id);
      const i = ids.indexOf(sceneId);
      const j = direction === "up" ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= ids.length) return;
      const next = [...ids];
      [next[i], next[j]] = [next[j]!, next[i]!];
      void runBulkOp({ type: "reorder", sceneIds: next });
    },
    [script, runBulkOp],
  );

  const handleDelete = useCallback(
    (sceneId: string) => {
      if (!window.confirm(`Delete scene ${sceneId}? Audio file is kept on disk.`)) return;
      void runBulkOp({ type: "delete", sceneId });
    },
    [runBulkOp],
  );

  const handleInsertAfter = useCallback(
    (sceneId: string) => {
      const newId = `s${Date.now().toString(36)}`;
      void runBulkOp({
        type: "insert",
        afterSceneId: sceneId,
        scene: {
          id: newId,
          text: "",
          template: "aroll-text",
          props: { title: "New scene" },
          durationHint: 4,
        },
      });
    },
    [runBulkOp],
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex-1 overflow-auto p-3 text-[11px] text-neutral-500">Loading script…</div>
    );
  }
  if (error) {
    return (
      <div className="flex-1 overflow-auto p-3">
        <div className="rounded-md border border-rose-900/40 bg-rose-950/30 p-3 text-[11px] text-rose-300">
          Couldn't load script: {error}
        </div>
      </div>
    );
  }
  if (!script || script.scenes.length === 0) {
    return (
      <div className="flex-1 overflow-auto p-3 text-[11px] text-neutral-500">
        No scenes yet. Plan a script in the Script tab to populate the storyline.
      </div>
    );
  }

  const totalLabel = `${Math.floor(totalDuration / 60)}:${String(
    Math.floor(totalDuration % 60),
  ).padStart(2, "0")}`;

  return (
    <div
      ref={scrollRootRef}
      className="flex-1 overflow-auto px-3 py-3"
      onScroll={() => {
        // Recompute focal scene whenever the user scrolls. Cheap — bounded by
        // scene count, no LLM calls. Dispatches a custom event the player
        // hook listens to.
        const root = scrollRootRef.current;
        if (!root) return;
        const rootRect = root.getBoundingClientRect();
        const cards: CardRect[] = scenesWithStart.map(({ scene }) => {
          const el = cardRefs.current.get(scene.id);
          if (!el) return { top: 0, height: 0 };
          const rect = el.getBoundingClientRect();
          return { top: rect.top - rootRect.top, height: rect.height };
        });
        const idx = pickFocalCardIndex(cards, rootRect.height);
        if (idx === lastFocalIndexRef.current || idx === -1) return;
        lastFocalIndexRef.current = idx;
        const focal = scenesWithStart[idx];
        if (!focal) return;
        window.dispatchEvent(
          new CustomEvent(FOCAL_EVENT, {
            detail: { time: focal.startSeconds, sceneId: focal.scene.id },
          }),
        );
      }}
    >
      <header className="mb-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[12px] font-semibold text-neutral-200 uppercase tracking-[0.16em]">
            Storyline
          </h2>
          <div className="text-[10px] text-neutral-500 tabular-nums">
            {script.scenes.length} scenes · {totalLabel}
          </div>
        </div>
        {script.meta?.title && (
          <p className="text-[11px] text-neutral-400 mt-1 line-clamp-2">{script.meta.title}</p>
        )}
        <p className="text-[10px] text-neutral-600 mt-2 leading-relaxed">
          Audio is the source of truth. Each card shows the narration the audience hears, plus the
          on-screen visual decisions made around it. Use the AI buttons or the Director below to
          refine. Click any headline / subtext to edit it inline.
        </p>
      </header>

      {/* Director — single textarea, two scopes. Storyline scope returns
          per-scene patches; Project scope additionally proposes theme + brief
          changes that move the whole video. */}
      <DirectorBar
        intent={intent}
        onIntentChange={setIntent}
        running={intentRunning}
        onSubmit={runIntent}
        scope={directorScope}
        onScopeChange={(s) => {
          setDirectorScope(s);
          setIntent("");
          setIntentResult(null);
          setProjectIntentResult(null);
          setIntentError(null);
        }}
        prompts={SUGGESTION_PROMPTS_BY_SCOPE[directorScope]}
      />

      {intentError && (
        <div className="mb-3 rounded-md border border-rose-900/40 bg-rose-950/30 p-2 text-[11px] text-rose-300">
          {intentError}
        </div>
      )}

      {intentResult && (
        <IntentPlanPanel
          result={intentResult}
          onApplyOne={applyIntentPatch}
          onApplyAll={applyAllIntentPatches}
          onDismissAll={() => setIntentResult(null)}
        />
      )}

      {projectIntentResult && (
        <ProjectIntentPanel
          result={projectIntentResult}
          onApplyOne={applyIntentPatch}
          onApplyAll={applyAllIntentPatches}
          onDismissAll={() => setProjectIntentResult(null)}
        />
      )}

      <div className="flex flex-col gap-3">
        {scenesWithStart.map(({ scene, startSeconds }, i) => {
          const imageId = typeof scene.props.imageId === "string" ? scene.props.imageId : null;
          const dominantColor = imageId ? imageMap.get(imageId)?.dominantColor : undefined;
          return (
            <div
              key={scene.id}
              ref={(el) => {
                if (el) cardRefs.current.set(scene.id, el);
                else cardRefs.current.delete(scene.id);
              }}
            >
              <SceneCard
                scene={scene}
                projectId={projectId}
                index={i}
                totalScenes={scenesWithStart.length}
                startSeconds={startSeconds}
                {...(dominantColor ? { imageDominantColor: dominantColor } : {})}
                onAIAction={handleAIAction}
                aiActionStatus={aiStatus[scene.id]}
                suggestions={suggestionsByScene[scene.id]}
                onApplySuggestion={handleApplySuggestion}
                onInlineEdit={handleInlineEdit}
                onDismissSuggestion={handleDismissSuggestion}
                onMove={handleMove}
                onDelete={handleDelete}
                onInsertAfter={handleInsertAfter}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
});

// ── Internals ────────────────────────────────────────────────────────────────

type BulkOpRequest =
  | { type: "reorder"; sceneIds: string[] }
  | { type: "delete"; sceneId: string }
  | {
      type: "insert";
      afterSceneId: string | null;
      scene: {
        id: string;
        text?: string;
        template?: string;
        props?: Record<string, unknown>;
        durationHint?: number;
      };
    };

function DirectorBar({
  intent,
  onIntentChange,
  running,
  onSubmit,
  scope,
  onScopeChange,
  prompts,
}: {
  intent: string;
  onIntentChange: (v: string) => void;
  running: boolean;
  onSubmit: () => void;
  scope: DirectorScope;
  onScopeChange: (s: DirectorScope) => void;
  prompts: string[];
}) {
  const subtitle =
    scope === "project"
      ? "ask Haiku to consider the theme, brief + image library when revising"
      : "ask Haiku to revise the whole storyline (template / props / accents)";
  return (
    <section className="mb-3 rounded-lg border border-studio-accent/25 bg-studio-accent/[0.03] p-3">
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[9px] uppercase tracking-[0.22em] font-semibold text-studio-accent">
            Director
          </span>
          <span className="text-[10px] text-neutral-500">{subtitle}</span>
        </div>
        <div
          className="flex items-center rounded-md border border-neutral-800 bg-neutral-900 p-0.5"
          role="tablist"
          aria-label="Director scope"
        >
          {(["storyline", "project"] as DirectorScope[]).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={scope === s}
              disabled={running}
              onClick={() => onScopeChange(s)}
              className={`h-5 px-2 rounded text-[9px] font-medium uppercase tracking-wide transition-colors ${
                scope === s
                  ? "bg-studio-accent/15 text-studio-accent"
                  : "text-neutral-500 hover:text-neutral-300"
              } disabled:opacity-40`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <textarea
        value={intent}
        onChange={(e) => onIntentChange(e.target.value)}
        rows={2}
        placeholder='e.g. "punch up retention in the first 10 seconds" — the audio stays untouched, only template + props change'
        className="w-full bg-neutral-950/50 border border-neutral-800 rounded-md px-2 py-1.5 text-[12px] text-neutral-100 placeholder:text-neutral-600 focus:border-studio-accent/50 focus:outline-none resize-none"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            onSubmit();
          }
        }}
        disabled={running}
      />
      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-1 flex-wrap">
          {prompts.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onIntentChange(p)}
              disabled={running}
              className="h-5 px-2 rounded-md text-[10px] text-neutral-500 hover:text-studio-accent hover:bg-studio-accent/10 transition-colors border border-transparent hover:border-studio-accent/30 disabled:opacity-40"
            >
              {p}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onSubmit}
          disabled={running || !intent.trim()}
          className="h-7 px-3 rounded-md text-[11px] font-semibold border border-studio-accent/40 bg-studio-accent/15 text-studio-accent hover:bg-studio-accent/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {running ? "Thinking…" : "Direct ↵"}
        </button>
      </div>
    </section>
  );
}

function IntentPlanPanel({
  result,
  onApplyOne,
  onApplyAll,
  onDismissAll,
}: {
  result: { overallNote: string; patches: IntentPatch[] };
  onApplyOne: (p: IntentPatch) => void;
  onApplyAll: () => void;
  onDismissAll: () => void;
}) {
  if (result.patches.length === 0) {
    return (
      <section className="mb-3 rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
        <div className="text-[11px] text-neutral-400">
          {result.overallNote || "Haiku didn't propose any changes for that intent."}
        </div>
        <button
          type="button"
          onClick={onDismissAll}
          className="mt-2 h-6 px-2 rounded text-[10px] text-neutral-500 hover:text-neutral-300"
        >
          Dismiss
        </button>
      </section>
    );
  }
  return (
    <section className="mb-3 rounded-lg border border-studio-accent/30 bg-studio-accent/[0.04] overflow-hidden">
      <header className="px-3 py-2 border-b border-studio-accent/20 flex items-center justify-between">
        <div>
          <div className="text-[9px] uppercase tracking-[0.22em] font-semibold text-studio-accent">
            Director plan · {result.patches.length} patch{result.patches.length === 1 ? "" : "es"}
          </div>
          {result.overallNote && (
            <p className="text-[11px] text-neutral-300 mt-1 leading-snug">{result.overallNote}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            type="button"
            onClick={onApplyAll}
            className="h-6 px-2.5 rounded-md text-[10px] font-semibold border border-studio-accent/50 bg-studio-accent/15 text-studio-accent hover:bg-studio-accent/25 transition-colors"
          >
            Apply all
          </button>
          <button
            type="button"
            onClick={onDismissAll}
            className="h-6 px-2 rounded-md text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors"
          >
            Dismiss
          </button>
        </div>
      </header>
      <div>
        {result.patches.map((p) => (
          <div
            key={p.sceneId}
            className="px-3 py-2 border-b border-studio-accent/15 last:border-b-0 flex items-start gap-3"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[10px] font-mono text-neutral-300">{p.sceneId}</span>
                <span className="text-[10px] text-neutral-500">{p.preview}</span>
              </div>
              {p.note && (
                <p className="text-[10px] text-neutral-500 italic leading-relaxed">{p.note}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => onApplyOne(p)}
              className="h-6 px-2.5 rounded-md text-[10px] font-semibold border border-studio-accent/50 bg-studio-accent/15 text-studio-accent hover:bg-studio-accent/25 transition-colors flex-shrink-0"
            >
              Apply
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function ProjectIntentPanel({
  result,
  onApplyOne,
  onApplyAll,
  onDismissAll,
}: {
  result: ProjectIntentResponse;
  onApplyOne: (p: IntentPatch) => void;
  onApplyAll: () => void;
  onDismissAll: () => void;
}) {
  const hasAnything =
    result.patches.length > 0 ||
    result.themeSuggestion !== null ||
    result.designBriefAddendum !== null;
  if (!hasAnything) {
    return (
      <section className="mb-3 rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
        <div className="text-[11px] text-neutral-400">
          {result.overallNote || "Haiku didn't propose any project-level changes for that intent."}
        </div>
        <button
          type="button"
          onClick={onDismissAll}
          className="mt-2 h-6 px-2 rounded text-[10px] text-neutral-500 hover:text-neutral-300"
        >
          Dismiss
        </button>
      </section>
    );
  }
  return (
    <section className="mb-3 rounded-lg border border-studio-accent/30 bg-studio-accent/[0.04] overflow-hidden">
      <header className="px-3 py-2 border-b border-studio-accent/20 flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="text-[9px] uppercase tracking-[0.22em] font-semibold text-studio-accent">
            Project plan · {result.patches.length} scene patch
            {result.patches.length === 1 ? "" : "es"}
          </div>
          {result.overallNote && (
            <p className="text-[11px] text-neutral-300 mt-1 leading-snug">{result.overallNote}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {result.patches.length > 0 && (
            <button
              type="button"
              onClick={onApplyAll}
              className="h-6 px-2.5 rounded-md text-[10px] font-semibold border border-studio-accent/50 bg-studio-accent/15 text-studio-accent hover:bg-studio-accent/25 transition-colors"
            >
              Apply scene patches
            </button>
          )}
          <button
            type="button"
            onClick={onDismissAll}
            className="h-6 px-2 rounded-md text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors"
          >
            Dismiss
          </button>
        </div>
      </header>

      {/* Theme suggestion — non-binding, surfaced for the user to act on
          via the existing Theme picker in the Script tab. */}
      {result.themeSuggestion && (
        <div className="px-3 py-2 border-b border-studio-accent/15 bg-studio-accent/[0.02]">
          <div className="text-[9px] uppercase tracking-[0.18em] text-neutral-500 mb-1">
            Theme suggestion
          </div>
          <div className="text-[12px] text-neutral-100">
            <span className="font-mono text-neutral-400">
              {result.themeSuggestion.currentThemeId}
            </span>
            <span className="mx-1 text-neutral-600">→</span>
            <span className="font-mono text-studio-accent">
              {result.themeSuggestion.suggestedThemeId}
            </span>
          </div>
          {result.themeSuggestion.rationale && (
            <p className="text-[10px] text-neutral-500 italic leading-relaxed mt-0.5">
              {result.themeSuggestion.rationale}
            </p>
          )}
          <p className="text-[10px] text-neutral-600 mt-1">
            Apply via the Theme picker in the Script tab.
          </p>
        </div>
      )}

      {/* Design brief addendum — markdown snippet to append to DESIGN.md.
          User copies + pastes; we don't auto-write. */}
      {result.designBriefAddendum && (
        <div className="px-3 py-2 border-b border-studio-accent/15 bg-studio-accent/[0.02]">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[9px] uppercase tracking-[0.18em] text-neutral-500">
              Design brief addendum
            </div>
            <button
              type="button"
              onClick={() => {
                if (result.designBriefAddendum) {
                  void navigator.clipboard.writeText(result.designBriefAddendum.text);
                }
              }}
              className="h-5 px-2 rounded text-[9px] text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 transition-colors"
            >
              Copy
            </button>
          </div>
          <pre className="text-[10px] text-neutral-200 leading-relaxed whitespace-pre-wrap font-mono bg-neutral-950/50 border border-neutral-800 rounded p-2">
            {result.designBriefAddendum.text}
          </pre>
          {result.designBriefAddendum.rationale && (
            <p className="text-[10px] text-neutral-500 italic leading-relaxed mt-1">
              {result.designBriefAddendum.rationale}
            </p>
          )}
        </div>
      )}

      {result.patches.length > 0 && (
        <div>
          {result.patches.map((p) => (
            <div
              key={p.sceneId}
              className="px-3 py-2 border-b border-studio-accent/15 last:border-b-0 flex items-start gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[10px] font-mono text-neutral-300">{p.sceneId}</span>
                  <span className="text-[10px] text-neutral-500">{p.preview}</span>
                </div>
                {p.note && (
                  <p className="text-[10px] text-neutral-500 italic leading-relaxed">{p.note}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => onApplyOne(p)}
                className="h-6 px-2.5 rounded-md text-[10px] font-semibold border border-studio-accent/50 bg-studio-accent/15 text-studio-accent hover:bg-studio-accent/25 transition-colors flex-shrink-0"
              >
                Apply
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
