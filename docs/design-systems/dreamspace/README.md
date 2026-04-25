# Quick start for Claude Code

You have a working Hyperframes + ElevenLabs production pipeline. This bundle gives Claude Code the **design language** to use inside that pipeline.

## What's in this folder

| File | Purpose |
|---|---|
| `DESIGN_SYSTEM.md` | The spec. Palette, type, motion physics, 6 template patterns, script schema. **This is the main artifact.** |
| `Dreamspace Explainer.html` | Open in a browser. The reference render — scrub through to see what "production quality" looks like. |
| `dreamspace.jsx` | Source for all 6 templates as React components. Pixel-exact values. The source of truth when the spec is ambiguous. |
| `animations.jsx` | Timeline primitives (Stage, Sprite, Easing, interpolate). Useful as a model for how slide-local time should work in your Hyperframes/GSAP version. |

## How to wire it into your Claude Code project

1. **Drop this folder** into your existing project as `design_system/`.
2. **Open Claude Code** in your project and run this prompt once:

   > Read `design_system/DESIGN_SYSTEM.md` and the three reference files in that folder. From now on, when I give you a script YAML, port the design language onto our existing Hyperframes+GSAP pipeline using the templates in section 2 of the spec. Match palette, type, motion timings, and composition rules exactly. Add new template files under `templates/<name>.html` only when the script needs something not in the library, and update the spec doc with the new template's parameters.

3. **Hand it a script.** From section 4 of the doc, paste the YAML schema and fill it in for your next video. Claude Code will:
   - Generate ElevenLabs narration per slide (using your existing TTS wrapper)
   - Emit Hyperframes HTML with the right `data-start` / `data-duration` / template parameters
   - Run `npx hyperframes lint` and `npx hyperframes render`

## What to keep iterating on

- **Build out your template library.** Every new video adds 0–1 new templates. After ~5 videos you'll have a complete vocabulary.
- **Lock the brand chrome.** Top-left wordmark, top-right index, bottom corner timestamps — these are the connective tissue across episodes. Don't let the agent skip them.
- **Audit the palette.** Every new color request should be challenged. UV / cyan / amber / paper is the whole world. Adding a new accent breaks visual coherence across the channel.

## When things drift

If a render starts looking "off," it's almost always one of these:
1. **Wrong easing.** Agent picked `easeInOut` where it should be `easeOutQuart`. Big numbers and hero entrances must use Quart.
2. **Headlines too wide.** Max 22ch. If a line wraps to 3+ lines, the agent ignored the rule.
3. **Color outside the token set.** Search the rendered HTML for hex codes — if you find any that aren't translations of the oklch tokens, reject the render.
4. **Missing chrome.** The top corners and bottom corners must be populated on every slide. No exceptions.

Pin those four checks into the lint step (Hyperframes lets you write custom rules) and you'll catch 90% of drift before it ships.
