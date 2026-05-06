# Catalog Reference

The HyperFrames catalog is a registry of pre-authored blocks, components, and full examples installable via the CLI:

```bash
npx hyperframes add <name>          # install one block or component
npx hyperframes catalog             # browse interactively
```

Use this reference when picking a block to install before authoring a scene from scratch — most asks have a closer-to-perfect catalog entry than the default empty composition.

## Blocks (44)

Self-contained scene templates. Each is a full `data-composition-id` HTML fragment with its own GSAP timeline, stylesheet, and asset hooks.

### Social and UI mockups

| Name                       | Use when                                                                |
| -------------------------- | ----------------------------------------------------------------------- |
| `instagram-follow`         | Social-platform UI overlay shows an Instagram follow / activity card.   |
| `tiktok-follow`            | Same idea for TikTok — useful for "we hit X followers" beats.           |
| `x-post`                   | Embed an X (Twitter) post card with avatar, handle, body, metrics.      |
| `reddit-post`              | Reddit post card with subreddit pill, title, body, vote/comment counts. |
| `spotify-card`             | Now-playing-style audio card.                                           |
| `macos-notification`       | macOS notification banner — "X just shipped Y" beats.                   |
| `app-showcase`             | Phone-frame app screenshot showcase with parallax.                      |
| `yt-lower-third`           | YouTube-style lower-third name card.                                    |
| `vpn-youtube-spot`         | VPN-sponsor-style YouTube ad spot block.                                |
| `blue-sweater-intro-video` | Person-in-frame intro reel with full-bleed video.                       |

### Hooks and openers

| Name                      | Use when                                                      |
| ------------------------- | ------------------------------------------------------------- |
| `apple-money-count`       | Apple-keynote-style counting-up money figure.                 |
| `north-korea-locked-down` | Map-driven geopolitical hook with locked-region overlay.      |
| `nyc-paris-flight`        | Flight-path map between two cities — story-of-a-trip openers. |
| `data-chart`              | Data-first hook with a single chart and one annotation.       |
| `flowchart`               | Horizontal flowchart for cause-and-effect explainers.         |

### Logo/outro

| Name           | Use when                                                           |
| -------------- | ------------------------------------------------------------------ |
| `logo-outro`   | Final scene — logo settles in with ambient glow.                   |
| `ui-3d-reveal` | 3D card reveal — tilted-stack-to-front motion for product reveals. |

### Single-effect transitions (between scenes)

These are CSS-only transitions you install per category and reference from a scene's `data-transition` attribute.

| Category    | Block name                | Energy |
| ----------- | ------------------------- | ------ |
| 3D          | `transitions-3d`          | High   |
| Blur        | `transitions-blur`        | Calm   |
| Cover       | `transitions-cover`       | Medium |
| Destruction | `transitions-destruction` | High   |
| Dissolve    | `transitions-dissolve`    | Calm   |
| Distortion  | `transitions-distortion`  | Medium |
| Grid        | `transitions-grid`        | Medium |
| Light       | `transitions-light`       | Medium |
| Mechanical  | `transitions-mechanical`  | Medium |
| Other       | `transitions-other`       | Mixed  |
| Push        | `transitions-push`        | Medium |
| Radial      | `transitions-radial`      | Medium |
| Scale       | `transitions-scale`       | Medium |

### Shader transitions (between scenes, WebGL)

These ship as separate blocks with self-contained shader sources. Heavier than CSS transitions but cinematic.

| Name                     | Look                                    |
| ------------------------ | --------------------------------------- |
| `chromatic-radial-split` | Radial split with chromatic aberration. |
| `cinematic-zoom`         | Push-in to next frame.                  |
| `cross-warp-morph`       | Calm morph between scenes.              |
| `domain-warp-dissolve`   | Dissolve via domain-warped noise.       |
| `flash-through-white`    | High-energy white flash.                |
| `glitch`                 | Datamosh glitch transition.             |
| `gravitational-lens`     | Lens-distortion warp.                   |
| `light-leak`             | Analog light-leak crossfade.            |
| `ridged-burn`            | Edges burn away as ridges.              |
| `ripple-waves`           | Ripple radiating from a focal point.    |
| `sdf-iris`               | SDF-driven iris reveal.                 |
| `swirl-vortex`           | Swirl-and-scale spin transition.        |
| `thermal-distortion`     | Heat-haze warp.                         |
| `whip-pan`               | Whip-pan with directional blur.         |

## Components (3)

Reusable layers that overlay any scene without owning the timeline.

| Name                 | Use when                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| `grain-overlay`      | Adds a film-grain texture over the whole composition. Pairs with warm-editorial / analog styles. |
| `grid-pixelate-wipe` | Grid-pixelate wipe transition that animates over a scene.                                        |
| `shimmer-sweep`      | Diagonal shimmer pass — best for highlighting metallic/jewel surfaces.                           |

## Examples (8)

Complete sample projects you can scaffold from for a starting point.

| Name            | What it shows                             |
| --------------- | ----------------------------------------- |
| `swiss-grid`    | Swiss-Pulse style preset in action.       |
| `vignelli`      | Velvet-Standard / Vignelli typography.    |
| `kinetic-type`  | Maximalist Type style with kinetic words. |
| `warm-grain`    | Warm editorial palette + grain overlay.   |
| `play-mode`     | Sandbox showing the player API.           |
| `product-promo` | Product-launch reel structure.            |
| `nyt-graph`     | Editorial chart-driven explainer.         |
| `decision-tree` | Branching flowchart explainer.            |

## How to apply

1. **Pick a block before scaffolding from empty.** If the user's brief matches a catalog entry, install it (`npx hyperframes add <name>`) and edit the inserted content rather than writing a scene from scratch.
2. **Read the catalog entry's docs** for full props/behavior: `docs/catalog/blocks/<name>.mdx` and `docs/catalog/components/<name>.mdx`.
3. **Mention the block by name** when the user is choosing — "this looks like a good fit for `apple-money-count`" reads better than "I'll build a counting-money scene from scratch."
4. **For transitions, install the category block once** (e.g. `transitions-blur`), then reference any of its transitions from `data-transition="..."` on scene wrappers.
