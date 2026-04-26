import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { SceneCard, type AIActionId } from "../storyline/SceneCard";
import type { StorylineSceneInput } from "../storyline/sceneHelpers";

/**
 * The Storyline tab — the "creative cockpit" the user direct from. Lists every
 * scene as a card, audio-first. Per-card AI actions delegate to dedicated
 * Haiku endpoints (Phase 2). For Phase 1 the AI handler is wired but only
 * `compress` is connected end-to-end as a representative pattern; the others
 * fire a no-op alert so we can validate the surface independently of the
 * full LLM pipeline.
 *
 * Design intent: show the user *every* fact the AI knows about a scene at a
 * glance — narration, visual, image, data points, reasoning — so they can
 * see *why* the AI made each choice and override it cheaply.
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

const SCRIPT_GENERATED = "script.generated.json";

export const StorylineTab = memo(function StorylineTab({ projectId }: StorylineTabProps) {
  const [script, setScript] = useState<PlannedScriptApiShape | null>(null);
  const [imageMap, setImageMap] = useState<Map<string, ImageManifestEntry>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<
    Record<string, Partial<Record<AIActionId, "idle" | "running" | "error">>>
  >({});

  // Load the planned script + the image manifest on mount and project change.
  // Preference order: script.generated.json (post-synth, has audio paths) →
  // script.json (post-plan, no audio yet). Fetched via the generic files
  // endpoint so we don't need a dedicated "generated" route.
  useEffect(() => {
    let cancelled = false;
    async function loadGeneratedOrPlanned(): Promise<PlannedScriptApiShape | null> {
      // 1) Try the post-synth file via the files endpoint.
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
      // 2) Fall back to the post-plan script (audio-less).
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
  }, [projectId]);

  // Build a flat list of scenes with cumulative start times so the cards can
  // show their @ position in the timeline.
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

  const handleAIAction = useCallback(
    async (action: AIActionId, scene: StorylineSceneInput): Promise<void> => {
      setAiStatus((prev) => ({
        ...prev,
        [scene.id]: { ...(prev[scene.id] ?? {}), [action]: "running" },
      }));
      try {
        if (action === "compress") {
          const res = await fetch(`/api/projects/${projectId}/storyline/compress`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sceneId: scene.id }),
          });
          if (!res.ok) {
            const errBody = await res.json().catch(() => ({ error: "unknown" }));
            throw new Error(errBody.error ?? `HTTP ${res.status}`);
          }
          const json = (await res.json()) as { suggestion?: string; words?: string[] };
          // For Phase 1 we just preview the suggestion — applying it lands in Phase 2.
          const preview = json.suggestion ?? json.words?.join(" ") ?? "(no suggestion)";
          window.alert(`Compress suggestion for ${scene.id}:\n\n${preview}`);
        } else {
          window.alert(
            `${action} is not wired yet — Phase 2 follow-up. The button + state plumbing are in place.`,
          );
        }
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
    <div className="flex-1 overflow-auto px-3 py-3">
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
          on-screen visual decisions made around it. Use the AI buttons to refine.
        </p>
      </header>

      <div className="flex flex-col gap-3">
        {scenesWithStart.map(({ scene, startSeconds }, i) => {
          const imageId = typeof scene.props.imageId === "string" ? scene.props.imageId : null;
          const dominantColor = imageId ? imageMap.get(imageId)?.dominantColor : undefined;
          return (
            <SceneCard
              key={scene.id}
              scene={scene}
              projectId={projectId}
              index={i}
              startSeconds={startSeconds}
              {...(dominantColor ? { imageDominantColor: dominantColor } : {})}
              onAIAction={handleAIAction}
              aiActionStatus={aiStatus[scene.id]}
            />
          );
        })}
      </div>
    </div>
  );
});
