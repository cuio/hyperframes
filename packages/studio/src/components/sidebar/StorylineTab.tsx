import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SceneCard,
  type AIActionId,
  type AppliedSfxEntry,
  type SceneSuggestion,
  type SfxSuggestion,
} from "../storyline/SceneCard";
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
  // addSfx returns multi-suggestion shape, not a single patch — handled in a
  // dedicated branch in handleAIAction. The path is the same prefix so it
  // shares the route table.
  addSfx: "sfx-suggest",
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

  // SFX state. Three independent maps — proposed (Haiku output, not yet
  // generated), applied (in the manifest, audible on the SFX lane), and
  // per-suggestion generation status (so the Generate button can show a
  // spinner without freezing the rest of the card).
  const [sfxSuggestionsByScene, setSfxSuggestionsByScene] = useState<
    Record<string, SfxSuggestion[]>
  >({});
  const [sfxByScene, setSfxByScene] = useState<Record<string, AppliedSfxEntry[]>>({});
  const [sfxGenerationStatus, setSfxGenerationStatus] = useState<
    Record<string, "idle" | "running" | "error">
  >({});

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

  // Theme auto-apply state — when the project Director surfaces a theme
  // suggestion we let the user "Try" it. Trying writes via the existing
  // PUT /theme endpoint and remembers the previous theme so "Revert" can
  // restore it. "Keep" just dismisses the trial overlay.
  const [tryingTheme, setTryingTheme] = useState<{
    previousThemeId: string;
    triedThemeId: string;
  } | null>(null);

  // Keyboard navigation — which scene index is the keyboard focal. Driven by
  // j/k and synced to the scroll-based focal index when the user scrolls
  // (so kbd nav and scroll nav don't fight). `editFlagBySceneId` flips a
  // per-scene boolean that the SceneCard consumes once and clears.
  const [keyFocalIndex, setKeyFocalIndex] = useState(0);
  const [editFlagBySceneId, setEditFlagBySceneId] = useState<Record<string, boolean>>({});

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
        const [planned, imagesRes, sfxRes] = await Promise.all([
          loadGeneratedOrPlanned(),
          fetch(`/api/projects/${projectId}/images`).catch(() => null),
          fetch(`/api/projects/${projectId}/storyline/sfx`).catch(() => null),
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
        if (sfxRes && sfxRes.ok) {
          const sfxJson = (await sfxRes.json()) as {
            manifest?: { entries?: AppliedSfxEntry[] };
          };
          const grouped: Record<string, AppliedSfxEntry[]> = {};
          for (const entry of sfxJson.manifest?.entries ?? []) {
            const list = grouped[(entry as AppliedSfxEntry & { sceneId: string }).sceneId] ?? [];
            list.push(entry);
            grouped[(entry as AppliedSfxEntry & { sceneId: string }).sceneId] = list;
          }
          if (!cancelled) setSfxByScene(grouped);
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
        if (action === "addSfx") {
          // Different shape: list of suggestions instead of a single patch.
          const json = (await res.json()) as {
            sceneId?: string;
            suggestions?: SfxSuggestion[];
          };
          setSfxSuggestionsByScene((prev) => ({
            ...prev,
            [scene.id]: [...(prev[scene.id] ?? []), ...(json.suggestions ?? [])],
          }));
        } else {
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

  // ── SFX handlers ───────────────────────────────────────────────────────────

  const handleGenerateSfx = useCallback(
    async (sceneId: string, suggestion: SfxSuggestion): Promise<void> => {
      setSfxGenerationStatus((prev) => ({ ...prev, [suggestion.id]: "running" }));
      try {
        const res = await fetch(`/api/projects/${projectId}/storyline/sfx-generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sceneId,
            prompt: suggestion.prompt,
            durationSeconds: suggestion.durationSeconds,
            anchor: suggestion.anchor,
            ...(typeof suggestion.accentWordIndex === "number"
              ? { accentWordIndex: suggestion.accentWordIndex }
              : {}),
            ...(suggestion.label ? { label: suggestion.label } : {}),
          }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        const json = (await res.json()) as { ok?: boolean; entry?: AppliedSfxEntry };
        if (json.entry) {
          setSfxByScene((prev) => ({
            ...prev,
            [sceneId]: [...(prev[sceneId] ?? []), json.entry!],
          }));
        }
        // Drop the matching suggestion from the pending stack — no point
        // generating it twice.
        setSfxSuggestionsByScene((prev) => ({
          ...prev,
          [sceneId]: (prev[sceneId] ?? []).filter((s) => s.id !== suggestion.id),
        }));
        setSfxGenerationStatus((prev) => {
          const { [suggestion.id]: _, ...rest } = prev;
          return rest;
        });
        // Re-assemble so the new SFX lands on the SFX lane in the timeline.
        setReloadKey((k) => k + 1);
      } catch (err) {
        setSfxGenerationStatus((prev) => ({ ...prev, [suggestion.id]: "error" }));
        window.alert(`Couldn't generate SFX: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [projectId],
  );

  const handleDismissSfxSuggestion = useCallback((suggestionId: string) => {
    setSfxSuggestionsByScene((prev) => {
      const next: typeof prev = {};
      for (const [sceneId, list] of Object.entries(prev)) {
        const filtered = list.filter((s) => s.id !== suggestionId);
        if (filtered.length > 0) next[sceneId] = filtered;
      }
      return next;
    });
  }, []);

  const handleDeleteAppliedSfx = useCallback(
    async (entryId: string): Promise<void> => {
      try {
        const res = await fetch(`/api/projects/${projectId}/storyline/sfx/${entryId}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        setSfxByScene((prev) => {
          const next: typeof prev = {};
          for (const [sceneId, list] of Object.entries(prev)) {
            const filtered = list.filter((e) => e.id !== entryId);
            if (filtered.length > 0) next[sceneId] = filtered;
          }
          return next;
        });
        setReloadKey((k) => k + 1);
      } catch (err) {
        window.alert(`Couldn't remove SFX: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [projectId],
  );

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

  // ── Per-scene Director ─────────────────────────────────────────────────────
  // Same suggestion stack as per-scene Haiku actions — the response shape from
  // /scene-intent is the storyline-intent shape (overallNote + patches), so we
  // pull each patch out and surface it on the focal scene's card with a
  // synthesised SceneSuggestion. Keeps the apply path single-track.

  const handleSceneIntent = useCallback(
    async (sceneId: string, intent: string): Promise<void> => {
      try {
        const res = await fetch(`/api/projects/${projectId}/storyline/scene-intent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sceneId, intent }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const json = (await res.json()) as { overallNote?: string; patches?: IntentPatch[] };
        const patches = json.patches ?? [];
        if (patches.length === 0) {
          window.alert(
            json.overallNote
              ? `Haiku didn't propose changes:\n${json.overallNote}`
              : "Haiku didn't propose any changes for that prompt.",
          );
          return;
        }
        // Convert each patch into a SceneSuggestion landed on the right card.
        // We model scene-intent suggestions as `rePickTemplate` for label clarity
        // (mixed patches can change template + props + reasoning); the action
        // ID is purely a labelling concern — apply still goes through the
        // generic merge path.
        setSuggestionsByScene((prev) => {
          const next = { ...prev };
          for (const p of patches) {
            const list = next[p.sceneId] ?? [];
            next[p.sceneId] = [
              ...list,
              {
                id: `${p.sceneId}-sceneIntent-${Date.now()}-${list.length}`,
                action: "rePickTemplate" as AIActionId,
                preview: `${p.preview}${p.note ? ` — ${p.note}` : ""}`,
                rationale: json.overallNote ?? p.note ?? "",
                patch: p.patch,
              },
            ];
          }
          return next;
        });
      } catch (err) {
        window.alert(`Couldn't direct scene: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [projectId],
  );

  // ── Theme auto-apply (Try / Revert / Keep) ────────────────────────────────
  // Project Director surfaces a non-binding theme suggestion. "Try theme"
  // PUTs the suggested id to /theme; the studio rebuilds tokens on next
  // assemble. We remember the previous theme so the user can revert without
  // hunting through the Theme picker.

  const tryThemeSuggestion = useCallback(
    async (currentThemeId: string, suggestedThemeId: string): Promise<void> => {
      try {
        const res = await fetch(`/api/projects/${projectId}/theme`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ theme: suggestedThemeId }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        setTryingTheme({ previousThemeId: currentThemeId, triedThemeId: suggestedThemeId });
        setReloadKey((k) => k + 1);
      } catch (err) {
        window.alert(`Couldn't try theme: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [projectId],
  );

  const revertTheme = useCallback(async (): Promise<void> => {
    if (!tryingTheme) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/theme`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: tryingTheme.previousThemeId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setTryingTheme(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      window.alert(`Couldn't revert theme: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [tryingTheme, projectId]);

  const keepTriedTheme = useCallback(() => setTryingTheme(null), []);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  // j / k navigate between cards (vim-style). `e` opens the focal card's
  // headline for inline edit. `c` triggers Compress on the focal scene.
  // Shortcuts are skipped when the user is typing in an input/textarea.

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (
        tag === "input" ||
        tag === "textarea" ||
        (e.target as HTMLElement | null)?.isContentEditable
      ) {
        return;
      }
      const cards = scenesWithStart;
      if (cards.length === 0) return;
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        const next = Math.min(cards.length - 1, lastFocalIndexRef.current + 1);
        lastFocalIndexRef.current = next;
        setKeyFocalIndex(next);
        const sceneId = cards[next]?.scene.id;
        if (sceneId)
          cardRefs.current.get(sceneId)?.scrollIntoView({ behavior: "smooth", block: "center" });
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        const next = Math.max(0, lastFocalIndexRef.current - 1);
        lastFocalIndexRef.current = next;
        setKeyFocalIndex(next);
        const sceneId = cards[next]?.scene.id;
        if (sceneId)
          cardRefs.current.get(sceneId)?.scrollIntoView({ behavior: "smooth", block: "center" });
      } else if (e.key === "e") {
        e.preventDefault();
        const idx = lastFocalIndexRef.current >= 0 ? lastFocalIndexRef.current : keyFocalIndex;
        const focal = cards[idx]?.scene;
        if (focal) setEditFlagBySceneId((prev) => ({ ...prev, [focal.id]: true }));
      } else if (e.key === "c") {
        e.preventDefault();
        const idx = lastFocalIndexRef.current >= 0 ? lastFocalIndexRef.current : keyFocalIndex;
        const focal = cards[idx]?.scene;
        if (focal) void handleAIAction("compress", focal);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [scenesWithStart, keyFocalIndex, handleAIAction]);

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
        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
          <span className="text-[9px] uppercase tracking-[0.22em] font-semibold text-neutral-600">
            shortcuts
          </span>
          <KbdHint keys={["j", "k"]} label="prev / next" />
          <KbdHint keys={["e"]} label="edit headline" />
          <KbdHint keys={["c"]} label="compress" />
        </div>
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
          tryingTheme={tryingTheme !== null}
          onTryTheme={tryThemeSuggestion}
        />
      )}

      {/* Theme trial overlay — shown while a Director-suggested theme is
          live but not yet committed. Revert restores the previous theme;
          Keep just dismisses the banner. */}
      {tryingTheme && (
        <section className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/[0.05] px-3 py-2">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] text-amber-200">
              Trying theme{" "}
              <span className="font-mono text-amber-100">{tryingTheme.triedThemeId}</span>{" "}
              <span className="text-amber-400/70">
                (was <span className="font-mono">{tryingTheme.previousThemeId}</span>)
              </span>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                type="button"
                onClick={revertTheme}
                className="h-6 px-2.5 rounded-md text-[10px] font-semibold border border-amber-500/40 text-amber-200 hover:bg-amber-500/10 transition-colors"
              >
                Revert
              </button>
              <button
                type="button"
                onClick={keepTriedTheme}
                className="h-6 px-2.5 rounded-md text-[10px] font-semibold border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 transition-colors"
              >
                Keep
              </button>
            </div>
          </div>
        </section>
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
                onSceneIntent={handleSceneIntent}
                forceEditHeadline={editFlagBySceneId[scene.id] === true}
                onConsumeEditHeadlineFlag={() =>
                  setEditFlagBySceneId((prev) => {
                    if (!prev[scene.id]) return prev;
                    const next = { ...prev };
                    delete next[scene.id];
                    return next;
                  })
                }
                sfxSuggestions={sfxSuggestionsByScene[scene.id]}
                appliedSfx={sfxByScene[scene.id]}
                onGenerateSfx={handleGenerateSfx}
                onDismissSfxSuggestion={handleDismissSfxSuggestion}
                onDeleteAppliedSfx={handleDeleteAppliedSfx}
                sfxGenerationStatus={sfxGenerationStatus}
                sfxAuditionUrlPrefix={`/api/projects/${projectId}/preview/`}
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
  tryingTheme,
  onTryTheme,
}: {
  result: ProjectIntentResponse;
  onApplyOne: (p: IntentPatch) => void;
  onApplyAll: () => void;
  onDismissAll: () => void;
  /** True while a theme trial is already live — disables the Try button. */
  tryingTheme: boolean;
  onTryTheme: (currentThemeId: string, suggestedThemeId: string) => void;
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

      {/* Theme suggestion — Try writes to hyperframes.json on a trial basis;
          parent renders the Revert/Keep banner so the user can roll back
          without hunting through the Theme picker. */}
      {result.themeSuggestion && (
        <div className="px-3 py-2 border-b border-studio-accent/15 bg-studio-accent/[0.02]">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[9px] uppercase tracking-[0.18em] text-neutral-500">
              Theme suggestion
            </div>
            <button
              type="button"
              disabled={tryingTheme || !result.themeSuggestion.suggestedThemeId}
              onClick={() => {
                if (!result.themeSuggestion?.suggestedThemeId) return;
                onTryTheme(
                  result.themeSuggestion.currentThemeId,
                  result.themeSuggestion.suggestedThemeId,
                );
              }}
              className="h-5 px-2 rounded text-[9px] font-semibold border border-studio-accent/50 bg-studio-accent/15 text-studio-accent hover:bg-studio-accent/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title="Apply this theme on a trial basis — Revert / Keep banner will appear"
            >
              {tryingTheme ? "Trial running" : "Try theme"}
            </button>
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

function KbdHint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-neutral-500">
      {keys.map((k, i) => (
        <kbd
          key={i}
          className="px-1 min-w-[16px] h-4 text-center inline-flex items-center justify-center rounded text-[9px] font-mono bg-neutral-900 border border-neutral-800 text-neutral-400"
        >
          {k}
        </kbd>
      ))}
      <span className="text-neutral-600">{label}</span>
    </span>
  );
}
