import {
  loadKey,
  getKeyStatus,
  writeKeyToEnvFile,
  type KeySource,
  type KeyStatus,
} from "../secrets/envKey.js";

/**
 * Gemini API key loader. Mirrors the Anthropic env loader so the studio
 * key panel can present both keys with the same UX.
 *
 * Looked-up names in priority order:
 *   1. process.env.GEMINI_API_KEY
 *   2. <project>/.env GEMINI_API_KEY
 *   3. ~/.config/hyperframes/global.env GEMINI_API_KEY
 *
 * Google's docs sometimes use GOOGLE_API_KEY for the same key — we accept
 * the canonical GEMINI_API_KEY here and let users alias if needed. Keeping
 * to one name avoids the "I set the wrong env var" debugging trap.
 */

const KEY_NAME = "GEMINI_API_KEY";

export type GeminiKeySource = KeySource;
export type GeminiKeyStatus = KeyStatus;

export function loadGeminiKey(projectDir?: string): string | null {
  return loadKey(KEY_NAME, projectDir);
}

export function getGeminiKeyStatus(projectDir?: string): GeminiKeyStatus {
  return getKeyStatus(KEY_NAME, projectDir);
}

export function writeGeminiKeyToEnvFile(envPath: string, value: string | null): void {
  writeKeyToEnvFile(envPath, KEY_NAME, value);
}

export const GEMINI_KEY_NAME = KEY_NAME;
