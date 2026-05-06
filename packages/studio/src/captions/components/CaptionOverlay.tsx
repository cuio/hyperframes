import { memo, useState, useCallback, useRef } from "react";
import { useCaptionStore } from "../store";
import { useMountEffect } from "../../hooks/useMountEffect";
import { shouldHandleCaptionNudgeKey } from "../keyboard";

interface CaptionOverlayProps {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
}

interface WordBox {
  segmentId: string;
  groupId: string;
  groupIndex: number;
  wordIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

function readWordBoxes(
  iframe: HTMLIFrameElement,
  model: {
    groupOrder: string[];
    groups: Map<string, { segmentIds: string[] }>;
  },
  overlayEl: HTMLElement,
): WordBox[] {
  let doc: Document | null = null;
  let win: Window | null = null;
  try {
    doc = iframe.contentDocument;
    win = iframe.contentWindow;
  } catch {
    return [];
  }
  if (!doc || !win) return [];

  const iframeDisplayRect = iframe.getBoundingClientRect();
  const overlayRect = overlayEl.getBoundingClientRect();
  // The iframe renders at native resolution (e.g. 1920x1080) but is
  // CSS-scaled to fit the viewport. getBoundingClientRect() on elements
  // inside the iframe returns coordinates in the iframe's native space.
  // Multiply by cssScale to convert to parent window coordinates.
  const nativeW = parseFloat(iframe.style.width) || iframeDisplayRect.width;
  const cssScale = iframeDisplayRect.width / nativeW;
  const offsetX = iframeDisplayRect.left - overlayRect.left;
  const offsetY = iframeDisplayRect.top - overlayRect.top;

  const groupEls = doc.querySelectorAll<HTMLElement>(".caption-group");
  const boxes: WordBox[] = [];

  for (let gi = 0; gi < model.groupOrder.length; gi++) {
    const groupId = model.groupOrder[gi];
    const group = model.groups.get(groupId);
    if (!group) continue;
    const groupEl = groupEls[gi] as HTMLElement | undefined;
    if (!groupEl) continue;
    const computed = win.getComputedStyle(groupEl);
    if (parseFloat(computed.opacity) <= 0.01 || computed.visibility === "hidden") continue;
    // Find word elements — handles both per-word spans (generator output)
    // and grouped text nodes (existing caption templates that use
    // el.textContent = line.text instead of individual word spans).
    const resolvedWordEls: HTMLElement[] = [];
    for (const child of groupEl.children) {
      const c = child as HTMLElement;
      if (c.dataset.captionWrapper === "true") {
        const inner = c.querySelector<HTMLElement>(":scope > span");
        if (inner) resolvedWordEls.push(inner);
      } else if (c.tagName === "SPAN") {
        resolvedWordEls.push(c);
      }
    }
    // Fallback: if no word spans found but group has text content,
    // the template uses grouped text. Wrap each word in a span so
    // the overlay can target them individually.
    if (resolvedWordEls.length === 0 && groupEl.textContent?.trim()) {
      const textNode = groupEl.childNodes[0];
      if (textNode && textNode.nodeType === Node.TEXT_NODE) {
        const words = (textNode.textContent || "").split(/\s+/).filter(Boolean);
        const frag = doc.createDocumentFragment();
        for (const word of words) {
          const span = doc.createElement("span");
          span.textContent = word + " ";
          span.style.display = "inline";
          frag.appendChild(span);
          resolvedWordEls.push(span);
        }
        groupEl.replaceChild(frag, textNode);
      } else {
        // Single span child with all text (e.g. vignelli template)
        const singleSpan = groupEl.querySelector<HTMLElement>(":scope > span");
        if (singleSpan && singleSpan.textContent?.trim()) {
          const words = singleSpan.textContent.split(/\s+/).filter(Boolean);
          const frag = doc.createDocumentFragment();
          for (const word of words) {
            const span = doc.createElement("span");
            span.textContent = word + " ";
            span.style.display = "inline";
            frag.appendChild(span);
            resolvedWordEls.push(span);
          }
          singleSpan.replaceWith(frag);
        }
      }
    }
    for (let wi = 0; wi < group.segmentIds.length; wi++) {
      const segId = group.segmentIds[wi];
      const wordEl = resolvedWordEls[wi] as HTMLElement | undefined;
      if (!wordEl) continue;
      const rect = wordEl.getBoundingClientRect();
      boxes.push({
        segmentId: segId,
        groupId,
        groupIndex: gi,
        wordIndex: wi,
        x: rect.left * cssScale + offsetX,
        y: rect.top * cssScale + offsetY,
        width: rect.width * cssScale,
        height: rect.height * cssScale,
      });
    }
  }
  return boxes;
}

function getWordEl(
  iframe: HTMLIFrameElement,
  groupIndex: number,
  wordIndex: number,
): HTMLElement | null {
  let doc: Document | null = null;
  try {
    doc = iframe.contentDocument;
  } catch {
    return null;
  }
  if (!doc) return null;
  const groupEl = doc.querySelectorAll<HTMLElement>(".caption-group")[groupIndex];
  if (!groupEl) return null;
  // Find word spans — they may be direct children or inside wrapper spans.
  // Word spans have class "word" or an id starting with "w".
  // Wrappers have data-caption-wrapper="true".
  const wordEls: HTMLElement[] = [];
  for (const child of groupEl.children) {
    const el = child as HTMLElement;
    if (el.dataset.captionWrapper === "true") {
      // Wrapped word — get the inner span
      const inner = el.querySelector<HTMLElement>(":scope > span");
      if (inner) wordEls.push(inner);
    } else if (el.tagName === "SPAN") {
      wordEls.push(el);
    }
  }
  return wordEls[wordIndex] ?? null;
}

/**
 * Read GSAP's internal transform state for an element.
 * GSAP stores transforms in its own cache, not in el.style.transform.
 */
function readGsapTransform(
  el: HTMLElement,
  iframeWin: Window,
): { x: number; y: number; scale: number; rotation: number } {
  const gsap = (
    iframeWin as unknown as { gsap?: { getProperty?: (el: HTMLElement, prop: string) => number } }
  ).gsap;
  if (gsap && gsap.getProperty) {
    return {
      x: gsap.getProperty(el, "x") || 0,
      y: gsap.getProperty(el, "y") || 0,
      scale: gsap.getProperty(el, "scale") || 1,
      rotation: gsap.getProperty(el, "rotation") || 0,
    };
  }
  // Fallback: parse from style
  const t = el.style.transform || "";
  const scaleMatch = t.match(/scale\(([^)]+)\)/);
  const rotMatch = t.match(/rotate\(([^)]+)deg\)/);
  const txyMatch = t.match(/translate\(([^,]+)px,\s*([^)]+)px\)/);
  return {
    x: txyMatch ? parseFloat(txyMatch[1]) : 0,
    y: txyMatch ? parseFloat(txyMatch[2]) : 0,
    scale: scaleMatch ? parseFloat(scaleMatch[1]) : 1,
    rotation: rotMatch ? parseFloat(rotMatch[1]) : 0,
  };
}

/**
 * Get or create an inline-block wrapper span around a word element.
 * Transforms are applied to the wrapper so the word's GSAP animations are preserved.
 */
function getOrCreateWrapper(el: HTMLElement): HTMLElement {
  // If el IS a wrapper, return it
  if (el.dataset.captionWrapper === "true") return el;
  // If el's parent is a wrapper, return the parent
  const parent = el.parentElement;
  if (parent && parent.dataset.captionWrapper === "true") return parent;
  // Create new wrapper
  const doc = el.ownerDocument;
  const wrapper = doc.createElement("span");
  wrapper.style.display = "inline-block";
  wrapper.dataset.captionWrapper = "true";
  el.parentNode?.insertBefore(wrapper, el);
  wrapper.appendChild(el);
  return wrapper;
}

/**
 * Write transform values to a wrapper span around the word element.
 * The word keeps its GSAP animations; the wrapper handles editor transforms.
 */
function writeTransform(
  el: HTMLElement,
  iframeWin: Window,
  x: number,
  y: number,
  scale: number,
  rotation: number,
) {
  const wrapper = getOrCreateWrapper(el);
  const gsap = (
    iframeWin as unknown as {
      gsap?: { set?: (el: HTMLElement, props: Record<string, number>) => void };
    }
  ).gsap;
  if (gsap && gsap.set) {
    gsap.set(wrapper, { x, y, scale, rotation });
  } else {
    wrapper.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${rotation.toFixed(1)}deg) scale(${scale.toFixed(3)})`;
  }
}

/** Sync canvas state back to the Zustand store so the property panel reflects it.
 *  Only writes non-default values to avoid creating spurious overrides. */
function syncToStore(segmentId: string, el: HTMLElement, iframeWin: Window) {
  const wrapper = getOrCreateWrapper(el);
  const { x, y, scale, rotation } = readGsapTransform(wrapper, iframeWin);
  const style: Record<string, number> = {};
  if (Math.abs(x) > 0.5) style.x = x;
  if (Math.abs(y) > 0.5) style.y = y;
  if (Math.abs(scale - 1) > 0.001) {
    style.scaleX = scale;
    style.scaleY = scale;
  }
  if (Math.abs(rotation) > 0.1) style.rotation = rotation;
  if (Object.keys(style).length > 0) {
    useCaptionStore.getState().updateSegmentStyle(segmentId, style);
  }
}

const HANDLE = 8;
const ROTATION_OFFSET = 20; // px above the selection box

export const CaptionOverlay = memo(function CaptionOverlay({ iframeRef }: CaptionOverlayProps) {
  const isEditMode = useCaptionStore((s) => s.isEditMode);
  const model = useCaptionStore((s) => s.model);
  const selectedSegmentIds = useCaptionStore((s) => s.selectedSegmentIds);
  const selectSegment = useCaptionStore((s) => s.selectSegment);
  const clearSelection = useCaptionStore((s) => s.clearSelection);

  const [wordBoxes, setWordBoxes] = useState<WordBox[]>([]);
  const overlayRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef(model);
  modelRef.current = model;

  // Interaction mode — only one active at a time
  const interactionRef = useRef<
    | {
        type: "move";
        wordEl: HTMLElement;
        segmentId: string;
        startMX: number;
        startMY: number;
        origTX: number;
        origTY: number;
        origScale: number;
        origRotation: number;
      }
    | {
        type: "scale";
        wordEl: HTMLElement;
        segmentId: string;
        startMX: number;
        startDxFromCenter: number;
        origTX: number;
        origTY: number;
        origScale: number;
        origRotation: number;
      }
    | {
        type: "rotate";
        wordEl: HTMLElement;
        segmentId: string;
        startMX: number;
        origTX: number;
        origTY: number;
        origRotation: number;
        origScale: number;
      }
    | null
  >(null);

  useMountEffect(() => {
    if (!isEditMode) return;
    let prevBoxes: WordBox[] = [];
    const tick = () => {
      const iframe = iframeRef.current;
      const m = modelRef.current;
      const overlay = overlayRef.current;
      if (!iframe || !m || !overlay) return;
      const next = readWordBoxes(iframe, m, overlay);
      // Skip state update if nothing changed (avoids re-render every 66ms)
      if (
        next.length === prevBoxes.length &&
        next.every(
          (b, i) => Math.abs(b.x - prevBoxes[i].x) < 0.5 && Math.abs(b.y - prevBoxes[i].y) < 0.5,
        )
      )
        return;
      prevBoxes = next;
      setWordBoxes(next);
    };
    const id = setInterval(tick, 66);
    tick();

    // Arrow key nudge for selected words
    const handleKeyDown = (e: KeyboardEvent) => {
      const { selectedSegmentIds: sel, model: m } = useCaptionStore.getState();
      if (sel.size === 0 || !m) return;
      const arrow = e.key;
      if (!shouldHandleCaptionNudgeKey(e)) return;

      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = arrow === "ArrowLeft" ? -step : arrow === "ArrowRight" ? step : 0;
      const dy = arrow === "ArrowUp" ? -step : arrow === "ArrowDown" ? step : 0;

      const iframe = iframeRef.current;
      const win = iframe?.contentWindow;
      if (!iframe || !win) return;

      for (const segId of sel) {
        // Find group/word index for this segment
        for (let gi = 0; gi < m.groupOrder.length; gi++) {
          const group = m.groups.get(m.groupOrder[gi]);
          if (!group) continue;
          const wi = group.segmentIds.indexOf(segId);
          if (wi < 0) continue;
          const wordEl = getWordEl(iframe, gi, wi);
          if (!wordEl) continue;
          const wrapper = getOrCreateWrapper(wordEl);
          const state = readGsapTransform(wrapper, win);
          writeTransform(wordEl, win, state.x + dx, state.y + dy, state.scale, state.rotation);
          syncToStore(segId, wordEl, win);
          break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      clearInterval(id);
      window.removeEventListener("keydown", handleKeyDown);
    };
  });

  const getCssScale = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return 1;
    const rect = iframe.getBoundingClientRect();
    const nativeW = parseFloat(iframe.style.width) || rect.width;
    return rect.width / nativeW;
  }, [iframeRef]);

  // --- Move ---
  const startMove = useCallback(
    (groupIndex: number, wordIndex: number, segmentId: string, e: React.PointerEvent) => {
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const iframe = iframeRef.current;
      if (!iframe) return;
      const wordEl = getWordEl(iframe, groupIndex, wordIndex);
      const win = iframe.contentWindow;
      if (!wordEl || !win) return;
      const state = readGsapTransform(getOrCreateWrapper(wordEl), win);
      interactionRef.current = {
        type: "move",
        wordEl,
        segmentId,
        startMX: e.clientX,
        startMY: e.clientY,
        origTX: state.x,
        origTY: state.y,
        origScale: state.scale,
        origRotation: state.rotation,
      };
    },
    [iframeRef],
  );

  // --- Scale ---
  const startScale = useCallback(
    (groupIndex: number, wordIndex: number, segmentId: string, e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const iframe = iframeRef.current;
      if (!iframe) return;
      const wordEl = getWordEl(iframe, groupIndex, wordIndex);
      const win = iframe.contentWindow;
      if (!wordEl || !win) return;
      const rect = wordEl.getBoundingClientRect();
      const cssScale = getCssScale();
      const boxCenterX =
        rect.left * cssScale +
        (iframeRef.current?.getBoundingClientRect().left ?? 0) +
        (rect.width * cssScale) / 2;
      const state = readGsapTransform(getOrCreateWrapper(wordEl), win);
      interactionRef.current = {
        type: "scale",
        wordEl,
        segmentId,
        startMX: e.clientX,
        startDxFromCenter: e.clientX - boxCenterX,
        origTX: state.x,
        origTY: state.y,
        origScale: state.scale,
        origRotation: state.rotation,
      };
    },
    [iframeRef, getCssScale],
  );

  // --- Rotate ---
  const startRotate = useCallback(
    (box: WordBox, e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const iframe = iframeRef.current;
      if (!iframe) return;
      const wordEl = getWordEl(iframe, box.groupIndex, box.wordIndex);
      const win = iframe.contentWindow;
      if (!wordEl || !win) return;
      const state = readGsapTransform(getOrCreateWrapper(wordEl), win);
      interactionRef.current = {
        type: "rotate",
        wordEl,
        segmentId: box.segmentId,
        startMX: e.clientX,
        origTX: state.x,
        origTY: state.y,
        origRotation: state.rotation,
        origScale: state.scale,
      };
    },
    [iframeRef],
  );

  /** Get iframe contentWindow, needed for gsap calls */
  const getIframeWin = useCallback((): Window | null => {
    try {
      return iframeRef.current?.contentWindow ?? null;
    } catch {
      return null;
    }
  }, [iframeRef]);

  // --- Unified pointer move ---
  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const i = interactionRef.current;
      if (!i) return;
      const win = getIframeWin();
      if (!win) return;

      if (i.type === "move") {
        const cssScale = getCssScale();
        const dx = (e.clientX - i.startMX) / cssScale;
        const dy = (e.clientY - i.startMY) / cssScale;
        writeTransform(i.wordEl, win, i.origTX + dx, i.origTY + dy, i.origScale, i.origRotation);
      } else if (i.type === "scale") {
        // Use distance from box center so dragging outward from ANY corner
        // increases scale (not just right-side handles).
        const cx = i.startMX - i.startDxFromCenter;
        const startDist = Math.abs(i.startDxFromCenter);
        const currentDist = Math.abs(e.clientX - cx);
        const factor = startDist > 5 ? currentDist / startDist : 1;
        const newScale = Math.max(0.1, i.origScale * factor);
        writeTransform(i.wordEl, win, i.origTX, i.origTY, newScale, i.origRotation);
      } else if (i.type === "rotate") {
        // Horizontal drag maps to rotation: right = clockwise, left = counter-clockwise.
        // 200px of horizontal movement = 90 degrees.
        const dx = e.clientX - i.startMX;
        const delta = (dx / 200) * 90;
        writeTransform(i.wordEl, win, i.origTX, i.origTY, i.origScale, i.origRotation + delta);
      }
    },
    [getCssScale, getIframeWin],
  );

  // --- Unified pointer up — sync back to store ---
  const handlePointerUp = useCallback(() => {
    const i = interactionRef.current;
    if (i) {
      const win = getIframeWin();
      if (win) syncToStore(i.segmentId, i.wordEl, win);
      interactionRef.current = null;
    }
  }, [getIframeWin]);

  const handleBackgroundClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) clearSelection();
    },
    [clearSelection],
  );

  if (!isEditMode) return null;

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 z-50"
      style={{ pointerEvents: "auto" }}
      onClick={handleBackgroundClick}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onLostPointerCapture={handlePointerUp}
    >
      {wordBoxes.map((box) => {
        const isSelected = selectedSegmentIds.has(box.segmentId);
        return (
          <div
            key={box.segmentId}
            className={[
              "absolute",
              isSelected ? "ring-2 ring-studio-accent" : "hover:ring-1 hover:ring-white/30",
            ].join(" ")}
            style={{
              left: box.x,
              top: box.y,
              width: box.width,
              height: box.height,
              cursor: isSelected ? "move" : "pointer",
              touchAction: "none",
              borderRadius: 2,
            }}
            onClick={(e) => {
              e.stopPropagation();
              selectSegment(box.segmentId, e.shiftKey);
            }}
            onPointerDown={(e) => {
              if (isSelected) startMove(box.groupIndex, box.wordIndex, box.segmentId, e);
            }}
          >
            {isSelected && (
              <>
                {/* Rotation handle — circle above the box */}
                <div
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: -ROTATION_OFFSET - HANDLE,
                    marginLeft: -HANDLE / 2,
                    width: HANDLE,
                    height: HANDLE,
                    borderRadius: "50%",
                    backgroundColor: "var(--hf-accent, #3CE6AC)",
                    border: "1px solid rgba(0,0,0,0.5)",
                    cursor: "grab",
                    touchAction: "none",
                  }}
                  onPointerDown={(e) => startRotate(box, e)}
                />
                {/* Line from box to rotation handle */}
                <div
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: -ROTATION_OFFSET,
                    width: 1,
                    height: ROTATION_OFFSET,
                    marginLeft: -0.5,
                    backgroundColor: "var(--hf-accent, #3CE6AC)",
                    opacity: 0.5,
                    pointerEvents: "none",
                  }}
                />
                {/* Scale handles — four corners */}
                {[
                  { right: -HANDLE / 2, bottom: -HANDLE / 2, cursor: "nwse-resize" },
                  { left: -HANDLE / 2, top: -HANDLE / 2, cursor: "nwse-resize" },
                  { right: -HANDLE / 2, top: -HANDLE / 2, cursor: "nesw-resize" },
                  { left: -HANDLE / 2, bottom: -HANDLE / 2, cursor: "nesw-resize" },
                ].map((pos, idx) => (
                  <div
                    key={idx}
                    style={{
                      position: "absolute",
                      ...pos,
                      width: HANDLE,
                      height: HANDLE,
                      backgroundColor: "var(--hf-accent, #3CE6AC)",
                      border: "1px solid rgba(0,0,0,0.5)",
                      borderRadius: 2,
                      touchAction: "none",
                    }}
                    onPointerDown={(e) =>
                      startScale(box.groupIndex, box.wordIndex, box.segmentId, e)
                    }
                  />
                ))}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
});
