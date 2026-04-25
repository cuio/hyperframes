import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SETTINGS_FILE = "hyperframes.json";

export interface TtsProjectSettings {
  defaultVoiceId: string | null;
}

function readJson(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Read TTS settings from <projectDir>/hyperframes.json. Looks for a top-level
 * `tts` object. Returns nulls when the file or fields are missing.
 */
export function readTtsSettings(projectDir: string): TtsProjectSettings {
  const json = readJson(join(projectDir, SETTINGS_FILE));
  const tts = (json?.tts ?? null) as { defaultVoiceId?: unknown } | null;
  const id = tts?.defaultVoiceId;
  return { defaultVoiceId: typeof id === "string" && id.length > 0 ? id : null };
}

/**
 * Convenience: just the default voice id, for callers that don't need the
 * full settings shape.
 */
export function readDefaultVoiceId(projectDir: string): string | null {
  return readTtsSettings(projectDir).defaultVoiceId;
}

/**
 * Merge a partial TTS settings update into hyperframes.json. Creates the file
 * if missing. Pass `defaultVoiceId: null` (or empty string) to clear it.
 */
export function writeTtsSettings(
  projectDir: string,
  patch: Partial<TtsProjectSettings>,
): TtsProjectSettings {
  const path = join(projectDir, SETTINGS_FILE);
  const json = readJson(path) ?? {};
  const tts =
    typeof json.tts === "object" && json.tts !== null
      ? ({ ...(json.tts as Record<string, unknown>) } as Record<string, unknown>)
      : {};

  if (Object.prototype.hasOwnProperty.call(patch, "defaultVoiceId")) {
    if (patch.defaultVoiceId == null || patch.defaultVoiceId === "") {
      delete tts.defaultVoiceId;
    } else {
      tts.defaultVoiceId = patch.defaultVoiceId;
    }
  }

  json.tts = tts;
  writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
  return readTtsSettings(projectDir);
}
