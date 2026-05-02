/**
 * CLI: extract a reference aesthetic profile from a video + images.
 *
 *   npx tsx scripts/extract-reference.ts <projectDir> \
 *     --video path/to/ref.mp4 \
 *     --images path/to/img1.jpg,path/to/img2.png \
 *     --intent "less polkadot, more editorial NYT"
 *
 * Persists `<projectDir>/.hyperframes/reference-profile.json`. The next
 * planner / visual-director run reads it and biases output toward it.
 *
 * Cost: ~$0.01-0.05 per extraction (Gemini Flash multimodal).
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import {
  extractReferenceProfile,
  REFERENCE_PROFILE_REL_PATH,
  type ReferenceProfile,
} from "../packages/core/src/script/referenceProfile.js";
import { loadGeminiKey } from "../packages/core/src/gemini/index.js";
import { BUILTIN_ATMOSPHERES, BUILTIN_TEMPLATES } from "../packages/core/src/script/index.js";
import { TREATMENT_IDS } from "../packages/core/src/script/templates/image-scene.js";

interface ParsedArgs {
  projectDir: string;
  videoPath?: string;
  imagePaths: string[];
  intent?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  let videoPath: string | undefined;
  const imagePaths: string[] = [];
  let intent: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "--video") {
      const next = argv[++i];
      if (typeof next === "string") videoPath = resolvePath(next);
    } else if (a === "--images") {
      const next = argv[++i];
      if (typeof next === "string") {
        for (const p of next.split(",")) {
          if (p.trim()) imagePaths.push(resolvePath(p.trim()));
        }
      }
    } else if (a === "--intent") {
      const next = argv[++i];
      if (typeof next === "string") intent = next;
    } else if (!a.startsWith("--")) {
      positional.push(a);
    }
  }
  if (positional.length === 0) {
    console.error(
      "Usage: tsx scripts/extract-reference.ts <projectDir> [--video FILE] [--images A,B,C] [--intent TEXT]",
    );
    process.exit(1);
  }
  return {
    projectDir: resolvePath(positional[0] ?? "."),
    ...(videoPath ? { videoPath } : {}),
    imagePaths,
    ...(intent ? { intent } : {}),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(args.projectDir)) {
    console.error(`Project does not exist: ${args.projectDir}`);
    process.exit(1);
  }

  const apiKey = loadGeminiKey(args.projectDir);
  if (!apiKey) {
    console.error("GEMINI_API_KEY not found. Add it to <project>/.env or ~/.hyperframes/.env.");
    process.exit(1);
  }

  console.log(`📁 Project: ${args.projectDir}`);
  if (args.videoPath) console.log(`🎬 Video: ${args.videoPath}`);
  if (args.imagePaths.length) console.log(`🖼  Images: ${args.imagePaths.length}`);
  if (args.intent) console.log(`💬 Intent: ${args.intent}`);
  console.log("");

  const start = Date.now();
  const knownAtmospheres = BUILTIN_ATMOSPHERES.map((a) => a.id);
  const knownTemplates = BUILTIN_TEMPLATES.map((t) => t.id);
  const knownTreatments = [...TREATMENT_IDS];

  console.log(
    `🧠 Calling Gemini Flash with ${knownAtmospheres.length} atmospheres + ${knownTemplates.length} templates in catalog…`,
  );
  const { profile, usage } = await extractReferenceProfile({
    apiKey,
    ...(args.videoPath ? { videoPath: args.videoPath } : {}),
    ...(args.imagePaths.length > 0 ? { imagePaths: args.imagePaths } : {}),
    ...(args.intent ? { userIntent: args.intent } : {}),
    knownAtmospheres,
    knownTemplates,
    knownTreatments,
  });
  console.log(
    `   ✓ profile returned (${((Date.now() - start) / 1000).toFixed(1)}s, ${usage.promptTokens}+${usage.outputTokens} toks)`,
  );
  console.log("");

  // Persist
  const outPath = join(args.projectDir, REFERENCE_PROFILE_REL_PATH);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(profile, null, 2) + "\n");
  console.log(`💾 Persisted → ${outPath}`);
  console.log("");

  printProfile(profile);
}

function printProfile(p: ReferenceProfile): void {
  console.log(`🎨 Vibe: ${p.vibe}`);
  console.log(`🎚  Energy: ${p.typographyEnergy} · Pacing: ${p.pacingDensity}`);
  console.log(`🎬 Motion: ${p.motionVibe}`);
  if (p.palette.length) {
    console.log(`🌈 Palette: ${p.palette.join(" ")}`);
  }
  if (p.recommendedAtmospheres.length) {
    console.log(`✅ Recommended atmospheres: ${p.recommendedAtmospheres.join(", ")}`);
  }
  if (p.avoidAtmospheres.length) {
    console.log(`🚫 Avoid atmospheres: ${p.avoidAtmospheres.join(", ")}`);
  }
  if (p.preferredTemplates.length) {
    console.log(`✅ Preferred templates: ${p.preferredTemplates.join(", ")}`);
  }
  if (p.avoidTemplates.length) {
    console.log(`🚫 Avoid templates: ${p.avoidTemplates.join(", ")}`);
  }
  if (p.treatmentBias) {
    console.log(`🎭 Treatment bias: ${p.treatmentBias}`);
  }
  if (p.rationale) {
    console.log("");
    console.log(`📝 Rationale:`);
    console.log(`   ${p.rationale}`);
  }
}

main().catch((err) => {
  console.error(`\n❌ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
});
