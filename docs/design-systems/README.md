# Design systems

Drop a folder here for each visual system you want the framework to know about. The studio + planner pick them up automatically — no code changes, no rebuild required.

## Folder shape

```
docs/design-systems/<theme-id>/
├── theme.json          ← required. Tokens, font families, preferences.
├── DESIGN_SYSTEM.md    ← optional. Full design DNA the planner reads.
├── reference.html      ← optional. Canonical render reference.
└── (anything else)     ← ignored by the loader. Keep JSX, mood boards,
                          spec files, mockups in the same folder.
```

The loader only looks at the direct child folders here, and only ones containing a `theme.json` are registered as themes. Everything else is left alone.

## Minimum theme.json

```json
{
  "id": "my-theme",
  "name": "My Theme",
  "tokens": {
    "colors": {
      "bg": "#0a0a0a",
      "fg": "#f0f0f0",
      "surface": "#15151f",
      "accent": "#7c3aed",
      "accent2": "#06b6d4",
      "accent3": "#FFB300",
      "muted": "#888888",
      "subtle": "#333344"
    },
    "fonts": {
      "display": "'Inter', sans-serif",
      "body": "'Inter', sans-serif",
      "mono": "'JetBrains Mono', monospace"
    },
    "motion": {
      "ease": "power3.out",
      "enterMs": 600,
      "staggerMs": 150
    }
  }
}
```

That's enough — the framework will use this palette and the planner will reference it.

## Richer themes

Themes get more powerful as you add fields:

- `description` — shown in the studio's theme picker tooltip.
- `fonts.googleFonts` — array of Google Fonts family slugs (e.g. `"Space Grotesk:wght@300;400;500"`). Auto-injected into the assembler's `<head>` so `tokens.fonts.display` actually has a face to use.
- `preferences.atmospheres` — array of atmosphere preset ids the planner should bias toward (`aurora`, `gradient-mesh`, `particle-field`, `noise-grain`, `radial-pulse`, `cosmic-dust`, `geometric-grid`, `flow-lines`, `studio-flat`).
- `preferences.transitions` — array of transition ids (`cut`, `fade`, `wipe-left`, `wipe-right`, `zoom-in`, `zoom-out`, `whip-pan`).
- `preferences.icons` — array of icon ids the planner should highlight in concept-callout items.
- `designSystemDoc` — path (relative to the theme folder) to a markdown design-system spec. The full file is appended to the planner's system prompt as theme-specific DNA, so the AI follows your palette rules, type hierarchy, motion physics, and any custom template specifications.
- `referenceRender` — path to a canonical HTML render reference.

## Activating a theme

In your project's `hyperframes.json`:

```json
{ "design": { "theme": "my-theme" } }
```

Or write a `DESIGN.md` and let it overlay the named theme — the resolver merges them so a project can pick a base theme and tweak individual hex codes via DESIGN.md.

## Project-local themes

If a theme is project-specific, drop it under `<project>/themes/<theme-id>/` instead of here. Project-local themes override repo-shipped ones of the same id.

## Mixing themes per scene

The planner can borrow from a theme that isn't the project's active theme. Two mechanisms:

1. **`scene.props.theme = "<other-theme-id>"`** — re-renders just that scene with the other theme's tokens (palette + fonts). Use sparingly — for moments where a different aesthetic earns the cut.
2. **Pull individual atmospheres / transitions / icons from another theme's preferences** — keeps the global palette but borrows the kinetic feel.

The planner sees a CONDENSED list of every other installed theme (id + 1-line description + their preferences) so it can reason about cross-pollination without dragging every theme's full design doc into context. The active theme's `DESIGN_SYSTEM.md` is the only one passed verbatim.

## Themes from Claude design (Remotion + Babel)

Claude design produces themes as **Remotion / Babel-standalone JSX** components — typically a `dreamspace.jsx` source plus an `animations.jsx` primitives file plus a reference HTML that mounts them via Babel-standalone. That's the input format.

Hyperframes renders **HTML + GSAP**, not React + Remotion. The bridge:

- **JSX is reference, not runtime.** Drop the JSX files into your theme folder (`docs/design-systems/<id>/`) so designers and the planner have the source of truth. The framework never executes them.
- **`DESIGN_SYSTEM.md` is the spec the planner reads.** Claude design ships this alongside the JSX. The planner uses it as source-of-truth for palette, type hierarchy, motion physics, and any custom template specifications.
- **Templates are HTML.** Per-theme template overrides ship at `<theme>/templates/<id>.html` (Mustache-style `{{prop}}` substitution + inline GSAP). Port from JSX manually or with a Claude Code agent — the JSX is the spec, the HTML is the production form. (Template-overrides subsystem coming in a follow-up PR; for now themes restyle existing templates via tokens + preferences.)
- **Reference render** — `Dreamspace Explainer.html` (or whatever you've named yours) is the canonical look. Open in a browser to scrub the timeline and verify what "production quality" means for the theme.

The porting workflow: Claude design generates a theme → drop into `docs/design-systems/<id>/` → write a `theme.json` → commit. The planner picks it up immediately. Templates can be ported lazily — your existing built-in templates carry the theme's palette + fonts via tokens until you replace them with theme-specific HTML.

## Cost notes

The planner uses Anthropic prompt caching aggressively:

- **Block 1**: the playbook (most stable, ~3-5k tokens). Cached across every video.
- **Block 2**: the active theme's `DESIGN_SYSTEM.md` + preferences. Cached per theme.
- **Block 3**: `DESIGN.md` + `DESIGN-ART.md` + `RESEARCH.md`. Cached per project.
- **Block 4**: fidelity rule + per-call hints. Always re-evaluated.

Iterative re-plans inside the 5-minute cache TTL pay ~10% of input cost on the cached prefix. Schema-correction retries and the hook critic both reuse the same prefix. Net: ~80% input-cost reduction on iterative work after the first plan.

## Currently shipped

- **dreamspace** — see `dreamspace/` for the full handoff (Remotion+Babel JSX reference, design system doc, reference render).
