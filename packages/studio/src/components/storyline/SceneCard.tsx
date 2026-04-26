import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AudioWaveform } from "../../player/components/AudioWaveform";
import {
  auditWordBudget,
  extractDataPoints,
  getEditableHeadlineField,
  getEditableSubtextField,
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

export type AIActionId = "compress" | "suggestEmphasis" | "refineReasoning" | "rePickTemplate";

/**
 * One pending suggestion produced by a Haiku action. Rendered inline beneath
 * the action bar so the user can scan multiple proposals at once and apply
 * them à la carte. Each suggestion holds the partial-scene patch the apply
 * step PUTs to the existing /script/scenes/:id endpoint.
 */
export interface SceneSuggestion {
  id: string;
  action: AIActionId;
  preview: string;
  rationale: string;
  /** Partial scene fields the client merges into the existing scene on apply. */
  patch: { template?: string; props?: Record<string, unknown>; reasoning?: string };
}

interface SceneCardProps {
  scene: StorylineSceneInput;
  projectId: string;
  /** Index in the scene list. Drives the playback timecode label. */
  index: number;
  /** Cumulative seconds before this scene starts (for "@ 0:21" badge). */
  startSeconds: number;
  /** Total scene count — drives whether reorder buttons are enabled at edges. */
  totalScenes: number;
  /** Image-manifest dominant color, used to tint the image badge. Optional. */
  imageDominantColor?: string;
  /** Optional handler invoked when the user fires a Haiku action. */
  onAIAction?: (action: AIActionId, scene: StorylineSceneInput) => Promise<void> | void;
  /** Status per AI action, surfaced as a spinner / disabled state on the button. */
  aiActionStatus?: Partial<Record<AIActionId, "idle" | "running" | "error">>;
  /** Pending suggestions to render under the actions bar. */
  suggestions?: SceneSuggestion[];
  /** Apply a suggestion's patch — invoked when the user clicks "Apply". */
  onApplySuggestion?: (
    suggestion: SceneSuggestion,
    scene: StorylineSceneInput,
  ) => void | Promise<void>;
  /** Dismiss a suggestion without applying it. */
  onDismissSuggestion?: (suggestionId: string) => void;
  /** Move this scene up/down in the storyline. */
  onMove?: (sceneId: string, direction: "up" | "down") => void;
  /** Delete this scene. */
  onDelete?: (sceneId: string) => void;
  /** Insert a blank scene below this one. */
  onInsertAfter?: (sceneId: string) => void;
  /** Save an inline edit (headline / subtext / accent / words). */
  onInlineEdit?: (sceneId: string, field: string, value: string) => void | Promise<void>;
}

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
  totalScenes,
  imageDominantColor,
  onAIAction,
  aiActionStatus,
  suggestions,
  onApplySuggestion,
  onDismissSuggestion,
  onMove,
  onDelete,
  onInsertAfter,
  onInlineEdit,
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
        canMoveUp={index > 0}
        canMoveDown={index < totalScenes - 1}
        {...(onMove ? { onMove: (dir: "up" | "down") => onMove(scene.id, dir) } : {})}
        {...(onDelete ? { onDelete: () => onDelete(scene.id) } : {})}
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

      {/* Visual block — what shows on screen, with budget chip.
          Click any text field to edit it inline. Headline + subtext + accent
          are all click-to-edit; on blur, the change is saved via the same
          PUT pipeline as Haiku suggestions. Escape cancels. */}
      <Section
        label="On screen"
        rightSlot={
          <WordBudgetChip status={budget.status} count={budget.count} budget={budget.budget} />
        }
      >
        {headline !== null ? (
          <EditableText
            value={headline}
            multiline={true}
            placeholder="(empty)"
            disabled={!onInlineEdit}
            className="text-[13px] text-neutral-100 leading-snug font-medium"
            renderDisplay={(v) =>
              accent ? <HighlightAccent text={v} accent={accent} /> : <>{v}</>
            }
            onSave={(next) => {
              if (!onInlineEdit) return;
              const field =
                scene.template === "kinetic-words"
                  ? "words"
                  : (getEditableHeadlineField(scene.template) ?? "title");
              void onInlineEdit(scene.id, field, next);
            }}
          />
        ) : (
          <div className="text-[11px] text-neutral-600 italic">
            (Template emits visuals from script.text — no explicit headline.)
          </div>
        )}
        {(() => {
          const subtextField = getEditableSubtextField(scene.template);
          if (subtext) {
            return (
              <EditableText
                value={subtext}
                multiline={true}
                placeholder="(empty subtext)"
                disabled={!onInlineEdit || !subtextField}
                className="text-[11px] text-neutral-400 leading-relaxed mt-1.5"
                onSave={(next) => {
                  if (!onInlineEdit || !subtextField) return;
                  void onInlineEdit(scene.id, subtextField, next);
                }}
              />
            );
          }
          if (subtextField && onInlineEdit) {
            return (
              <EditableText
                value=""
                multiline={true}
                placeholder="+ add subtext"
                className="text-[11px] text-neutral-500 leading-relaxed mt-1.5 italic"
                onSave={(next) => {
                  if (!next.trim()) return;
                  void onInlineEdit(scene.id, subtextField, next);
                }}
              />
            );
          }
          return null;
        })()}
        {(() => {
          if (scene.template === "kinetic-words") return null;
          if (accent) {
            return (
              <div className="mt-2 inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[9px] uppercase tracking-[0.18em] border border-studio-accent/30 bg-studio-accent/5 text-studio-accent">
                accent ·
                <EditableText
                  value={accent}
                  placeholder=""
                  disabled={!onInlineEdit}
                  className="font-semibold normal-case tracking-normal text-[10px] text-studio-accent"
                  onSave={(next) => {
                    if (!onInlineEdit) return;
                    void onInlineEdit(scene.id, "accentWord", next.trim());
                  }}
                />
              </div>
            );
          }
          return null;
        })()}
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
      <div className="flex items-center gap-1.5 px-3 py-2 border-t border-neutral-800 bg-neutral-950/40 flex-wrap">
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
        {onInsertAfter && (
          <button
            type="button"
            onClick={() => onInsertAfter(scene.id)}
            className="ml-auto h-6 px-2 rounded-md text-[10px] font-medium border border-neutral-800 text-neutral-500 hover:text-neutral-200 hover:border-neutral-600 transition-colors"
            title="Insert a blank scene below this one"
          >
            + Insert below
          </button>
        )}
      </div>

      {/* Suggestion stack — pending Haiku proposals, applied à la carte. */}
      {suggestions && suggestions.length > 0 && (
        <div className="border-t border-studio-accent/30 bg-studio-accent/[0.03]">
          {suggestions.map((s) => (
            <SuggestionRow
              key={s.id}
              suggestion={s}
              {...(onApplySuggestion ? { onApply: () => onApplySuggestion(s, scene) } : {})}
              {...(onDismissSuggestion ? { onDismiss: () => onDismissSuggestion(s.id) } : {})}
            />
          ))}
        </div>
      )}
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
  canMoveUp,
  canMoveDown,
  onMove,
  onDelete,
}: {
  sceneId: string;
  template: string;
  durationLabel: string;
  hook: boolean;
  index: number;
  startSeconds: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove?: (direction: "up" | "down") => void;
  onDelete?: () => void;
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
      {(onMove || onDelete) && (
        <div className="flex items-center gap-0.5 ml-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {onMove && (
            <>
              <IconButton
                onClick={() => onMove("up")}
                disabled={!canMoveUp}
                title="Move scene up"
                aria-label={`Move scene ${sceneId} up`}
              >
                ▲
              </IconButton>
              <IconButton
                onClick={() => onMove("down")}
                disabled={!canMoveDown}
                title="Move scene down"
                aria-label={`Move scene ${sceneId} down`}
              >
                ▼
              </IconButton>
            </>
          )}
          {onDelete && (
            <IconButton
              onClick={onDelete}
              title="Delete this scene"
              aria-label={`Delete scene ${sceneId}`}
              tone="danger"
            >
              ✕
            </IconButton>
          )}
        </div>
      )}
    </header>
  );
}

function IconButton({
  children,
  onClick,
  disabled,
  title,
  tone = "neutral",
  ...rest
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  tone?: "neutral" | "danger";
  "aria-label"?: string;
}): ReactNode {
  const palette =
    tone === "danger"
      ? "text-neutral-500 hover:text-rose-400 hover:bg-rose-500/10"
      : "text-neutral-500 hover:text-neutral-200 hover:bg-neutral-800";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`w-5 h-5 flex items-center justify-center rounded text-[9px] font-mono transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${palette}`}
      {...rest}
    >
      {children}
    </button>
  );
}

function SuggestionRow({
  suggestion,
  onApply,
  onDismiss,
}: {
  suggestion: SceneSuggestion;
  onApply?: () => void;
  onDismiss?: () => void;
}): ReactNode {
  const labelByAction: Record<AIActionId, string> = {
    compress: "Compressed copy",
    suggestEmphasis: "Emphasis",
    refineReasoning: "Reasoning",
    rePickTemplate: "Alt template",
  };
  return (
    <div className="px-3 py-2 border-b border-studio-accent/20 last:border-b-0 flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[9px] uppercase tracking-[0.22em] font-semibold text-studio-accent">
            {labelByAction[suggestion.action]}
          </span>
          <span className="text-[9px] text-neutral-600">Haiku</span>
        </div>
        <div className="text-[12px] text-neutral-100 leading-snug font-medium">
          {suggestion.preview || <span className="italic text-neutral-500">(empty)</span>}
        </div>
        {suggestion.rationale && (
          <div className="text-[10px] text-neutral-500 leading-relaxed mt-1 italic">
            {suggestion.rationale}
          </div>
        )}
      </div>
      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        {onApply && (
          <button
            type="button"
            onClick={onApply}
            className="h-6 px-2.5 rounded-md text-[10px] font-semibold border border-studio-accent/50 bg-studio-accent/15 text-studio-accent hover:bg-studio-accent/25 transition-colors"
          >
            Apply
          </button>
        )}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="h-5 px-2 rounded text-[9px] text-neutral-500 hover:text-neutral-300 transition-colors"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
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

/**
 * Click-to-edit text field. Display mode: a span / div rendering
 * `renderDisplay(value)` (defaults to plain text). Click → input mode with
 * the cursor focused and the value selected. Blur saves; Escape cancels.
 *
 * Multiline option drives `<textarea>` vs `<input>`; useful for headlines and
 * subtexts that can wrap. The on-blur save is debounced via a refs trick:
 * if the user pressed Escape, we set `cancelledRef.current = true` and skip
 * the save in the blur handler that fires next.
 */
function EditableText({
  value,
  onSave,
  placeholder,
  disabled,
  className,
  multiline,
  renderDisplay,
}: {
  value: string;
  onSave: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  multiline?: boolean;
  renderDisplay?: (v: string) => ReactNode;
}): ReactNode {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const cancelledRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  if (disabled || !editing) {
    const displayContent =
      value.length > 0 ? (renderDisplay ? renderDisplay(value) : value) : (placeholder ?? "");
    const isEmpty = value.length === 0;
    return (
      <span
        role={disabled ? undefined : "button"}
        tabIndex={disabled ? undefined : 0}
        onClick={() => {
          if (!disabled) setEditing(true);
        }}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setEditing(true);
          }
        }}
        className={`${className ?? ""} ${
          disabled ? "" : "cursor-text rounded -mx-1 px-1 hover:bg-neutral-800/60 transition-colors"
        } ${isEmpty ? "italic" : ""} block`}
        title={disabled ? undefined : "Click to edit"}
      >
        {displayContent}
      </span>
    );
  }

  const commit = () => {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      setEditing(false);
      setDraft(value);
      return;
    }
    setEditing(false);
    if (draft !== value) onSave(draft);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cancelledRef.current = true;
      setEditing(false);
      setDraft(value);
      return;
    }
    if (e.key === "Enter" && !multiline) {
      e.preventDefault();
      commit();
      return;
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      commit();
    }
  };

  const sharedClass = `${className ?? ""} -mx-1 px-1 bg-neutral-950/70 border border-studio-accent/40 rounded outline-none focus:border-studio-accent w-full`;

  if (multiline) {
    return (
      <textarea
        ref={(el) => {
          inputRef.current = el;
        }}
        rows={Math.min(4, draft.split("\n").length + 1)}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        className={`${sharedClass} resize-none`}
        placeholder={placeholder}
      />
    );
  }
  return (
    <input
      ref={(el) => {
        inputRef.current = el;
      }}
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
      className={sharedClass}
      placeholder={placeholder}
    />
  );
}
