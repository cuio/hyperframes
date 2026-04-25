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

## Currently shipped

- **dreamspace** — see `dreamspace/` for the full handoff.
