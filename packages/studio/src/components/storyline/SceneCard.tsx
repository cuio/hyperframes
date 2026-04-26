import { memo, useCallback, useState, type ReactNode } from "react";
import { AudioWaveform } from "../../player/components/AudioWaveform";
import {
  auditWordBudget,
  extractDataPoints,
  pickAccentWord,
  pickImageId,
  pickOnScreenHeadline,
  pickOnScreenSubtext,
  summarizeScene,
  type StorylineSceneInput,
  type WordBudgetStatus,
} from "./sceneHelpers";

/**
 * The Storyline scene card.
 *
 * Treats the audio narration as the source of truth — that's what the audience
 * will *hear*. Everything else (template, on-screen text, image, reasoning) is
 * rendered as decisions made *around* that audio. The layout reflects this:
 *
 *   ─ Header ─── id · template · duration · hook tag ──────────────────
 *   ─ Audio ─── waveform + transcript ─────────────────────────────────
 *   ─ Visual ── on-screen headline · accent · subtext · word-budget ───
 *   ─ Image ─── image-id badge or "no image" ──────────────────────────
 *   ─ Data ──── numbers extracted from the narration ──────────────────
 *   ─ Why ───── planner reasoning, expandable ─────────────────────────
 *   ─ Actions ─ Haiku-powered tools (Compress · Suggest · Refine) ─────
 *
 * Read-only in this phase: the AI actions wire to backend endpoints that
 * propose changes; merging those changes into script.json comes in the next
 * phase. Read-only is deliberate — it lets us validate the surface before
 * the editing pipeline lands.
 */

interface SceneCardProps {
  scene: StorylineSceneInput;
  projectId: string;
  /** Index in the scene list. Drives the playback timecode label. */
  index: number;
  /** Cumulative seconds before this scene starts (for "@ 0:21" badge). */
  startSeconds: number;
  /** Image-manifest dominant color, used to tint the image badge. Optional. */
  imageDominantColor?: string;
  /** Optional handler invoked when the user fires a Haiku action. */
  onAIAction?: (action: AIActionId, scene: StorylineSceneInput) => Promise<void> | void;
  /** Status per AI action, surfaced as a spinner / disabled state on the button. */
  aiActionStatus?: Partial<Record<AIActionId, "idle" | "running" | "error">>;
}

export type AIActionId = "compress" | "suggestEmphasis" | "refineReasoning" | "rePickTemplate";

const AI_ACTIONS: Array<{ id: AIActionId; label: string; tooltip: string }> = [
  {
    id: "compress",
    label: "Compress",
    tooltip: "Rewrite the on-screen text to fit the template's word budget",
  },
  {
    id: "suggestEmphasis",
    label: "Suggest emphasis",
    tooltip: "Pick the strongest accent word for this headline",
  },
  {
    id: "refineReasoning",
    label: "Sharpen why",
    tooltip: "Rewrite the reasoning so the directorial intent is explicit",
  },
  {
    id: "rePickTemplate",
    label: "Re-pick template",
    tooltip: "Generate 3 alternative template+props treatments and pick one",
  },
];

const STATUS_TONE: Record<WordBudgetStatus, { label: string; tone: string }> = {
  ok: { label: "✓", tone: "text-emerald-400 border-emerald-400/40 bg-emerald-400/10" },
  warn: { label: "⚠", tone: "text-amber-400 border-amber-400/40 bg-amber-400/10" },
  over: { label: "✕", tone: "text-rose-400 border-rose-400/40 bg-rose-400/10" },
  unknown: { label: "·", tone: "text-neutral-500 border-neutral-700 bg-neutral-900" },
};

export const SceneCard = memo(function SceneCard({
  scene,
  projectId,
  index,
  startSeconds,
  imageDominantColor,
  onAIAction,
  aiActionStatus,
}: SceneCardProps) {
  const [expandedReason, setExpandedReason] = useState(false);
  const summary = summarizeScene(scene);
  const headline = pickOnScreenHeadline(scene.template, scene.props);
  const subtext = pickOnScreenSubtext(scene.template, scene.props);
  const accent = pickAccentWord(scene.template, scene.props);
  const imageId = pickImageId(scene.props);
  const dataPoints = extractDataPoints(scene.text);
  const budget = auditWordBudget(scene.template, headline);

  const audioUrl = scene.audio?.path
    ? `/api/projects/${projectId}/preview/${scene.audio.path}`
    : null;

  const handleAction = useCallback(
    (id: AIActionId) => {
      if (!onAIAction) return;
      void onAIAction(id, scene);
    },
    [onAIAction, scene],
  );

  return (
    <article
      className="group rounded-lg border border-neutral-800 bg-neutral-900/55 overflow-hidden hover:border-neutral-700 transition-colors"
      aria-label={`Scene ${summary.id}, template ${summary.template}`}
    >
      <Header
        sceneId={summary.id}
        template={summary.template}
        durationLabel={summary.durationLabel}
        hook={summary.hook}
        index={index}
        startSeconds={startSeconds}
      />

      {/* Audio strip — the center of gravity. Transcript reads as caption beneath.
          The waveform is `position: absolute; inset: 0` internally, so the
          wrapper MUST be `relative` with an explicit height — otherwise the
          waveform escapes to the nearest positioned ancestor and bleeds across
          the whole sidebar. */}
      <Section label="Audio" tone="primary">
        {audioUrl ? (
          <div className="relative h-12 mb-2 rounded-md overflow-hidden border border-neutral-800/70 bg-neutral-950/40">
            <AudioWaveform audioUrl={audioUrl} label="" labelColor="#3CE6AC" />
          </div>
        ) : (
          <div className="h-12 mb-2 rounded-md border border-dashed border-neutral-800 flex items-center justify-center text-[10px] text-neutral-600 italic">
            No audio synthesized yet
          </div>
        )}
        <p className="text-[12px] text-neutral-200 leading-relaxed">{scene.text}</p>
      </Section>

      {/* Visual block — what shows on screen, with budget chip. */}
      <Section
        label="On screen"
        rightSlot={
          <WordBudgetChip status={budget.status} count={budget.count} budget={budget.budget} />
        }
      >
        {headline ? (
          <div className="text-[13px] text-neutral-100 leading-snug font-medium">
            {accent ? <HighlightAccent text={headline} accent={accent} /> : headline}
          </div>
        ) : (
          <div className="text-[11px] text-neutral-600 italic">
            (Template emits visuals from script.text — no explicit headline.)
          </div>
        )}
        {subtext && (
          <div className="text-[11px] text-neutral-400 leading-relaxed mt-1.5">{subtext}</div>
        )}
        {accent && (
          <div className="mt-2 inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[9px] uppercase tracking-[0.18em] border border-studio-accent/30 bg-studio-accent/5 text-studio-accent">
            accent ·{" "}
            <span className="font-semibold normal-case tracking-normal text-[10px]">{accent}</span>
          </div>
        )}
      </Section>

      {/* Image badge — assignment is via the visual director, surfaced here. */}
      <Section label="Image">
        {imageId ? (
          <div className="flex items-center gap-2">
            <div
              className="w-6 h-6 rounded-md border border-neutral-700"
              style={{
                background: imageDominantColor
                  ? `linear-gradient(135deg, ${imageDominantColor}, ${imageDominantColor}55)`
                  : "linear-gradient(135deg, #2a2a2a, #1a1a1a)",
              }}
              aria-hidden="true"
            />
            <span className="text-[11px] font-mono text-neutral-300">{imageId}</span>
          </div>
        ) : (
          <div className="text-[11px] text-neutral-600 italic">
            Typography only — no image assigned.
          </div>
        )}
      </Section>

      {/* Data backbone — what numbers does this scene rest on? */}
      {dataPoints.length > 0 && (
        <Section label="Data">
          <div className="flex flex-wrap gap-1">
            {dataPoints.map((dp) => (
              <span
                key={dp}
                className="px-1.5 py-0.5 rounded text-[10px] font-mono border border-neutral-700 bg-neutral-900 text-neutral-300"
              >
                {dp}
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* Reasoning — collapsed by default to keep the card scannable. */}
      <Section
        label="Why"
        rightSlot={
          scene.reasoning ? (
            <button
              type="button"
              onClick={() => setExpandedReason((p) => !p)}
              className="text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors"
              aria-expanded={expandedReason}
            >
              {expandedReason ? "Collapse" : "Expand"}
            </button>
          ) : undefined
        }
      >
        {scene.reasoning ? (
          <p
            className={`text-[11px] text-neutral-400 leading-relaxed italic ${expandedReason ? "" : "line-clamp-2"}`}
          >
            {scene.reasoning}
          </p>
        ) : (
          <p className="text-[11px] text-neutral-600 italic">
            No reasoning recorded. Use “Sharpen why” to generate one.
          </p>
        )}
      </Section>

      {/* AI actions — Haiku-powered, cheap, per-scene. */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-t border-neutral-800 bg-neutral-950/40">
        {AI_ACTIONS.map((action) => {
          const status = aiActionStatus?.[action.id] ?? "idle";
          const running = status === "running";
          return (
            <button
              key={action.id}
              type="button"
              onClick={() => handleAction(action.id)}
              disabled={running || !onAIAction}
              title={action.tooltip}
              className="h-6 px-2 rounded-md text-[10px] font-medium border border-neutral-800 bg-neutral-900 text-neutral-400 hover:text-neutral-100 hover:border-studio-accent/50 hover:bg-studio-accent/10 hover:text-studio-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {running ? "…" : "✨"} {action.label}
            </button>
          );
        })}
      </div>
    </article>
  );
});

// ── Internals ────────────────────────────────────────────────────────────────

function Header({
  sceneId,
  template,
  durationLabel,
  hook,
  index,
  startSeconds,
}: {
  sceneId: string;
  template: string;
  durationLabel: string;
  hook: boolean;
  index: number;
  startSeconds: number;
}): ReactNode {
  const startLabel = `${Math.floor(startSeconds / 60)}:${String(Math.floor(startSeconds % 60)).padStart(2, "0")}`;
  return (
    <header className="flex items-center gap-2 px-3 py-2 border-b border-neutral-800/80 bg-neutral-950/30">
      <span className="text-[10px] font-mono text-neutral-600 tabular-nums">
        #{String(index + 1).padStart(2, "0")}
      </span>
      <span className="text-[11px] font-mono text-neutral-300">{sceneId}</span>
      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium border border-studio-accent/30 bg-studio-accent/5 text-studio-accent">
        {template}
      </span>
      {hook && (
        <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-[0.18em] border border-amber-400/30 bg-amber-400/5 text-amber-300">
          hook
        </span>
      )}
      <div className="ml-auto flex items-center gap-2 text-[10px] text-neutral-500 tabular-nums">
        <span>@ {startLabel}</span>
        <span>·</span>
        <span>{durationLabel}</span>
      </div>
    </header>
  );
}

function Section({
  label,
  children,
  rightSlot,
  tone = "default",
}: {
  label: string;
  children: ReactNode;
  rightSlot?: ReactNode;
  tone?: "default" | "primary";
}): ReactNode {
  return (
    <div
      className={`px-3 py-2.5 border-b border-neutral-800/60 last:border-b-0 ${
        tone === "primary" ? "bg-neutral-900/30" : ""
      }`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[9px] uppercase tracking-[0.22em] font-semibold text-neutral-500">
          {label}
        </span>
        {rightSlot && <div className="flex items-center">{rightSlot}</div>}
      </div>
      {children}
    </div>
  );
}

function WordBudgetChip({
  status,
  count,
  budget,
}: {
  status: WordBudgetStatus;
  count: number;
  budget: number | null;
}): ReactNode {
  const tone = STATUS_TONE[status];
  return (
    <span
      className={`px-1.5 py-0.5 rounded text-[9px] tabular-nums border ${tone.tone}`}
      title={
        budget != null
          ? `${count} word${count === 1 ? "" : "s"} on screen / budget ${budget}`
          : "No budget configured for this template"
      }
    >
      {tone.label} {count}
      {budget != null ? `/${budget}` : ""} words
    </span>
  );
}

/**
 * Highlight the accent word in-place, case-insensitive, first match only. Keeps
 * the rest of the headline neutral so the eye lands on the accent at a glance.
 */
function HighlightAccent({ text, accent }: { text: string; accent: string }): ReactNode {
  const lowered = text.toLowerCase();
  const idx = lowered.indexOf(accent.toLowerCase());
  if (idx < 0) return text;
  const before = text.slice(0, idx);
  const matched = text.slice(idx, idx + accent.length);
  const after = text.slice(idx + accent.length);
  return (
    <>
      {before}
      <em className="not-italic font-semibold text-studio-accent">{matched}</em>
      {after}
    </>
  );
}
