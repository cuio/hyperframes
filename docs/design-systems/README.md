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
- **Templates are HTML+GSAP.** Per-theme template overrides ship at `<theme>/templates/<id>.html` — see the "Theme-shipped templates" section below for the format. Port from JSX manually or with a Claude Code agent — the JSX is the spec, the HTML is the production form.
- **Reference render** — `Dreamspace Explainer.html` (or whatever you've named yours) is the canonical look. Open in a browser to scrub the timeline and verify what "production quality" means for the theme.

The porting workflow: Claude design generates a theme → drop into `docs/design-systems/<id>/` → write a `theme.json` → port templates lazily as the planner picks them. The framework's built-in templates remain as the safety net so themes only need to ship templates where they can offer a meaningfully better look.

## Theme-shipped templates

A theme can ship its own scene templates that the planner and assembler treat as first-class members of the template catalog. Drop HTML files under `<theme>/templates/`:

```
docs/design-systems/<theme-id>/templates/
├── cold-open.html         ← required: the markup with {{prop}} substitution
├── cold-open.json         ← optional: metadata + propsSchema sidecar
├── manifesto.html
└── manifesto.json
```

Templates register with namespaced ids: `<theme-id>__<basename>` (e.g. `dreamspace__cold-open` — double-underscore so the id is safe to drop into CSS class selectors). They sit alongside built-in template ids in the planner's catalog, so the AI can pick them by name.

### Template HTML format

The template engine is a tight Mustache subset. Four primitives:

| Syntax | Meaning |
|---|---|
| `{{prop}}` | HTML-escaped value lookup. Dot paths supported (`{{tokens.colors.bg}}`). |
| `{{prop\|raw}}` | Unescaped — only for trusted markup. |
| `{{prop\|json}}` | `JSON.stringify`-safe for embedding inside `<script>`. |
| `{{#each items}}…{{this}}…{{/each}}` | Iterate an array. Inside the body, `{{this}}` is the item, `{{this.label}}` works on object items, `{{@index}}` is the 0-based position. |

**Always-available context** (the framework injects these regardless of props):

- `{{scene_id}}` — the stable id (`s01`, `s02`, ...)
- `{{template_id}}` — the namespaced template id
- `{{duration}}` — total scene duration in seconds (formatted to 2dp)
- `{{is_hook}}` — boolean
- `{{audio_src}}` — path to the synthesized narration WAV
- `{{tokens.colors.*}}`, `{{tokens.fonts.*}}`, `{{tokens.motion.*}}` — full token tree
- Aliases `{{colors.*}}`, `{{fonts.*}}`, `{{motion.*}}` for shorthand

**Required structure**: the root element must be `<div class="scene scene-{{template_id}}" id="{{scene_id}}" data-composition-id="{{scene_id}}" data-start="0" data-duration="{{duration}}">…</div>`. The framework relies on these data attributes to wire the timeline.

**Animations**: include an inline `<script>` that builds a paused GSAP timeline and registers it on `window.__timelines['{{scene_id}}']`. Use the theme's `tokens.motion.ease` so the motion physics match the rest of the theme. **Never use `repeat: -1`** — the deterministic capture engine seeks to exact frames, so all repeats must be finite (compute via `Math.ceil(TOTAL / cycleDur) - 1`).

### Template metadata sidecar

The `<basename>.json` file declares planner-facing metadata. Everything is optional but the more you provide, the smarter the planner picks:

```json
{
  "description": "Brand reveal hero with concentric rings + tagline cascade",
  "whenToUse": ["Opening scene of a video", "Episode intro / brand reveal"],
  "durationRange": { "min": 4, "max": 6 },
  "hookOnly": true,
  "propsSchema": {
    "type": "object",
    "properties": {
      "wordmark": { "type": "string", "description": "..." }
    },
    "required": ["wordmark"]
  },
  "exampleProps": { "wordmark": "dreamspace" }
}
```

If the sidecar is absent, the template still loads with a permissive default schema and a generic description — but the planner won't know when to pick it, so always ship the sidecar for production templates.

### Where the templates live in the runtime

When the studio API plans a script, it calls `resolveTemplateRegistry(projectDir)` which returns `[...BUILTIN_TEMPLATES, ...activeTheme.templates]`. That registry is passed to `planScript()` as `availableTemplates` (it shows up in the planner's tool catalog) AND to `assembleMaster()` as `templates` (so scene resolution finds the theme-shipped renderer).

The studio's SSR cache-watcher invalidates on file changes under `docs/design-systems/`, so dropping a new template HTML and regenerating picks it up without restart.

## Cost notes

The planner uses Anthropic prompt caching aggressively:

- **Block 1**: the playbook (most stable, ~3-5k tokens). Cached across every video.
- **Block 2**: the active theme's `DESIGN_SYSTEM.md` + preferences. Cached per theme.
- **Block 3**: `DESIGN.md` + `DESIGN-ART.md` + `RESEARCH.md`. Cached per project.
- **Block 4**: fidelity rule + per-call hints. Always re-evaluated.

Iterative re-plans inside the 5-minute cache TTL pay ~10% of input cost on the cached prefix. Schema-correction retries and the hook critic both reuse the same prefix. Net: ~80% input-cost reduction on iterative work after the first plan.

## Currently shipped

- **dreamspace** — full handoff in `dreamspace/` (Remotion+Babel JSX reference + `DESIGN_SYSTEM.md` + `reference.html`). Ships one Hyperframes template: `dreamspace__cold-open` (T1) — port the rest as needed.
