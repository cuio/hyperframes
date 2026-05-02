import type { ChartDef } from "./types.js";
import { escapeHtml, asString, asStringArray } from "../templates/util.js";
import {
  niceCeiling,
  niceTicks,
  formatValue,
  renderGridlines,
  renderAnnotation,
  type ValueFormat,
} from "./util.js";

/**
 * Built-in chart library — based on the HackerNoon investigation chart sheet.
 * Every chart is pure SVG, theme-token aware, and animated via inline CSS or
 * GSAP timelines registered later by the parent template script.
 *
 * Each ChartDef stays small — it returns just the SVG. The wrapping template
 * (chart-scene) supplies title, source line, and watermark, plus drives the
 * GSAP entrance for the chart elements.
 */

interface BarItem {
  label: string;
  value: number;
  color?: "primary" | "secondary" | "tertiary" | "muted";
  display?: string;
}

function asBarItems(v: unknown): BarItem[] {
  if (!Array.isArray(v)) return [];
  const out: BarItem[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const obj = raw as Record<string, unknown>;
    const value = Number(obj.value);
    if (!Number.isFinite(value)) continue;
    const colorRaw = asString(obj.color).toLowerCase();
    const color: BarItem["color"] =
      colorRaw === "primary" ||
      colorRaw === "secondary" ||
      colorRaw === "tertiary" ||
      colorRaw === "muted"
        ? colorRaw
        : undefined;
    const display = asString(obj.display);
    const item: BarItem = { label: asString(obj.label), value };
    if (color) item.color = color;
    if (display) item.display = display;
    out.push(item);
  }
  return out;
}

function pickColor(
  role: BarItem["color"],
  tokens: import("../templates/types.js").DesignTokens,
): string {
  if (role === "secondary") return tokens.colors.accent2;
  if (role === "tertiary") return tokens.colors.accent3;
  if (role === "muted") return tokens.colors.muted;
  return tokens.colors.accent;
}

const PROPORTIONAL_BARS: ChartDef = {
  id: "proportional-bars",
  description:
    "Horizontal bars scaled to data, value labels at end. Best for ranked categories where the magnitude difference matters.",
  whenToUse: [
    "Ranking categories by a scalar (revenue, cost, market cap)",
    "Showing scale contrast between top and bottom items",
    "When you have 3–7 labeled values to compare",
  ],
  propsSchema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        minItems: 2,
        maxItems: 8,
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            value: { type: "number" },
            display: { type: "string", description: "Pretty value text, e.g. '$5.8bn'" },
            color: {
              type: "string",
              enum: ["primary", "secondary", "tertiary", "muted"],
              description:
                "primary = highlight (accent), secondary = supporting (accent2), tertiary = warning (accent3), muted = grey",
            },
          },
          required: ["label", "value"],
        },
      },
    },
    required: ["items"],
  },
  render(props, ctx) {
    const items = asBarItems(props.items);
    if (items.length === 0) return "";
    const t = ctx.tokens;
    const w = ctx.width;
    const h = ctx.height;
    const labelGutter = 280;
    const valueGutter = 140;
    const rowH = (h - 60) / items.length;
    const barH = Math.min(48, rowH * 0.6);
    const trackW = w - labelGutter - valueGutter;
    const max = Math.max(...items.map((i) => i.value));
    const safeMax = max > 0 ? max : 1;
    return `
<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" class="hf-chart" style="width:100%;height:100%;font-family:${t.fonts.display};">
  ${items
    .map((item, i) => {
      const y = 30 + i * rowH;
      const cy = y + (rowH - barH) / 2;
      const barW = (item.value / safeMax) * trackW;
      const color = pickColor(item.color, t);
      const display = item.display || String(item.value);
      const labelColor = t.colors.fg;
      return `
  <text x="${labelGutter - 24}" y="${cy + barH / 2 + 8}" text-anchor="end" font-size="22" fill="${labelColor}" style="font-weight:400">${escapeHtml(item.label)}</text>
  <rect class="hf-bar hf-bar-${i}" x="${labelGutter}" y="${cy}" width="0" data-target-w="${barW.toFixed(1)}" height="${barH}" rx="0" fill="${color}" />
  <text class="hf-bar-val hf-bar-val-${i}" x="${labelGutter + barW + 16}" y="${cy + barH / 2 + 8}" font-size="24" font-weight="700" fill="${t.colors.fg}" opacity="0">${escapeHtml(display)}</text>`;
    })
    .join("\n  ")}
  <line x1="${labelGutter}" y1="${h - 14}" x2="${w - valueGutter}" y2="${h - 14}" stroke="${t.colors.subtle}" stroke-width="1" />
</svg>`.trim();
  },
};

const WATERFALL_BARS: ChartDef = {
  id: "waterfall-bars",
  description:
    "Vertical bars from tallest to shortest, value labels above each. Best for showing magnitude dropoff.",
  whenToUse: [
    "Sorted descending bars where the falloff is the story",
    "Comparing 3–6 values in a hierarchy",
  ],
  propsSchema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        minItems: 2,
        maxItems: 6,
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            value: { type: "number" },
            display: { type: "string" },
            color: { type: "string", enum: ["primary", "secondary", "tertiary", "muted"] },
          },
          required: ["label", "value"],
        },
      },
    },
    required: ["items"],
  },
  render(props, ctx) {
    const items = asBarItems(props.items);
    if (items.length === 0) return "";
    const t = ctx.tokens;
    const w = ctx.width;
    const h = ctx.height;
    const padX = 80;
    const padTop = 80;
    const padBottom = 100;
    const trackH = h - padTop - padBottom;
    const colW = (w - padX * 2) / items.length;
    const barW = Math.min(140, colW * 0.6);
    const max = Math.max(...items.map((i) => i.value));
    const safeMax = max > 0 ? max : 1;
    return `
<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" class="hf-chart" style="width:100%;height:100%;font-family:${t.fonts.display};">
  ${items
    .map((item, i) => {
      const cx = padX + colW * i + colW / 2;
      const barH = (item.value / safeMax) * trackH;
      const top = padTop + (trackH - barH);
      const color = pickColor(item.color, t);
      const display = item.display || String(item.value);
      return `
  <rect class="hf-bar hf-bar-${i}" x="${(cx - barW / 2).toFixed(1)}" y="${(padTop + trackH).toFixed(1)}" width="${barW}" data-target-y="${top.toFixed(1)}" data-target-h="${barH.toFixed(1)}" height="0" rx="0" fill="${color}" />
  <text class="hf-bar-val hf-bar-val-${i}" x="${cx}" y="${(top - 18).toFixed(1)}" text-anchor="middle" font-size="26" font-weight="700" fill="${color}" opacity="0">${escapeHtml(display)}</text>
  <text x="${cx}" y="${(padTop + trackH + 36).toFixed(1)}" text-anchor="middle" font-size="22" fill="${t.colors.fg}">${escapeHtml(item.label)}</text>`;
    })
    .join("\n  ")}
  <line x1="${padX}" y1="${(padTop + trackH).toFixed(1)}" x2="${(w - padX).toFixed(1)}" y2="${(padTop + trackH).toFixed(1)}" stroke="${t.colors.fg}" stroke-width="1.5" />
</svg>`.trim();
  },
};

const CLIFF_CHART: ChartDef = {
  id: "cliff-chart",
  description:
    "Rise line + crash line meeting at peak with a callout. Best for boom-bust or peak-and-decline narratives.",
  whenToUse: [
    "An asset/metric peaked then crashed",
    "Showing a clear apex with magnitude of the drop",
  ],
  propsSchema: {
    type: "object",
    properties: {
      peakLabel: { type: "string", description: "Peak value, e.g. '$555B'" },
      dropPercentage: { type: "number", description: "How far it crashed, e.g. 88 for −88%" },
      xLabels: {
        type: "array",
        items: { type: "string" },
        description: "3–6 x-axis tick labels",
      },
    },
    required: ["peakLabel"],
  },
  render(props, ctx) {
    const t = ctx.tokens;
    const w = ctx.width;
    const h = ctx.height;
    const peakLabel = asString(props.peakLabel);
    const drop = Number(props.dropPercentage);
    const dropDisplay = Number.isFinite(drop) ? `−${Math.abs(Math.round(drop))}%` : "";
    const labels = asStringArray(props.xLabels);
    const padX = 100;
    const padY = 80;
    const peakX = w * 0.45;
    const peakY = padY + 20;
    const startX = padX;
    const startY = h - padY;
    const endX = w - padX;
    const endY = h - padY - 30;
    const riseColor = t.colors.accent3;
    const crashColor = t.colors.accent;
    return `
<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" class="hf-chart" style="width:100%;height:100%;font-family:${t.fonts.display};">
  <line x1="${padX}" y1="${h - padY}" x2="${w - padX}" y2="${h - padY}" stroke="${t.colors.subtle}" stroke-width="1.5" />
  <path d="M ${startX} ${startY} Q ${(startX + peakX) / 2} ${(startY + peakY) / 2 - 30} ${peakX} ${peakY} L ${peakX} ${startY} L ${startX} ${startY} Z" fill="${riseColor}" opacity="0.18" />
  <path d="M ${peakX} ${peakY} Q ${(peakX + endX) / 2} ${peakY + 100} ${endX} ${endY} L ${endX} ${startY} L ${peakX} ${startY} Z" fill="${crashColor}" opacity="0.18" />
  <path class="hf-rise" d="M ${startX} ${startY} Q ${(startX + peakX) / 2} ${(startY + peakY) / 2 - 30} ${peakX} ${peakY}" fill="none" stroke="${riseColor}" stroke-width="4" stroke-linecap="round" stroke-dasharray="800" stroke-dashoffset="800" />
  <path class="hf-crash" d="M ${peakX} ${peakY} Q ${(peakX + endX) / 2} ${peakY + 100} ${endX} ${endY}" fill="none" stroke="${crashColor}" stroke-width="4" stroke-linecap="round" stroke-dasharray="800" stroke-dashoffset="800" />
  <circle class="hf-peak" cx="${peakX}" cy="${peakY}" r="0" data-target-r="10" fill="${crashColor}" />
  <text class="hf-peak-label" x="${peakX}" y="${peakY - 24}" text-anchor="middle" font-size="28" font-weight="700" fill="${crashColor}" opacity="0">${escapeHtml(peakLabel)}</text>
  ${
    dropDisplay
      ? `<g class="hf-drop-badge" opacity="0" transform="translate(${(peakX + endX) / 2 - 50}, ${peakY + 60})"><rect width="100" height="44" rx="6" fill="${crashColor}"/><text x="50" y="29" text-anchor="middle" font-size="22" font-weight="700" fill="white">${escapeHtml(dropDisplay)}</text></g>`
      : ""
  }
  ${labels
    .map((label, i, arr) => {
      const x = padX + ((w - padX * 2) * i) / Math.max(arr.length - 1, 1);
      return `<text x="${x.toFixed(1)}" y="${h - padY + 38}" text-anchor="middle" font-size="20" fill="${t.colors.muted}">${escapeHtml(label)}</text>`;
    })
    .join("\n  ")}
</svg>`.trim();
  },
};

const DONUT_RING: ChartDef = {
  id: "donut-ring",
  description: "Circular ring with partial fill showing a single ratio. Counter animates inside.",
  whenToUse: [
    "A single percentage or ratio is the story",
    "Highlighting a small, surprising fraction",
  ],
  propsSchema: {
    type: "object",
    properties: {
      percent: { type: "number", description: "Fill percentage 0–100" },
      centerValue: { type: "string", description: "Big text in the middle, e.g. '5.3%'" },
      centerCaption: { type: "string", description: "Small caption beneath, e.g. 'returned'" },
    },
    required: ["percent", "centerValue"],
  },
  render(props, ctx) {
    const t = ctx.tokens;
    const w = ctx.width;
    const h = ctx.height;
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) * 0.32;
    const stroke = Math.max(20, r * 0.18);
    const circumference = 2 * Math.PI * r;
    const percent = Math.max(0, Math.min(100, Number(props.percent) || 0));
    const fillLen = (circumference * percent) / 100;
    const centerValue = asString(props.centerValue);
    const centerCaption = asString(props.centerCaption);
    return `
<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" class="hf-chart" style="width:100%;height:100%;font-family:${t.fonts.display};">
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${t.colors.subtle}" stroke-width="${stroke}" opacity="0.6" />
  <circle class="hf-ring" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${t.colors.accent}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${fillLen.toFixed(1)} ${circumference.toFixed(1)}" stroke-dashoffset="${circumference.toFixed(1)}" data-target-offset="0" transform="rotate(-90 ${cx} ${cy})" />
  <text class="hf-center-value" x="${cx}" y="${cy + 6}" text-anchor="middle" font-size="${r * 0.7}" font-weight="700" fill="${t.colors.accent}" opacity="0">${escapeHtml(centerValue)}</text>
  ${
    centerCaption
      ? `<text class="hf-center-caption" x="${cx}" y="${cy + r * 0.55}" text-anchor="middle" font-size="${r * 0.18}" fill="${t.colors.muted}" opacity="0">${escapeHtml(centerCaption)}</text>`
      : ""
  }
</svg>`.trim();
  },
};

const WAFFLE_GRID: ChartDef = {
  id: "waffle-grid",
  description: "10×10 grid where filled cells = percentage. Staggered cell reveal.",
  whenToUse: [
    "Communicating a percentage as a fraction-of-100 visual",
    "When the human-scale of a small percent is the point",
  ],
  propsSchema: {
    type: "object",
    properties: {
      percent: { type: "number", description: "Percentage filled 0–100" },
      filledLabel: { type: "string", description: "Legend for filled cells" },
      emptyLabel: { type: "string", description: "Legend for empty cells" },
    },
    required: ["percent"],
  },
  render(props, ctx) {
    const t = ctx.tokens;
    const w = ctx.width;
    const h = ctx.height;
    const percent = Math.max(0, Math.min(100, Number(props.percent) || 0));
    const filledCount = Math.round(percent);
    const filledLabel = asString(props.filledLabel) || "filled";
    const emptyLabel = asString(props.emptyLabel) || "empty";
    const cell = Math.min((w - 200) / 10, (h - 200) / 10);
    const gap = cell * 0.12;
    const gridSize = (cell + gap) * 10 - gap;
    const startX = (w - gridSize) / 2;
    const startY = (h - gridSize) / 2 - 20;
    const cells: string[] = [];
    for (let i = 0; i < 100; i++) {
      const col = i % 10;
      const row = Math.floor(i / 10);
      const x = startX + col * (cell + gap);
      const y = startY + row * (cell + gap);
      const isFilled = i < filledCount;
      const fill = isFilled ? t.colors.accent : t.colors.subtle;
      const opacity = isFilled ? 1 : 0.5;
      cells.push(
        `<rect class="hf-cell" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cell.toFixed(1)}" height="${cell.toFixed(1)}" rx="${(cell * 0.1).toFixed(1)}" fill="${fill}" opacity="0" data-target-opacity="${opacity}" data-cell-index="${i}" />`,
      );
    }
    return `
<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" class="hf-chart" style="width:100%;height:100%;font-family:${t.fonts.display};">
  ${cells.join("\n  ")}
  <text x="${(startX + gridSize / 2 - 80).toFixed(1)}" y="${(startY + gridSize + 60).toFixed(1)}" text-anchor="end" font-size="22" fill="${t.colors.accent}" font-weight="700">■ ${escapeHtml(filledLabel)}</text>
  <text x="${(startX + gridSize / 2 + 80).toFixed(1)}" y="${(startY + gridSize + 60).toFixed(1)}" text-anchor="start" font-size="22" fill="${t.colors.muted}" font-weight="600">■ ${escapeHtml(emptyLabel)}</text>
</svg>`.trim();
  },
};

const COUNTDOWN_TIMELINE: ChartDef = {
  id: "countdown-timeline",
  description: "Vertical timeline with date nodes and event labels branching right.",
  whenToUse: [
    "Showing a sequence of dated events leading to or from a key moment",
    "Roadmap or chronology with 3–6 milestones",
  ],
  propsSchema: {
    type: "object",
    properties: {
      events: {
        type: "array",
        minItems: 2,
        maxItems: 8,
        items: {
          type: "object",
          properties: {
            badge: {
              type: "string",
              description: "Short label inside the dot, e.g. 'Q1' or '2025'",
            },
            title: { type: "string" },
            subtitle: { type: "string" },
            highlight: { type: "boolean", description: "Use accent3 for emphasis" },
          },
          required: ["badge", "title"],
        },
      },
    },
    required: ["events"],
  },
  render(props, ctx) {
    const t = ctx.tokens;
    const w = ctx.width;
    const h = ctx.height;
    const events = Array.isArray(props.events)
      ? (props.events as Array<Record<string, unknown>>)
      : [];
    if (events.length === 0) return "";
    const padX = 120;
    const padY = 60;
    const stepH = (h - padY * 2) / Math.max(events.length - 1, 1);
    const lineX = padX + 40;
    return `
<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" class="hf-chart" style="width:100%;height:100%;font-family:${t.fonts.display};">
  <line class="hf-spine" x1="${lineX}" y1="${padY}" x2="${lineX}" y2="${padY}" data-target-y2="${(padY + stepH * (events.length - 1)).toFixed(1)}" stroke="${t.colors.accent}" stroke-width="3" />
  ${events
    .map((evt, i) => {
      const cy = padY + stepH * i;
      const badge = asString(evt.badge);
      const title = asString(evt.title);
      const subtitle = asString(evt.subtitle);
      const highlight = evt.highlight === true;
      const dotColor = highlight ? t.colors.accent3 : t.colors.accent;
      return `
  <g class="hf-event" opacity="0">
    <circle cx="${lineX}" cy="${cy}" r="20" fill="${dotColor}" />
    <text x="${lineX}" y="${cy + 7}" text-anchor="middle" font-size="16" font-weight="700" fill="white" font-family="${t.fonts.mono}">${escapeHtml(badge)}</text>
    <text x="${lineX + 40}" y="${cy + 2}" font-size="26" font-weight="700" fill="${t.colors.fg}">${escapeHtml(title)}</text>
    ${subtitle ? `<text x="${lineX + 40}" y="${cy + 30}" font-size="20" fill="${t.colors.muted}">${escapeHtml(subtitle)}</text>` : ""}
  </g>`;
    })
    .join("\n  ")}
</svg>`.trim();
  },
};

const GEOLOGICAL_LAYERS: ChartDef = {
  id: "geological-layers",
  description: "Stacked horizontal bands like sediment, lightest at top to darkest at bottom.",
  whenToUse: [
    "Showing scale dropoff from forecast → reality",
    "Comparing 3–6 ordered values where vertical hierarchy matters",
  ],
  propsSchema: {
    type: "object",
    properties: {
      layers: {
        type: "array",
        minItems: 2,
        maxItems: 6,
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            display: { type: "string", description: "Pretty value, e.g. '$13T'" },
            color: { type: "string", enum: ["primary", "secondary", "tertiary", "muted"] },
            dashed: { type: "boolean", description: "True for forecast/projection bands" },
          },
          required: ["label", "display"],
        },
      },
    },
    required: ["layers"],
  },
  render(props, ctx) {
    const t = ctx.tokens;
    const w = ctx.width;
    const h = ctx.height;
    const layers = Array.isArray(props.layers)
      ? (props.layers as Array<Record<string, unknown>>)
      : [];
    if (layers.length === 0) return "";
    const padX = 80;
    const padY = 60;
    const layerH = (h - padY * 2) / layers.length;
    return `
<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" class="hf-chart" style="width:100%;height:100%;font-family:${t.fonts.display};">
  ${layers
    .map((layer, i) => {
      const y = padY + i * layerH;
      const label = asString(layer.label);
      const display = asString(layer.display);
      const dashed = layer.dashed === true;
      const color = pickColor(asString(layer.color) as BarItem["color"], t);
      const dashAttr = dashed ? `stroke-dasharray="8,5"` : "";
      return `
  <rect class="hf-layer" x="${padX}" y="${y.toFixed(1)}" width="0" data-target-w="${(w - padX * 2).toFixed(1)}" height="${(layerH - 4).toFixed(1)}" fill="${color}" opacity="0.15" stroke="${color}" stroke-width="1.5" ${dashAttr} />
  <text x="${padX + 24}" y="${(y + layerH / 2 + 8).toFixed(1)}" font-size="22" font-weight="700" fill="${color}">${escapeHtml(display)}</text>
  <text x="${(w - padX - 24).toFixed(1)}" y="${(y + layerH / 2 + 8).toFixed(1)}" text-anchor="end" font-size="20" fill="${t.colors.muted}">${escapeHtml(label)}</text>`;
    })
    .join("\n  ")}
</svg>`.trim();
  },
};

const DIVERGENCE_LINES: ChartDef = {
  id: "divergence-lines",
  description:
    "Two lines from same origin diverging — one soars, one stays flat. Filled gap shows the divergence.",
  whenToUse: [
    "Comparing growth of two series over time where one outpaces the other",
    "Showing a widening gap (revenue vs cost, supply vs demand)",
  ],
  propsSchema: {
    type: "object",
    properties: {
      seriesA: {
        type: "object",
        properties: {
          label: { type: "string" },
          endValue: { type: "string", description: "Pretty end value" },
          /** 0–100 normalized values for plotting (from start to end) */
          values: { type: "array", items: { type: "number" } },
        },
        required: ["label", "values"],
      },
      seriesB: {
        type: "object",
        properties: {
          label: { type: "string" },
          endValue: { type: "string" },
          values: { type: "array", items: { type: "number" } },
        },
        required: ["label", "values"],
      },
      gapLabel: { type: "string", description: "Text annotation for the gap" },
    },
    required: ["seriesA", "seriesB"],
  },
  render(props, ctx) {
    const t = ctx.tokens;
    const w = ctx.width;
    const h = ctx.height;
    const a = (props.seriesA ?? {}) as Record<string, unknown>;
    const b = (props.seriesB ?? {}) as Record<string, unknown>;
    const aValues = (a.values as number[] | undefined)?.map((v) => Number(v)) ?? [];
    const bValues = (b.values as number[] | undefined)?.map((v) => Number(v)) ?? [];
    if (aValues.length < 2 || bValues.length < 2) return "";
    const padX = 100;
    const padY = 80;
    const innerW = w - padX * 2;
    const innerH = h - padY * 2;
    const max = Math.max(...aValues, ...bValues);
    const safeMax = max > 0 ? max : 1;
    const toPath = (values: number[]) => {
      return values
        .map((v, i) => {
          const x = padX + (innerW * i) / (values.length - 1);
          const y = padY + innerH - (v / safeMax) * innerH;
          return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
        })
        .join(" ");
    };
    const aPath = toPath(aValues);
    const bPath = toPath(bValues);
    const aColor = t.colors.accent;
    const bColor = t.colors.accent2;
    const aLabel = asString(a.label);
    const bLabel = asString(b.label);
    const aEndDisplay = asString(a.endValue);
    const bEndDisplay = asString(b.endValue);
    const gapLabel = asString(props.gapLabel);
    const lastIdx = aValues.length - 1;
    const aEndY = padY + innerH - ((aValues[lastIdx] ?? 0) / safeMax) * innerH;
    const bEndY = padY + innerH - ((bValues[lastIdx] ?? 0) / safeMax) * innerH;
    const endX = padX + innerW;
    return `
<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" class="hf-chart" style="width:100%;height:100%;font-family:${t.fonts.display};">
  <line x1="${padX}" y1="${(padY + innerH).toFixed(1)}" x2="${(w - padX).toFixed(1)}" y2="${(padY + innerH).toFixed(1)}" stroke="${t.colors.subtle}" stroke-width="1" />
  <path class="hf-fill" d="${aPath} L ${endX.toFixed(1)} ${(padY + innerH).toFixed(1)} L ${padX} ${(padY + innerH).toFixed(1)} Z" fill="${aColor}" opacity="0" data-target-opacity="0.12" />
  <path class="hf-line-a" d="${aPath}" fill="none" stroke="${aColor}" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="2000" stroke-dashoffset="2000" />
  <path class="hf-line-b" d="${bPath}" fill="none" stroke="${bColor}" stroke-width="3" stroke-linecap="round" stroke-dasharray="2000" stroke-dashoffset="2000" />
  ${
    gapLabel && Math.abs(aEndY - bEndY) > 30
      ? `<line x1="${(endX - 14).toFixed(1)}" y1="${aEndY.toFixed(1)}" x2="${(endX - 14).toFixed(1)}" y2="${bEndY.toFixed(1)}" stroke="${aColor}" stroke-width="2" stroke-dasharray="4,4" class="hf-gap" opacity="0" />
  <text class="hf-gap-label" x="${(endX - 24).toFixed(1)}" y="${((aEndY + bEndY) / 2 + 6).toFixed(1)}" text-anchor="end" font-size="22" font-weight="700" fill="${aColor}" opacity="0">${escapeHtml(gapLabel)}</text>`
      : ""
  }
  <text class="hf-label-a" x="${(endX + 12).toFixed(1)}" y="${(aEndY + 6).toFixed(1)}" font-size="20" font-weight="700" fill="${aColor}" opacity="0">${escapeHtml(aLabel)}${aEndDisplay ? ` ${aEndDisplay}` : ""}</text>
  <text class="hf-label-b" x="${(endX + 12).toFixed(1)}" y="${(bEndY + 6).toFixed(1)}" font-size="20" font-weight="700" fill="${bColor}" opacity="0">${escapeHtml(bLabel)}${bEndDisplay ? ` ${bEndDisplay}` : ""}</text>
</svg>`.trim();
  },
};

// ── Editorial pack ──────────────────────────────────────────────────────────
//
// FT / Bloomberg / HackerNoon editorial chart language. All three primitives
// share the same chrome (rounded "nice" tick scale, subtle gridlines, value
// labels above every datum, annotation pill with curved leader arrow). The
// outer chart-scene template owns title + subtitle + footer; these charts
// own the data layer.
//
// Animation: each new class added below has a corresponding hook in
// chart-scene's GSAP timeline. Adding new SVG classes to a chart that
// chart-scene doesn't know about means they won't animate — keep them in
// sync (or just reuse the existing hf-* class set when possible).

interface LollipopEvent {
  date: string;
  label: string;
  category?: string;
}

const LOLLIPOP_TIMELINE: ChartDef = {
  id: "lollipop-timeline",
  description:
    "Horizontal lollipop timeline. Each event is a vertical stem with a colored dot at the top, label above, date below the axis. Multiple events can share a category (color). Best when 3-6 dated milestones tell the story.",
  whenToUse: [
    "3-6 chronological milestones across a span of time",
    "Events fall into 2-3 categories (each with its own color)",
    "Editorial timeline for explainer / explainer-recap scenes",
  ],
  propsSchema: {
    type: "object",
    properties: {
      events: {
        type: "array",
        minItems: 2,
        maxItems: 8,
        items: {
          type: "object",
          properties: {
            date: { type: "string", description: "Date label below the axis, e.g. '11 Feb'" },
            label: {
              type: "string",
              description:
                "Multi-line event label above the dot, e.g. 'Coinbase ships Agentic Wallets'",
            },
            category: {
              type: "string",
              description:
                "Optional category id matching one of the categories[] entries — controls the dot color",
            },
          },
          required: ["date", "label"],
        },
      },
      categories: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "Category key referenced by event.category" },
            name: { type: "string", description: "Legend label" },
            color: {
              type: "string",
              enum: ["primary", "secondary", "tertiary"],
              description:
                "Color role in tokens (primary = accent, secondary = accent2, tertiary = accent3)",
            },
          },
          required: ["id", "name"],
        },
        description: "Optional category legend rendered below the timeline.",
      },
    },
    required: ["events"],
  },
  render(props, ctx) {
    const t = ctx.tokens;
    const w = ctx.width;
    const h = ctx.height;
    const eventsRaw = Array.isArray(props.events)
      ? (props.events as Array<Record<string, unknown>>)
      : [];
    const events: LollipopEvent[] = eventsRaw
      .map((evt) => ({
        date: asString(evt.date),
        label: asString(evt.label),
        category: asString(evt.category) || undefined,
      }))
      .filter((evt) => evt.date.length > 0 && evt.label.length > 0);
    if (events.length === 0) return "";
    const categoriesRaw = Array.isArray(props.categories)
      ? (props.categories as Array<Record<string, unknown>>)
      : [];
    const categories = categoriesRaw.map((c) => ({
      id: asString(c.id),
      name: asString(c.name),
      color: pickColor(asString(c.color) as BarItem["color"], t),
    }));
    const colorFor = (catId?: string): string => {
      const cat = categories.find((c) => c.id === catId);
      return cat ? cat.color : t.colors.accent;
    };
    const padX = 80;
    const axisY = h * 0.66; // axis sits ~2/3 down so labels above + dates below both fit
    const stemMax = axisY - 80; // space above axis for label + stem
    const colW = (w - padX * 2) / Math.max(events.length - 1, 1);
    // Alternate stem heights so adjacent labels don't collide. Pattern: tall, short, tall, short.
    const stemHeights = events.map((_, i) => stemMax * (i % 2 === 0 ? 0.7 : 1.0));
    return `
<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" class="hf-chart" style="width:100%;height:100%;font-family:${t.fonts.display};">
  <line x1="${padX.toFixed(1)}" y1="${axisY.toFixed(1)}" x2="${(w - padX).toFixed(1)}" y2="${axisY.toFixed(1)}" stroke="${t.colors.fg}" stroke-width="1.5" opacity="0.5" />
  ${events
    .map((evt, i) => {
      const cx = events.length === 1 ? w / 2 : padX + colW * i;
      const stemH = stemHeights[i] ?? stemMax;
      const dotY = axisY - stemH;
      const color = colorFor(evt.category);
      const labelLines = evt.label
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const labelHeight = labelLines.length * 22;
      const labelTopY = dotY - 24 - labelHeight;
      const labelText = labelLines
        .map(
          (line, li) =>
            `<text x="${cx.toFixed(1)}" y="${(labelTopY + 18 + li * 22).toFixed(1)}" text-anchor="middle" font-size="20" font-weight="700" fill="${t.colors.fg}">${escapeHtml(line)}</text>`,
        )
        .join("\n  ");
      return `
  <g class="hf-lollipop hf-lollipop-${i}" opacity="0">
    ${labelText}
    <line class="hf-lollipop-stem" x1="${cx.toFixed(1)}" y1="${axisY.toFixed(1)}" x2="${cx.toFixed(1)}" y2="${axisY.toFixed(1)}" data-target-y2="${dotY.toFixed(1)}" stroke="${color}" stroke-width="2.5" />
    <circle class="hf-lollipop-dot" cx="${cx.toFixed(1)}" cy="${dotY.toFixed(1)}" r="0" data-target-r="9" fill="${color}" />
    <text x="${cx.toFixed(1)}" y="${(axisY + 36).toFixed(1)}" text-anchor="middle" font-size="22" font-weight="700" fill="${t.colors.muted}">${escapeHtml(evt.date)}</text>
  </g>`;
    })
    .join("")}
  ${
    categories.length > 0
      ? `<g class="hf-legend" opacity="0">
    ${categories
      .map((cat, i) => {
        const lx = padX + i * 380;
        const ly = h - 30;
        return `
    <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="6" fill="${cat.color}" />
    <text x="${(lx + 14).toFixed(1)}" y="${(ly + 6).toFixed(1)}" font-size="20" font-weight="700" fill="${cat.color}">${escapeHtml(cat.name)}</text>`;
      })
      .join("")}
  </g>`
      : ""
  }
</svg>`.trim();
  },
};

interface GroupedSeries {
  name: string;
  values: number[];
  color: BarItem["color"];
  highlightIndex?: number;
  highlightColor?: BarItem["color"];
}

const GROUPED_BARS: ChartDef = {
  id: "grouped-bars",
  description:
    "Vertical grouped bars (typically 2 series across N categories) with value labels above every bar, optional bar highlight in a third color, and y-axis tick + gridlines. Best for before/after across multiple items.",
  whenToUse: [
    "Comparing 2 (occasionally 3) time periods or conditions across N categories",
    "When the focal beat is one specific bar going way up vs the others",
    "Editorial 'X grew Yx in Z months' framing",
  ],
  propsSchema: {
    type: "object",
    properties: {
      groups: {
        type: "array",
        minItems: 2,
        maxItems: 8,
        items: { type: "string" },
        description:
          "Category labels (X-axis), one per group. Newlines split into 2-line labels for narrow groups, e.g. 'GitHub\\nCopilot'.",
      },
      series: {
        type: "array",
        minItems: 1,
        maxItems: 3,
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Series legend label" },
            values: {
              type: "array",
              items: { type: ["number", "null"] },
              description: "Values for each group; null = no data, renders as missing bar",
            },
            color: {
              type: "string",
              enum: ["primary", "secondary", "tertiary", "muted"],
              description: "Bar color role for this series",
            },
            highlightIndex: {
              type: "integer",
              description:
                "If set, the bar at this group index in this series gets the highlightColor instead",
            },
            highlightColor: {
              type: "string",
              enum: ["primary", "secondary", "tertiary"],
              description: "Color role for the highlighted bar",
            },
          },
          required: ["name", "values"],
        },
      },
      yMax: {
        type: "number",
        description: "Optional y-axis ceiling; otherwise auto-rounds via niceCeiling()",
      },
      valueFormat: {
        type: "string",
        enum: ["number", "percent", "compact-money", "compact-count", "currency"],
        description: "Number-format for value labels and tick labels",
      },
      annotation: {
        type: "object",
        description: "Optional annotation pill with curved leader arrow",
        properties: {
          text: { type: "string", description: "Multi-line annotation text" },
          targetGroup: { type: "integer", description: "Group index the arrow points at" },
          targetSeries: {
            type: "integer",
            description: "Series index of the bar the arrow points at (default last series)",
          },
          position: {
            type: "string",
            enum: ["above", "below", "left", "right"],
            description: "Where the pill sits relative to the target bar",
          },
        },
        required: ["text", "targetGroup"],
      },
    },
    required: ["groups", "series"],
  },
  render(props, ctx) {
    const t = ctx.tokens;
    const w = ctx.width;
    const h = ctx.height;
    const groups = asStringArray(props.groups);
    if (groups.length === 0) return "";
    const seriesRaw = Array.isArray(props.series)
      ? (props.series as Array<Record<string, unknown>>)
      : [];
    const series: GroupedSeries[] = seriesRaw
      .map((s) => {
        const values = (Array.isArray(s.values) ? s.values : []).map((v) =>
          v === null || v === undefined ? null : Number(v),
        );
        return {
          name: asString(s.name),
          values: values.map((v) => (v === null || !Number.isFinite(v) ? Number.NaN : v)),
          color: (asString(s.color) as BarItem["color"]) || "secondary",
          highlightIndex:
            typeof s.highlightIndex === "number" ? (s.highlightIndex as number) : undefined,
          highlightColor:
            (asString(s.highlightColor) as BarItem["color"]) || ("primary" as BarItem["color"]),
        };
      })
      .filter((s) => s.name.length > 0);
    if (series.length === 0) return "";
    const valueFormat = (asString(props.valueFormat) as ValueFormat) || "number";
    const allValues: number[] = [];
    for (const s of series) for (const v of s.values) if (Number.isFinite(v)) allValues.push(v);
    const dataMax = allValues.length > 0 ? Math.max(...allValues) : 1;
    const yMaxProp = Number(props.yMax);
    const yMax = Number.isFinite(yMaxProp) && yMaxProp > 0 ? yMaxProp : niceCeiling(dataMax);
    const ticks = niceTicks(yMax);
    const padTop = 70;
    const padBottom = 110;
    const chartLeft = 130;
    const chartRight = w - 60;
    const chartTopY = padTop;
    const chartBottomY = h - padBottom;
    const chartH = chartBottomY - chartTopY;
    const groupCount = groups.length;
    const groupW = (chartRight - chartLeft) / groupCount;
    const seriesGap = 8;
    const barW = Math.max(20, (groupW * 0.75 - seriesGap * (series.length - 1)) / series.length);
    // Annotation anchor calculation (if present)
    const annotationProp = props.annotation as Record<string, unknown> | undefined;
    let annotationFragment = "";
    if (annotationProp && asString(annotationProp.text).length > 0) {
      const targetGroup = Math.max(
        0,
        Math.min(groupCount - 1, Number(annotationProp.targetGroup) || 0),
      );
      const targetSeries = Math.max(
        0,
        Math.min(
          series.length - 1,
          typeof annotationProp.targetSeries === "number"
            ? Number(annotationProp.targetSeries)
            : series.length - 1,
        ),
      );
      const groupCenter = chartLeft + groupW * targetGroup + groupW / 2;
      const offsetIntoGroup = (targetSeries - (series.length - 1) / 2) * (barW + seriesGap);
      const anchorX = groupCenter + offsetIntoGroup;
      const v = series[targetSeries]?.values[targetGroup] ?? 0;
      const barH = (Math.max(0, v) / yMax) * chartH;
      const anchorY = chartBottomY - barH;
      annotationFragment = renderAnnotation({
        text: asString(annotationProp.text),
        anchor: { x: anchorX, y: anchorY },
        position: (asString(annotationProp.position) as "above" | "right") || "right",
        offset: 90,
        width: 220,
        tokens: t,
        classId: "ann-0",
        fontSize: 18,
      });
    }
    return `
<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" class="hf-chart" style="width:100%;height:100%;font-family:${t.fonts.display};">
  ${renderGridlines({ ticks, yMax, chartLeft, chartRight, axisTopY: chartTopY, axisBottomY: chartBottomY, tokens: t, format: valueFormat, labelX: chartLeft - 16 })}
  ${groups
    .map((groupLabel, gi) => {
      const groupCenter = chartLeft + groupW * gi + groupW / 2;
      const labelLines = groupLabel
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const labelText = labelLines
        .map(
          (line, li) =>
            `<text x="${groupCenter.toFixed(1)}" y="${(chartBottomY + 32 + li * 22).toFixed(1)}" text-anchor="middle" font-size="20" fill="${t.colors.fg}" font-weight="600">${escapeHtml(line)}</text>`,
        )
        .join("\n  ");
      const barFragments = series
        .map((s, si) => {
          const v = s.values[gi];
          if (v === undefined || !Number.isFinite(v)) return "";
          const barH = (Math.max(0, v) / yMax) * chartH;
          const barTop = chartBottomY - barH;
          const offsetIntoGroup = (si - (series.length - 1) / 2) * (barW + seriesGap);
          const barX = groupCenter + offsetIntoGroup - barW / 2;
          const isHighlight = s.highlightIndex === gi;
          const role = isHighlight && s.highlightColor ? s.highlightColor : s.color;
          const color = pickColor(role, t);
          return `
  <rect class="hf-bar" x="${barX.toFixed(1)}" y="${chartBottomY.toFixed(1)}" width="${barW.toFixed(1)}" height="0" data-target-y="${barTop.toFixed(1)}" data-target-h="${barH.toFixed(1)}" fill="${color}" />
  <text class="hf-bar-val" x="${(barX + barW / 2).toFixed(1)}" y="${(barTop - 12).toFixed(1)}" text-anchor="middle" font-size="22" font-weight="700" fill="${color}" opacity="0">${escapeHtml(formatValue(v, valueFormat))}</text>`;
        })
        .join("");
      return `${labelText}${barFragments}`;
    })
    .join("\n  ")}
  ${
    series.length > 1
      ? `<g class="hf-legend" opacity="0">
    ${series
      .map((s, i) => {
        const lx = chartLeft + i * 220;
        const ly = padTop - 24;
        const color = pickColor(s.color, t);
        return `
    <rect x="${lx.toFixed(1)}" y="${(ly - 12).toFixed(1)}" width="14" height="14" fill="${color}" />
    <text x="${(lx + 22).toFixed(1)}" y="${(ly - 1).toFixed(1)}" font-size="18" font-weight="600" fill="${t.colors.fg}">${escapeHtml(s.name)}</text>`;
      })
      .join("")}
  </g>`
      : ""
  }
  ${annotationFragment}
</svg>`.trim();
  },
};

interface AreaPoint {
  x: string;
  y: number;
}

const ANNOTATED_AREA: ChartDef = {
  id: "annotated-area",
  description:
    "Single-series area chart over time with marker dots, value labels at the endpoints, y-axis ticks + gridlines, and an optional annotation pill in the middle. Best for cumulative growth or single-series time-series.",
  whenToUse: [
    "Showing cumulative growth (transactions, users, revenue)",
    "Single time-series with 4-7 data points where the endpoint value is the punchline",
    "When a callout in the middle explains what's happening (eg 'X days from launch to Y')",
  ],
  propsSchema: {
    type: "object",
    properties: {
      points: {
        type: "array",
        minItems: 2,
        maxItems: 12,
        items: {
          type: "object",
          properties: {
            x: { type: "string", description: "X-axis label, e.g. '11 Feb' or 'Q1'" },
            y: { type: "number", description: "Numeric value at this point" },
          },
          required: ["x", "y"],
        },
      },
      yMax: { type: "number", description: "Optional y-axis ceiling; auto via niceCeiling()" },
      valueFormat: {
        type: "string",
        enum: ["number", "percent", "compact-money", "compact-count", "currency"],
        description: "Number-format for tick + endpoint labels",
      },
      yLabel: { type: "string", description: "Optional rotated label on the Y-axis" },
      startLabel: { type: "string", description: "Override label for first endpoint, e.g. '0'" },
      endLabel: { type: "string", description: "Override label for last endpoint, e.g. '50M+'" },
      annotation: {
        type: "object",
        description: "Optional annotation pill",
        properties: {
          text: { type: "string", description: "Multi-line text" },
          targetIndex: {
            type: "integer",
            description: "Point index to anchor the arrow to (default = midpoint)",
          },
          position: {
            type: "string",
            enum: ["above", "below", "left", "right"],
          },
        },
        required: ["text"],
      },
    },
    required: ["points"],
  },
  render(props, ctx) {
    const t = ctx.tokens;
    const w = ctx.width;
    const h = ctx.height;
    const pointsRaw = Array.isArray(props.points)
      ? (props.points as Array<Record<string, unknown>>)
      : [];
    const points: AreaPoint[] = pointsRaw
      .map((p) => ({ x: asString(p.x), y: Number(p.y) }))
      .filter((p) => p.x.length > 0 && Number.isFinite(p.y));
    if (points.length < 2) return "";
    const valueFormat = (asString(props.valueFormat) as ValueFormat) || "number";
    const yMaxProp = Number(props.yMax);
    const dataMax = Math.max(...points.map((p) => p.y));
    const yMax = Number.isFinite(yMaxProp) && yMaxProp > 0 ? yMaxProp : niceCeiling(dataMax);
    const ticks = niceTicks(yMax);
    const padTop = 70;
    const padBottom = 100;
    const chartLeft = 140;
    const chartRight = w - 80;
    const chartTopY = padTop;
    const chartBottomY = h - padBottom;
    const chartH = chartBottomY - chartTopY;
    const yLabel = asString(props.yLabel);
    // Plot points in chart coords.
    const plotted = points.map((p, i) => ({
      x: chartLeft + ((chartRight - chartLeft) * i) / (points.length - 1),
      y: chartBottomY - (Math.max(0, p.y) / yMax) * chartH,
      raw: p,
    }));
    // Line path + area fill.
    const linePath = plotted
      .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(" ");
    const areaPath = `${linePath} L ${chartRight.toFixed(1)} ${chartBottomY.toFixed(1)} L ${chartLeft.toFixed(1)} ${chartBottomY.toFixed(1)} Z`;
    const lineColor = t.colors.accent;
    const startLabel = asString(props.startLabel) || formatValue(points[0]?.y ?? 0, valueFormat);
    const endLabel =
      asString(props.endLabel) || formatValue(points[points.length - 1]?.y ?? 0, valueFormat);
    // Annotation
    const annotationProp = props.annotation as Record<string, unknown> | undefined;
    let annotationFragment = "";
    if (annotationProp && asString(annotationProp.text).length > 0) {
      const targetIndex =
        typeof annotationProp.targetIndex === "number"
          ? Math.max(0, Math.min(points.length - 1, Number(annotationProp.targetIndex)))
          : Math.floor(points.length / 2);
      const target = plotted[targetIndex];
      if (target) {
        annotationFragment = renderAnnotation({
          text: asString(annotationProp.text),
          anchor: { x: target.x, y: target.y },
          position: (asString(annotationProp.position) as "above") || "above",
          offset: 70,
          width: 240,
          tokens: t,
          classId: "ann-0",
          fontSize: 18,
        });
      }
    }
    const startPoint = plotted[0];
    const endPoint = plotted[plotted.length - 1];
    return `
<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" class="hf-chart" style="width:100%;height:100%;font-family:${t.fonts.display};">
  ${renderGridlines({ ticks, yMax, chartLeft, chartRight, axisTopY: chartTopY, axisBottomY: chartBottomY, tokens: t, format: valueFormat, labelX: chartLeft - 16 })}
  ${
    yLabel
      ? `<text x="${(chartLeft - 90).toFixed(1)}" y="${(chartTopY + chartH / 2).toFixed(1)}" text-anchor="middle" font-size="18" font-style="italic" fill="${t.colors.muted}" transform="rotate(-90 ${(chartLeft - 90).toFixed(1)} ${(chartTopY + chartH / 2).toFixed(1)})">${escapeHtml(yLabel)}</text>`
      : ""
  }
  <path class="hf-fill" d="${areaPath}" fill="${lineColor}" opacity="0" data-target-opacity="0.18" />
  <path class="hf-line-a" d="${linePath}" fill="none" stroke="${lineColor}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="3000" stroke-dashoffset="3000" />
  ${plotted
    .map(
      (p, i) =>
        `<circle class="hf-marker hf-marker-${i}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="0" data-target-r="6" fill="${lineColor}" />`,
    )
    .join("\n  ")}
  ${
    startPoint
      ? `<text class="hf-label-a" x="${startPoint.x.toFixed(1)}" y="${(startPoint.y - 18).toFixed(1)}" text-anchor="middle" font-size="22" font-weight="700" fill="${t.colors.fg}" opacity="0">${escapeHtml(startLabel)}</text>`
      : ""
  }
  ${
    endPoint
      ? `<text class="hf-label-b" x="${endPoint.x.toFixed(1)}" y="${(endPoint.y - 18).toFixed(1)}" text-anchor="middle" font-size="26" font-weight="700" fill="${lineColor}" opacity="0">${escapeHtml(endLabel)}</text>`
      : ""
  }
  ${plotted
    .map(
      (p) =>
        `<text x="${p.x.toFixed(1)}" y="${(chartBottomY + 36).toFixed(1)}" text-anchor="middle" font-size="20" fill="${t.colors.muted}">${escapeHtml(p.raw.x)}</text>`,
    )
    .join("\n  ")}
  ${annotationFragment}
</svg>`.trim();
  },
};

export const BUILTIN_CHARTS: readonly ChartDef[] = [
  PROPORTIONAL_BARS,
  WATERFALL_BARS,
  CLIFF_CHART,
  DIVERGENCE_LINES,
  DONUT_RING,
  WAFFLE_GRID,
  COUNTDOWN_TIMELINE,
  GEOLOGICAL_LAYERS,
  // Editorial pack — FT/Bloomberg/HackerNoon visual language.
  LOLLIPOP_TIMELINE,
  GROUPED_BARS,
  ANNOTATED_AREA,
];

export function getChart(id: string): ChartDef | undefined {
  return BUILTIN_CHARTS.find((c) => c.id === id);
}
