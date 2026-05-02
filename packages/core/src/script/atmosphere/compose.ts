/**
 * Composable atmosphere layers — the next-gen atmosphere system.
 *
 * Today, each atmosphere is a fixed preset (`aurora`, `gradient-mesh`,
 * `cosmic-dust`, …) with one bundled render function. That's clean for
 * the lookup table but rigid for users who want "soft gradient + grain
 * + slow vertical drift" without adopting a single preset's full look.
 *
 * Composable atmospheres let the user — or the reference profile — name
 * a stack of layers that get rendered together:
 *
 *     compose("editorial-grit", [
 *       getLayer("flat-bg"),
 *       getLayer("noise-grain"),
 *       getLayer("slow-vertical-drift"),
 *     ])
 *
 * Each layer is a thin AtmospherePreset that paints ONE thing. Stacking
 * them produces a richer composition without any new render code — the
 * compose helper just joins their HTML output.
 *
 * Design constraints:
 *   1. **Fully backward-compatible** — every existing AtmospherePreset
 *      already qualifies as a layer (single-layer compositions). Nothing
 *      shipped today needs to change.
 *   2. **Pure CSS** — same rule as the legacy presets. No GSAP timelines,
 *      no JS in atmosphere layers (the runtime budget belongs to scene
 *      content).
 *   3. **Selector-scoped** — every layer must scope its CSS to
 *      `#${ctx.sceneId}` so two compositions on the same scene don't
 *      collide.
 *
 * This module ships the composition primitive + two opinionated default
 * compositions (`clean-fade`, `editorial-grit`) that demonstrate the
 * pattern. Adding new compositions in user themes is a one-liner:
 * theme.json's `preferences.atmospheres` accepts composition ids.
 */

import { BUILTIN_ATMOSPHERES, getAtmosphere } from "./builtin.js";
import type { AtmosphereContext, AtmospherePreset } from "./types.js";

export interface AtmosphereComposition extends AtmospherePreset {
  /** The ordered layer ids that make up this composition. Useful for the
   *  studio's atmosphere debugger and for the planner's prompt context. */
  readonly layers: ReadonlyArray<string>;
}

/**
 * Compose multiple existing atmosphere presets into a single
 * AtmospherePreset. The returned preset's `render(ctx)` produces the
 * concatenated HTML of every layer, in the order given.
 *
 * Layers are applied bottom-up (first layer is furthest behind). All
 * layers share the same `ctx` so they reuse the same scene id and theme
 * tokens — keeps the visual cohesion tight.
 *
 * @param id  Composite id, exported in BUILTIN_COMPOSITIONS so the planner
 *            and theme registry can reference it by name.
 * @param description  Surfaced to the planner; explain what the stack does.
 * @param layerIds  Ordered list of single-layer atmosphere ids. Unknown ids
 *            are skipped with a warning rather than crashing the render.
 */
export function compose(
  id: string,
  description: string,
  layerIds: ReadonlyArray<string>,
): AtmosphereComposition {
  // Resolve layers eagerly so a typo throws at module load, not at first
  // render. We resolve via getAtmosphere (the live lookup) so user-defined
  // layers added at runtime can also participate.
  const resolved = layerIds
    .map((lid) => {
      const layer = getAtmosphere(lid);
      if (!layer) {
        console.warn(`[atmosphere/compose] unknown layer id "${lid}" in composition "${id}"`);
      }
      return { lid, layer };
    })
    .filter((x): x is { lid: string; layer: AtmospherePreset } => x.layer != null);

  return {
    id,
    description,
    layers: resolved.map((r) => r.lid),
    render(ctx: AtmosphereContext): string {
      // Join with a separator that's harmless in HTML but readable when
      // someone inspects the rendered output. Each layer already wraps
      // its CSS + HTML inside its own scope.
      return resolved.map((r) => r.layer.render(ctx)).join("\n<!-- layer -->\n");
    },
  };
}

/**
 * Built-in compositions. These are explicitly NOT in `BUILTIN_ATMOSPHERES`
 * (the legacy single-layer registry) — they live alongside it so studio
 * code can detect "is this a composition or a leaf?" by membership.
 *
 * Adding a new composition: append a `compose(...)` entry. No other code
 * changes needed; the assembler resolves atmospheres via
 * `resolveAtmosphereOrComposition()` below.
 */
export const BUILTIN_COMPOSITIONS: ReadonlyArray<AtmosphereComposition> = [
  compose(
    "clean-fade",
    "Subtle gradient mesh + faint noise grain. The cleanest non-flat look — no patterns, no movement-heavy elements. Default for editorial / NYT-style explainers.",
    ["gradient-mesh", "noise-grain"],
  ),
  compose(
    "editorial-grit",
    "Flat brand color + heavy noise grain. Documentary-paper feel. Use for serious data stories and human-subject reels where motion would distract.",
    ["studio-flat", "noise-grain"],
  ),
  compose(
    "cinematic-glow",
    "Aurora gradient + radial pulse, no grain. Big mood for hooks and outros without becoming busy. Skips dotty patterns intentionally.",
    ["aurora", "radial-pulse"],
  ),
];

/**
 * Resolve an atmosphere id to a renderable preset. Looks first in the
 * compositions list (so a user can override a leaf id with a composition
 * of the same name), then in the legacy single-layer registry.
 *
 * Returns null when the id is unknown — callers fall back to the
 * template-default atmosphere.
 */
export function resolveAtmosphereOrComposition(id: string): AtmospherePreset | null {
  const composition = BUILTIN_COMPOSITIONS.find((c) => c.id === id);
  if (composition) return composition;
  return getAtmosphere(id) ?? null;
}

/**
 * All atmosphere ids the planner is allowed to suggest — single layers
 * plus compositions. Exported so the reference profile extractor and the
 * studio's atmosphere picker stay in lockstep.
 */
export function listAllAtmosphereIds(): string[] {
  const layerIds = BUILTIN_ATMOSPHERES.map((a) => a.id);
  const compositionIds = BUILTIN_COMPOSITIONS.map((c) => c.id);
  return [...layerIds, ...compositionIds];
}
