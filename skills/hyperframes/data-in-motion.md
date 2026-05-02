# Data in Motion

Guidance for charts and stats in video compositions. The [house style](./house-style.md) handles aesthetics — this addresses data-specific decisions.

## Pick a register before you pick a chart

There are **two valid data-viz registers** in the catalog. They look opposite on purpose, and mixing them in one video reads as confused.

### Reels register — chrome-less, kinetic

For Reels / TikTok / vertical-feed videos in the cyberlofi family. The data IS the visual; everything else is removed. Use the `cyber-*` data templates (`glitch-bar-chart`, `cyber-counter-burst`, `data-stream-reveal`, `cyber-comparison`) or the cyberlofi-styled freeform path.

- **No gridlines, no axis labels, no legends** — viewer can't study them in a 3-second window
- **Continuous motion** — RGB drift, scanline scroll, accent pulse always running
- **One number, one visual element, one beat** per scene
- Pure-black canvas, JetBrains Mono, pixel-green / glitch-pink accents

### Editorial register — full chrome, FT/Bloomberg/HackerNoon

For longer-form explainers, landscape video, or when the brand is editorial-credible. Use `chart-scene` template with charts from the `BUILTIN_CHARTS` editorial pack.

- **Y-axis tick marks + subtle gridlines** are _required_ — they're how the eye calibrates magnitude
- **Bold value labels above every datum** (no ambiguity about what each bar/dot is worth)
- **One annotation pill** with a curved leader arrow tells the reader what the chart MEANS
- **Sources line + author byline** in the footer — non-negotiable, the editorial credibility comes from this
- Cream parchment bg, Georgia serif title, italic muted subtitle, red accent + navy + tan palette (`hackernoon-ft` theme)

## Editorial-pack chart vocabulary

These are the FT-grade primitives in `BUILTIN_CHARTS` (extend at `packages/core/src/script/charts/builtin.ts`):

| Chart id             | What it does                                                                                                          | Pick when                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `lollipop-timeline`  | Horizontal lollipop with categorical color series + bottom legend                                                     | 3-6 chronological milestones across a span; events fall into 2-3 categories          |
| `grouped-bars`       | Vertical grouped bars (typically 2 series), value labels above every bar, optional one-bar highlight in a third color | "X grew Yx vs Z" framing, before/after across multiple items                         |
| `annotated-area`     | Single-series area chart over time, marker dots, endpoint labels, annotation pill                                     | Cumulative growth (transactions, users, revenue) where the endpoint is the punchline |
| `divergence-lines`   | Two lines from same origin diverging, gap label                                                                       | Comparing growth of two series where one outpaces the other                          |
| `donut-ring`         | Single-percent donut with center number                                                                               | A single ratio is the whole point (99% USD-pegged, 5.3% returned)                    |
| `waterfall-bars`     | Vertical bars sorted descending                                                                                       | Sorted ranking where the falloff is the story                                        |
| `proportional-bars`  | Horizontal bars scaled to data                                                                                        | Ranking categories by a scalar                                                       |
| `cliff-chart`        | Rise + crash meeting at peak                                                                                          | Boom-and-bust narrative                                                              |
| `geological-layers`  | Stacked horizontal bands                                                                                              | Forecast → reality dropoff comparison                                                |
| `countdown-timeline` | Vertical timeline with date nodes                                                                                     | Roadmap or chronology                                                                |
| `waffle-grid`        | 10×10 percentage grid                                                                                                 | When the human-scale of a small percent is the point                                 |

## The annotation pill is the s-tier signature

Every editorial dataviz reference has it: a beige rounded rectangle with an italic 1-2 line caption, plus a curved leader arrow pointing at the focal datum. The pill explains what the chart MEANS, not what it shows. The title says "Bot Traffic Share." The pill says "+2.6 pp acceleration."

`grouped-bars` and `annotated-area` accept an `annotation` prop:

```jsonc
"annotation": {
  "text": "6× growth in 9 months",
  "targetGroup": 2,        // which group/index the arrow points at
  "targetSeries": 1,       // which series within that group (grouped-bars only)
  "position": "right"      // above | below | left | right
}
```

The pill body fades in at 1.6s; the curved leader draws via stroke-dashoffset 0.3s after — so the eye reaches the data first, then the explanation lands.

## Frame choices on chart-scene

```jsonc
{
  "template": "chart-scene",
  "props": {
    "title": "Ninety Days That Gave AI Agents a Tax ID",
    "subtitle": "Year 2026, agent-economy infrastructure milestones from wallet to legal entity",
    "titleStyle": "rule-above",       // or "underline-below"
    "byline": "Ishan Pandey  /  HackerNoon",
    "bylinePosition": "left",          // or "right"
    "source": "Sources: Coinbase, ClawBank, CoinDesk, FinTech Weekly.",
    "chart": { "type": "lollipop-timeline", "props": { ... } }
  }
}
```

- `titleStyle: "rule-above"` → tiny red rectangle above the title (HackerNoon "thread mark" style — Images 1-3 of the FT references)
- `titleStyle: "underline-below"` → red bar drawing in BENEATH the title (Images 4-5 of the FT references)
- `bylinePosition: "left"` → byline LEFT, sources RIGHT (default; Images 1-3)
- `bylinePosition: "right"` → sources LEFT, byline RIGHT (Images 4-5)

Match the title style to the chart's energy: rule-above feels like a section start (timelines, comparisons); underline-below feels like a section header (KPIs, growth charts).

## Number formatting

Pass `valueFormat` on the chart to get correct unit suffixes:

| Format          | Output                                                  |
| --------------- | ------------------------------------------------------- |
| `compact-money` | `$1.4T` / `$325B` / `$50M` / `$2.5K`                    |
| `compact-count` | `1.4T` / `325B` / `50M+`                                |
| `percent`       | `49.6%` (one decimal sub-100, integer otherwise)        |
| `currency`      | `$1,234,567` (full precision with thousands separators) |
| `number`        | `1,234,567`                                             |

Y-axis ticks auto-round to "nice" boundaries (49.6 → 50, 283 → 300, 1234 → 2000) via `niceCeiling()` so the scale labels read like a real chart, not raw data.

## Always-on rules

- **No pie charts.** Use `donut-ring` (single ratio) or `waffle-grid` (small percent felt at human scale).
- **No multi-axis charts.** Two scales at once are unreadable in a 3-second window.
- **No 6-panel dashboards.** 2-3 related metrics side-by-side is fine; 6+ is a web pattern.
- **No chart-library output.** Build with GSAP + inline SVG/CSS, never D3 or Chart.js.
- **Visual continuity for series of metrics.** Q1 → Q2 → Q3 → Q4 should keep the same visual space with the same aesthetic; only the VALUE changes. An aesthetic change should signal a new concept, not just a new number.
