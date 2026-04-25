import type { ChartDef } from "./types.js";
import { escapeHtml, asString, asStringArray } from "../templates/util.js";

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

export const BUILTIN_CHARTS: readonly ChartDef[] = [
  PROPORTIONAL_BARS,
  WATERFALL_BARS,
  CLIFF_CHART,
  DIVERGENCE_LINES,
  DONUT_RING,
  WAFFLE_GRID,
  COUNTDOWN_TIMELINE,
  GEOLOGICAL_LAYERS,
];

export function getChart(id: string): ChartDef | undefined {
  return BUILTIN_CHARTS.find((c) => c.id === id);
}
