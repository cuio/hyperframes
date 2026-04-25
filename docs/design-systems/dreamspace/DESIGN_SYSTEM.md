# Dreamspace Video — Design System & Template Library

This document is the **design specification** for the animated explainer style shown in `Dreamspace Explainer.html`. Feed this to Claude Code along with the HTML/JSX source files and it will reproduce the visual language for any new script.

## How to use this doc with Claude Code

In your project root, do this:

```
my-videos/
├── design_system/
│   ├── DESIGN_SYSTEM.md              ← this file
│   ├── Dreamspace Explainer.html     ← reference render
│   ├── dreamspace.jsx                ← reference component code
│   └── animations.jsx                ← timeline primitives
├── templates/                        ← you'll generate these
├── scripts/                          ← your YAML/MD scripts
└── output/                           ← rendered MP4s
```

Then in Claude Code (or any agent), open the project and prompt:

> Read `design_system/DESIGN_SYSTEM.md` and the three reference files. When I give you a script, port the design language onto Hyperframes HTML+GSAP using the templates spec'd in the doc. Match the palette, type, motion timings, and composition rules exactly. If the script needs a slide type not in the library, design a new one that fits the same DNA and add it to the templates folder.

That's the whole prompt. The doc below has everything the agent needs.

---

## 1. Design DNA (non-negotiables)

These rules are what make the videos feel cohesive across episodes. Treat them as constraints, not suggestions.

### Palette (oklch — chroma-matched on purpose)

```css
--ink:        oklch(0.13 0.02 270);   /* page background, deepest */
--ink-2:      oklch(0.18 0.025 275);  /* card / inset */
--ink-3:      oklch(0.24 0.03 275);   /* hover / elevated */
--paper:      oklch(0.97 0.005 280);  /* primary text */
--dim:        oklch(0.72 0.01 280);   /* secondary text */
--dim-2:      oklch(0.50 0.02 280);   /* tertiary, captions */
--rule:       oklch(0.32 0.02 275);   /* dividers */
--uv:         oklch(0.72 0.18 295);   /* primary accent — violet */
--uv-deep:    oklch(0.55 0.20 290);   /* primary accent, pressed state */
--cyan:       oklch(0.82 0.13 200);   /* secondary accent — electric cyan */
--amber:      oklch(0.82 0.13 75);    /* tertiary accent — warm */
```

Rules:
- **Background is always `--ink`**, never pure black, never a gradient.
- **Three accents max per slide.** UV (violet) is the lead. Cyan and amber are support, used to differentiate stats or layers.
- **No saturated whites.** All "white" text is `--paper` (oklch 0.97 280) — slightly cool.
- **Gradients only for headline text.** `linear-gradient(180deg, var(--paper) 0%, var(--uv) 100%)` clipped to text. Never on backgrounds, never on cards.

### Type stack

| Use | Family | Weight | Tracking |
|---|---|---|---|
| Display headlines | Space Grotesk | 400 (light), 500 (medium) | -0.02 to -0.04em |
| Body / on-screen | Inter | 400, 500 | normal |
| Labels, captions, code | JetBrains Mono | 300, 400, 500 | 0.18 to 0.32em uppercase |

Rules:
- **Headlines always Space Grotesk, lowercase or sentence case, never all-caps.**
- **Mono is for chrome only:** eyebrows, slide indices, footers, code-feeling moments. Never for headlines.
- **Italic + color = emphasis.** A single phrase per headline can be italic + UV or italic + cyan. Never italicize without color.
- **Letter-spacing decreases as size grows.** 84px+ uses -0.025em or tighter. 14px uses 0.

### Motion physics

All slides use the same timing primitives. Don't invent new easings.

```js
// Use these only
Easing.easeOutCubic   // entrances (default)
Easing.easeOutQuart   // hero entrances (counters, big text)
Easing.easeInOutCubic // crossfades, scrubs
Easing.easeOutBack    // single playful moment per video, max
Easing.linear         // typing effects, draw-on, rotation
```

Timing rules (slide-local, t=0 is slide start):

- **Eyebrow / kicker:** appears 0.2s → 0.7s (fade + 12px rise)
- **Headline:** 0.4s → 1.0s (fade + 16px rise)
- **Body / supporting elements:** 1.0s → 2.0s, staggered 0.18–0.22s apart
- **Counters / big numbers:** start 1.2s, run for 1.4s
- **Hero transition or beam:** 2.6s → 3.4s
- **Slide hold:** at least 1.2s after last element lands before fade-out
- **Crossfade between slides:** 0.4s overlap

### Composition rules

1. **Every slide has chrome.** Top-left wordmark dot + "dreamspace" (or your brand). Top-right slide index + label. Bottom-left date/embargo. Bottom-right URL. All in mono, 11px, dim color. Don't break this — it's the connective tissue.
2. **Padding:** slides use `120px` horizontal padding for content, `36px` for chrome. 1920×1080 canvas.
3. **Eyebrow → Headline → Content.** Every content slide opens with a mono eyebrow ("▸ <category>" in UV), then a Space Grotesk headline (max 22ch wide), then content.
4. **No rounded corners on cards.** This system is intentionally squared. The only round things: avatar dots (10×10), the wordmark dot, and the Replay-style pill if used.
5. **Borders are 1px, color `--rule`.** Active/highlighted state swaps to `--uv` and adds a subtle `rgba(167,139,250,0.08)` background tint.
6. **Hairlines as section breaks.** A `border-top: 1px solid var(--rule)` with `padding-top: 28–36px` separates content blocks. No boxes, no shadows.
7. **Stars + grain are global, subtle.** Two layers: a `.stars` radial-gradient field at low opacity, and a `.grain` SVG noise overlay at 5% with `mix-blend-mode: overlay`. Apply once at the stage level, not per slide.

---

## 2. Template Library

Six core templates cover ~90% of explainer needs. Each is a parameterized block — your script schema fills the params.

### T1 — Cold Open

**Use for:** opening hero, brand reveal, episode intro
**Duration:** 4.5–5.5s
**Params:** `eyebrow` (string), `wordmark` (string), `tagline_words` (string[])

**Composition:**
- Centered, full-bleed
- 4 concentric SVG orbital rings (radii 180, 280, 380, 480), drawn left-to-right via stroke-dashoffset
- Ring 2 is highlighted in UV; the others are `--rule` at 0.45 opacity
- A single cyan dot orbits ring 2 driven by `cos(t*0.6)`, `sin(t*0.6)`
- Center stack: mono eyebrow (12px, 0.32em UV) → big Space Grotesk wordmark (200px, gradient-clipped paper→UV) → row of tagline words (30px, staggered 0.12s apart)

**Timing:**
- 0.2s: eyebrow in
- 0.5s: wordmark in (easeOutQuart, +30px rise)
- 1.4s onwards: tagline words, 0.12s stagger

### T2 — Prompt → Output

**Use for:** showing input transforming into output (prompt to app, query to result, doc to summary)
**Duration:** 5–6s
**Params:** `prompt_text` (string), `output_type` ("phone"|"card"|"chart"|"web"), `output_data` (varies by type)

**Composition:**
- Two-column grid, 120px gutter, equal width
- **Left:** mono eyebrow "▸ describe what to build" → terminal-style card (1px rule border, `rgba(20,20,38,0.6)` bg, 8px backdrop-blur, 6px radius — the only radius exception) with mono prompt path "user@dream.space ~ $" then typed prompt in Space Grotesk 28px with blinking UV caret
- **Right:** the output (phone mock / data card / chart) with energy beam connecting from left
- **Beam:** SVG line, 2px UV stroke, drop-shadow `0 0 8px var(--uv)`, draw left-to-right via stroke-dashoffset

**Timing:**
- 0.3s → 2.6s: prompt types out (linear)
- 2.6s → 3.4s: beam draws across
- 2.8s → 3.6s: output fades + scales 0.94 → 1.0
- 3.2s onwards: output internal elements stagger in, 0.15s apart

### T3 — By the Numbers

**Use for:** stats, KPIs, traction
**Duration:** 5–6s
**Params:** `eyebrow`, `headline`, `stats: [{value, display_format, label, sub}]` (1–4 stats, 3 is sweet spot)

**Composition:**
- Top: mono eyebrow → Space Grotesk headline (76px, max 20ch)
- Hairline divider
- Bottom: equal-column grid (3-col is the canon; 2 or 4 also work)
- Each stat: colored 8×8 square + mono index ("01") → giant number (88px Space Grotesk 500, accent color, -0.03em) → label (18px paper, max 20ch) → sub-label (11px mono dim)
- Numbers count up using `Easing.easeOutQuart` over 1.4s

**Timing:**
- 0.4s: headline
- 1.2s + i*0.35s: each stat enters, counter starts immediately

**Color rotation per stat:** UV → cyan → amber → paper. Always in that order.

### T4 — Stack / Layers

**Use for:** architecture, partner stack, taxonomy, ordered list of components
**Duration:** 5–6s
**Params:** `eyebrow`, `headline`, `layers: [{name, desc, role, highlight?}]` (3–6 layers)

**Composition:**
- Top: eyebrow → headline (64px Space Grotesk, max 22ch)
- Below: vertical stack of full-width layer cards, 14px gap
- Each card: 3-column grid `[200px, 1fr, 120px]` for [name, description, role-tag]
- Highlighted layer (one per slide, marked `highlight: true`): UV border, UV-tinted background, UV name color
- Other layers: `--rule` border, `rgba(20,20,38,0.5)` background

**Timing:**
- 0.4s: headline
- 1.0s + i*0.22s: each layer slides in from -40px x-offset, easeOutCubic

### T5 — Manifesto

**Use for:** thesis, why-it-matters, principles
**Duration:** 5s
**Params:** `eyebrow`, `headline_a`, `accent_phrase_a` (italic, UV), `headline_b`, `accent_phrase_b` (color highlight, cyan), `beats: [{key, value, tag}]` (3–4 beats)

**Composition:**
- Two-line headline at 84px Space Grotesk, lowercase, -0.025em
  - Line A contains an italic UV phrase mid-sentence (font-weight 300, font-style italic)
  - Line B contains a cyan accent phrase
- Hairline below
- 4-column beats grid: each beat has mono "01 / tag" → Space Grotesk 28px key → 14px Inter dim value

**Timing:**
- 0.4s: headline line A
- 0.7s: headline line B
- 1.6s + i*0.18s: beats stagger in

### T6 — Launch / CTA

**Use for:** closing card, URL reveal, episode end
**Duration:** 3.5–4.5s
**Params:** `date_label`, `headline` (e.g., "Start building."), `url` (typed out), `partner_line`

**Composition:**
- Centered, full-bleed
- Two expanding concentric rings drawn from center over 1.2s (UV outer at 1800px diameter, cyan inner at 1200px)
- Center stack: mono date eyebrow (32em tracking) → Space Grotesk headline (96px) → giant gradient URL (140px Space Grotesk 500, paper→UV gradient) with typing animation + blinking UV caret → mono partner line (13px, 0.22em uppercase)

**Timing:**
- 0s: rings expand (easeOutQuart)
- 0.4s: date eyebrow
- 0.6s: headline
- 1.4s: URL begins fading in
- 1.6s → 2.4s: URL types
- 2.6s: partner line

---

## 3. Adding new templates

When the script needs something the library doesn't cover, design a new template under these constraints:

- Must use the palette tokens; no new colors
- Must follow chrome rules (top-left wordmark, top-right index, bottom corners)
- Must follow eyebrow → headline → content order if it's a content slide
- Hold last element on screen ≥ 1.2s before crossfade
- Headlines max 22ch, body max 60ch
- Add the new template's spec to this doc under section 2

Common new templates that fit cleanly:
- **Quote** — single oversized pull quote, attribution line
- **Timeline** — horizontal beats with year labels
- **Comparison** — two-column before/after
- **Process** — circular flow with arrows
- **Map** — geographic anchor with pinned data points

---

## 4. Script schema (YAML)

Your script feeds one slide-spec per slide. The `template` field selects from the library; `params` are template-specific.

```yaml
title: <Episode title>
voice_id: <ElevenLabs voice id>
brand:
  wordmark: dreamspace
  url: dream.space
  date_label: "live · April 23, 2026"
  embargo: "Embargo lifted 04.23.26 · 07:00 PDT"
slides:
  - id: open
    template: cold_open
    duration: 5
    narration: "Today, Space and Time launches Dreamspace…"
    params:
      eyebrow: "a Space and Time creation"
      wordmark: "dreamspace"
      tagline_words: ["Write", "an", "app.", "Render", "onchain."]

  - id: pitch
    template: prompt_to_app
    duration: 5.5
    narration: "Describe what you want to build, and Dreamspace generates a working app…"
    params:
      prompt_text: "build me a tipping app where my fans can pay me in stablecoins"
      output_type: phone
      output_data:
        title: "tip jar · live"
        amount: "$1,247"
        last_event: "▲ +$28 from anonymous · 2s ago"
        actions: [{label: "Tip $28", currency: "USDC"}, …]
        chain_line: "0xab12…f9c0 · base · <1¢ fee"

  - id: numbers
    template: by_the_numbers
    duration: 5.5
    narration: "In beta…"
    params:
      eyebrow: "▸ by the numbers"
      headline: "Beta proved the demand. Now it opens to everyone."
      stats:
        - {value: 34000, format: "comma", label: "apps built in beta", sub: "before public launch"}
        - {value: 20, format: "$Xm", label: "from M12, Microsoft's Venture Fund", sub: "led 2022 Series"}
        - {value: 140000, format: "comma", label: "students reached in Indonesia", sub: "AI labs + curriculum"}

  - id: stack
    template: stack_layers
    duration: 5.5
    narration: "One prompt. Five layers do the work."
    params:
      eyebrow: "▸ the stack"
      headline: "One prompt. Five layers do the work."
      layers:
        - {name: "Creator", desc: "describes the app in plain language", role: "input"}
        - {name: "Dreamspace", desc: "AI app builder · no-code · auditable smart contracts", role: "platform", highlight: true}
        - {name: "Azure AI Foundry", desc: "model orchestration · Azure OpenAI", role: "ai"}
        - {name: "Base", desc: "EVM L2 · sub-cent fees · sub-second blocks", role: "chain"}
        - {name: "Space and Time", desc: "verifiable data layer for onchain finance", role: "data"}

  - id: manifesto
    template: manifesto
    duration: 5.0
    narration: "When the data layer handles itself…"
    params:
      eyebrow: "▸ what changes"
      headline_a: "When the data layer"
      accent_phrase_a: "handles itself"
      headline_a_after: ","
      headline_b: "the only thing left is"
      accent_phrase_b: "what to make."
      beats:
        - {key: "No code", value: "Anyone with an idea can ship.", tag: "creator"}
        - {key: "Fully auditable", value: "Every smart contract is transparent onchain.", tag: "trust"}
        - {key: "Sub-cent fees", value: "Real businesses, day one, on Base.", tag: "economics"}
        - {key: "Verifiable data", value: "The same infrastructure that secures DeFi.", tag: "infra"}

  - id: launch
    template: launch_card
    duration: 4.0
    narration: "Live now at dream dot space."
    params:
      date_label: "live · April 23, 2026"
      headline: "Start building."
      url: "dream.space"
      partner_line: "Space and Time × M12 · Microsoft's Venture Fund · Base"
```

---

## 5. Audio integration

Each slide carries `narration` text. Your generator hits ElevenLabs with `narration` + `voice_id`, saves `audio/<slide-id>.wav`, and emits a Hyperframes `<audio>` element:

```html
<audio
  data-start="<slide-start-time>"
  data-duration="<slide-duration>"
  data-track-index="0"
  data-volume="1.0"
  src="audio/<slide-id>.wav"
></audio>
```

**Timing rule:** slide visual duration ≥ narration duration + 0.5s (breathing room). If narration runs long, extend `duration` to match. The generator should ffprobe the WAV after TTS and auto-extend if needed.

**Background music:** add one `<audio>` element on `data-track-index="1"` at `data-start="0"` covering the full composition, `data-volume="0.18"`. Pick a calm, dark synth bed. Lufs-normalize to -23 LUFS.

---

## 6. Files in this handoff

- `DESIGN_SYSTEM.md` — this document
- `Dreamspace Explainer.html` — reference render (open in browser, scrub timeline)
- `dreamspace.jsx` — full implementation of all 6 templates as React components
- `animations.jsx` — timeline primitives (Stage, Sprite, Easing, interpolate)

The JSX is the **source of truth** for exact pixel values. When in doubt, read it.

---

## 7. Migration to Hyperframes (production)

The reference is React+Babel via CDN. Your production renderer is Hyperframes, which wants HTML+GSAP. The mapping:

| Reference (React)              | Hyperframes (HTML)                         |
|---|---|
| `<Stage duration={30}>`        | `<div data-composition-id="…" data-duration="30">` |
| `<Sprite start={5} end={10}>`  | `<section data-start="5" data-duration="5">` |
| `useTime()` + interpolate      | GSAP timeline with `gsap.to()` keyed to a master timeline |
| Inline-style animated values   | GSAP-driven CSS variables on the section |
| Counter via `Math.floor(ease())` | GSAP `+=value` tween with `onUpdate` writing to DOM |

Ask your Claude Code agent to do this port one template at a time, starting with T1. Once T1 renders cleanly via `npx hyperframes render`, the others follow the same shape. The `/hyperframes` skill knows the exact data attributes and GSAP patterns Hyperframes expects.
