/**
 * One-shot: switch a single scene to the `freeform` template, run the
 * freeform generator (Gemini Flash writes the scene HTML), persist the
 * result back into script.generated.json, and exit. The next
 * `hyperframes script assemble` will pick it up.
 *
 * Usage:
 *   tsx scripts/apply-freeform-scene.ts <projectDir> <sceneId>
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadGeminiKey } from "../packages/core/src/gemini/index.js";
import {
  generateFreeformScene,
  readFreeformCache,
  writeFreeformCache,
  FREEFORM_GENERATOR_VERSION,
  type FreeformCacheKey,
} from "../packages/core/src/script/templates/freeform/index.js";
import { CYBERLOFI } from "../packages/core/src/script/themes.js";
import { readPersistedProfile } from "../packages/core/src/script/referenceProfile.js";

async function main(): Promise<void> {
  const [projectArg, sceneId] = process.argv.slice(2);
  if (!projectArg || !sceneId) {
    console.error("Usage: tsx scripts/apply-freeform-scene.ts <projectDir> <sceneId>");
    process.exit(1);
  }
  const projectDir = resolve(projectArg);
  const apiKey = loadGeminiKey(projectDir);
  if (!apiKey) {
    console.error("GEMINI_API_KEY not found");
    process.exit(1);
  }
  const plannedPath = join(projectDir, "script.generated.json");
  const planned = JSON.parse(readFileSync(plannedPath, "utf-8")) as {
    scenes: Array<{
      id: string;
      text: string;
      template: string;
      props: Record<string, unknown>;
      hook?: boolean;
    }>;
  };
  const scene = planned.scenes.find((s) => s.id === sceneId);
  if (!scene) {
    console.error(`scene ${sceneId} not found`);
    process.exit(1);
  }

  const profile = readPersistedProfile(projectDir);
  const themeTokens = {
    bg: CYBERLOFI.colors.bg,
    fg: CYBERLOFI.colors.fg,
    accent: CYBERLOFI.colors.accent,
    accent2: CYBERLOFI.colors.accent2,
    fontDisplay: CYBERLOFI.fonts.display,
    fontMono: CYBERLOFI.fonts.mono,
  };
  const referenceProfile = profile
    ? {
        ...(profile.vibe ? { vibe: profile.vibe } : {}),
        ...(profile.palette ? { palette: profile.palette } : {}),
        ...(profile.typographyEnergy ? { typographyEnergy: profile.typographyEnergy } : {}),
        ...(profile.pacingDensity ? { pacingDensity: profile.pacingDensity } : {}),
        ...(profile.motionVibe ? { motionVibe: profile.motionVibe } : {}),
      }
    : undefined;

  const cacheKey: FreeformCacheKey = {
    narration: scene.text,
    sceneId: scene.id,
    referenceProfileShape: referenceProfile ?? {},
    themeTokens,
    generatorVersion: FREEFORM_GENERATOR_VERSION,
  };

  console.log(`📁 ${projectDir}`);
  console.log(`🎬 Scene ${sceneId}: "${scene.text}"`);
  console.log(`🧠 Asking Gemini Flash to generate freeform HTML…`);

  const cached = readFreeformCache(projectDir, cacheKey);
  let html: string;
  if (cached) {
    console.log(`   ✓ cache hit (${cached.html.length} bytes)`);
    html = cached.html;
  } else {
    const start = Date.now();
    const result = await generateFreeformScene({
      apiKey,
      sceneId: scene.id,
      narration: scene.text,
      ...(scene.hook ? { isHook: true } : {}),
      themeTokens,
      ...(referenceProfile ? { referenceProfile } : {}),
    });
    console.log(
      `   ✓ generated in ${((Date.now() - start) / 1000).toFixed(1)}s, ${result.generation.usage.promptTokens}+${result.generation.usage.outputTokens} toks, ${result.generation.html.length} bytes`,
    );
    if (result.rejectedFirstPass) {
      console.log(
        `   (first attempt rejected: ${result.rejectedFirstPass.violations.map((v) => v.rule).join(", ")} — retry succeeded)`,
      );
    }
    writeFreeformCache(projectDir, cacheKey, result.generation);
    html = result.generation.html;
  }

  // Mutate the scene: switch template + stamp generatedHtml so the
  // assembler emits the cached html via FREEFORM_TEMPLATE.render.
  scene.template = "freeform";
  scene.props = {
    ...(scene.props ?? {}),
    narration: scene.text,
    generatedHtml: html,
  };
  writeFileSync(plannedPath, JSON.stringify(planned, null, 2) + "\n");
  console.log(`💾 Wrote ${plannedPath} — scene ${sceneId} now uses template="freeform"`);
  console.log(
    `   Run \`hyperframes script assemble --project ${projectArg}\` to pick up the change.`,
  );
}

main().catch((err) => {
  console.error(`\n❌ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
});

void existsSync;
