import {
  loadKey,
  getKeyStatus,
  writeKeyToEnvFile,
  type KeySource,
  type KeyStatus,
} from "../secrets/envKey.js";

const KEY_NAME = "ELEVENLABS_API_KEY";

export type ElevenLabsKeySource = KeySource;
export type ElevenLabsKeyStatus = KeyStatus;

export function loadElevenLabsKey(projectDir?: string): string | null {
  return loadKey(KEY_NAME, projectDir);
}

export function getElevenLabsKeyStatus(projectDir?: string): ElevenLabsKeyStatus {
  return getKeyStatus(KEY_NAME, projectDir);
}

export function writeElevenLabsKeyToEnvFile(envPath: string, value: string | null): void {
  writeKeyToEnvFile(envPath, KEY_NAME, value);
}

export const ELEVENLABS_KEY_NAME = KEY_NAME;
