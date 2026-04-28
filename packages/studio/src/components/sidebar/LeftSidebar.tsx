import { memo, useState, useCallback, type ReactNode } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import { CompositionsTab } from "./CompositionsTab";
import { AssetsTab } from "./AssetsTab";
import { VoicesTab } from "./VoicesTab";
import { ScriptTab } from "./ScriptTab";
import { ImagesTab } from "./ImagesTab";
import { StorylineTab } from "./StorylineTab";
import { FileTree } from "../editor/FileTree";

export type StudioMode = "direct" | "edit";
export type SidebarTab =
  | "storyline"
  | "compositions"
  | "assets"
  | "code"
  | "voices"
  | "script"
  | "images";

const STORAGE_KEY = "hf-studio-sidebar-tab";

/**
 * Tabs the user can see in each studio mode. "Direct" is the creative
 * cockpit — script, storyline, images, voices. "Edit" exposes the technical
 * surface (code, compositions, assets) on top. Storyline is the default in
 * Direct mode; Compositions is the default in Edit mode.
 */
const TABS_BY_MODE: Record<StudioMode, ReadonlyArray<SidebarTab>> = {
  direct: ["storyline", "script", "images", "voices"],
  edit: ["code", "compositions", "assets", "voices", "script", "images", "storyline"],
};

function getPersistedTab(mode: StudioMode): SidebarTab {
  const stored = localStorage.getItem(STORAGE_KEY) as SidebarTab | null;
  const allowed = TABS_BY_MODE[mode];
  if (stored && (allowed as readonly string[]).includes(stored)) return stored;
  return allowed[0] ?? "compositions";
}

interface LeftSidebarProps {
  width?: number;
  projectId: string;
  compositions: string[];
  assets: string[];
  activeComposition: string | null;
  onSelectComposition: (comp: string) => void;
  onImportFiles?: (files: FileList, dir?: string) => void;
  fileTree?: string[];
  editingFile?: { path: string; content: string | null } | null;
  onSelectFile?: (path: string) => void;
  onCreateFile?: (path: string) => void;
  onCreateFolder?: (path: string) => void;
  onDeleteFile?: (path: string) => void;
  onRenameFile?: (oldPath: string, newPath: string) => void;
  onDuplicateFile?: (path: string) => void;
  onMoveFile?: (oldPath: string, newPath: string) => void;
  codeChildren?: ReactNode;
  onLint?: () => void;
  linting?: boolean;
  /** Direct (creative) hides the technical tabs; Edit shows everything. */
  mode?: StudioMode;
  /**
   * When true, render the sidebar in a fullscreen-content layout: the tab
   * strip is sticky on top, content fills the rest, the ⤢ button becomes a
   * "↙ Restore" button. The sidebar at this point should also be wider —
   * App.tsx is responsible for stretching the parent container.
   */
  expanded?: boolean;
  /** Toggle between sidebar and expanded mode for the active tab. */
  onToggleExpand?: () => void;
  /** External tab forcing — App.tsx uses this to keep the sidebar's tab
   *  in sync with App-level state when the user expands/restores. */
  forceTab?: SidebarTab;
}

const TAB_LABELS: Record<SidebarTab, string> = {
  storyline: "Storyline",
  code: "Code",
  compositions: "Compositions",
  assets: "Assets",
  voices: "Voices",
  script: "Script",
  images: "Images",
};

export const LeftSidebar = memo(function LeftSidebar({
  width = 240,
  projectId,
  compositions,
  assets,
  activeComposition,
  onSelectComposition,
  onImportFiles,
  fileTree: fileProp,
  editingFile,
  onSelectFile,
  onCreateFile,
  onCreateFolder,
  onDeleteFile,
  onRenameFile,
  onDuplicateFile,
  onMoveFile,
  codeChildren,
  onLint,
  linting,
  mode = "edit",
  expanded = false,
  onToggleExpand,
  forceTab,
}: LeftSidebarProps) {
  const visibleTabs = TABS_BY_MODE[mode];
  const [tab, setTab] = useState<SidebarTab>(() => getPersistedTab(mode));

  // When App.tsx expands a tab and then collapses, it may want to bring the
  // sidebar's active tab in sync. We honour `forceTab` once per change.
  if (forceTab && forceTab !== tab && (visibleTabs as readonly string[]).includes(forceTab)) {
    Promise.resolve().then(() => setTab(forceTab));
  }

  // If the active tab isn't visible in the current mode, snap to the first
  // visible tab. Lets the user toggle modes without landing on a hidden view.
  if (!(visibleTabs as readonly string[]).includes(tab)) {
    const fallback = visibleTabs[0];
    if (fallback && fallback !== tab) {
      // Note: scheduling via Promise.resolve().then to avoid setState during render.
      Promise.resolve().then(() => setTab(fallback));
    }
  }

  const selectTab = useCallback((t: SidebarTab) => {
    setTab(t);
    localStorage.setItem(STORAGE_KEY, t);
  }, []);

  // Keyboard shortcuts: Cmd+1 for Compositions, Cmd+2 for Assets
  useMountEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      if (e.key === "1") {
        e.preventDefault();
        selectTab("compositions");
      }
      if (e.key === "2") {
        e.preventDefault();
        selectTab("assets");
      }
      if (e.key === "3") {
        e.preventDefault();
        selectTab("voices");
      }
      if (e.key === "4") {
        e.preventDefault();
        selectTab("script");
      }
      if (e.key === "5") {
        e.preventDefault();
        selectTab("images");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  return (
    <div
      className={`flex flex-col h-full bg-neutral-950 ${expanded ? "flex-1 border-r-0" : "border-r border-neutral-800/50"}`}
      style={expanded ? undefined : { width }}
    >
      {/* Tabs — visible set depends on the studio mode (Direct vs Edit).
          Right-most slot is the expand-to-fullscreen toggle. */}
      <div className="flex border-b border-neutral-800/50 flex-shrink-0">
        {visibleTabs.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => selectTab(t)}
            className={`flex-1 py-2 text-[11px] font-medium transition-colors ${
              tab === t
                ? "text-neutral-200 border-b-2 border-studio-accent"
                : "text-neutral-500 hover:text-neutral-400"
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
        {onToggleExpand && (
          <button
            type="button"
            onClick={onToggleExpand}
            title={expanded ? "Restore sidebar (Esc)" : `Expand ${TAB_LABELS[tab]} to full page`}
            aria-label={expanded ? "Restore sidebar" : "Expand tab to full page"}
            className="px-2 py-2 text-[12px] text-neutral-500 hover:text-studio-accent hover:bg-studio-accent/10 transition-colors border-l border-neutral-800/50"
          >
            {expanded ? "↙" : "⤢"}
          </button>
        )}
      </div>

      {/* Tab content */}
      {tab === "storyline" && <StorylineTab projectId={projectId} />}
      {tab === "compositions" && (
        <CompositionsTab
          projectId={projectId}
          compositions={compositions}
          activeComposition={activeComposition}
          onSelect={onSelectComposition}
        />
      )}
      {tab === "assets" && (
        <AssetsTab
          projectId={projectId}
          assets={assets}
          onImport={onImportFiles}
          onDelete={onDeleteFile}
          onRename={onRenameFile}
        />
      )}
      {tab === "voices" && <VoicesTab projectId={projectId} />}
      {tab === "script" && <ScriptTab projectId={projectId} />}
      {tab === "images" && <ImagesTab projectId={projectId} />}
      {tab === "code" && (
        <div className="flex flex-1 min-h-0">
          {(fileProp?.length ?? 0) > 0 && (
            <div className="w-[160px] flex-shrink-0 border-r border-neutral-800 overflow-y-auto">
              <FileTree
                files={fileProp ?? []}
                activeFile={editingFile?.path ?? null}
                onSelectFile={onSelectFile ?? (() => {})}
                onCreateFile={onCreateFile}
                onCreateFolder={onCreateFolder}
                onDeleteFile={onDeleteFile}
                onRenameFile={onRenameFile}
                onDuplicateFile={onDuplicateFile}
                onMoveFile={onMoveFile}
                onImportFiles={onImportFiles}
              />
            </div>
          )}
          <div className="flex-1 overflow-hidden min-w-0">
            {codeChildren ?? (
              <div className="flex items-center justify-center h-full text-neutral-600 text-sm">
                Select a file to edit
              </div>
            )}
          </div>
        </div>
      )}

      {/* Lint button pinned at the bottom */}
      {onLint && (
        <div className="border-t border-neutral-800 p-2 flex-shrink-0">
          <button
            onClick={onLint}
            disabled={linting}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-medium text-neutral-500 hover:text-amber-300 hover:bg-neutral-800 transition-colors disabled:opacity-40"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
            </svg>
            {linting ? "Linting…" : "Lint"}
          </button>
        </div>
      )}
    </div>
  );
});
