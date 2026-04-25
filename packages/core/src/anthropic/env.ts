import {
  loadKey,
  getKeyStatus,
  writeKeyToEnvFile,
  type KeySource,
  type KeyStatus,
} from "../secrets/envKey.js";

const KEY_NAME = "ANTHROPIC_API_KEY";

export type AnthropicKeySource = KeySource;
export type AnthropicKeyStatus = KeyStatus;

export function loadAnthropicKey(projectDir?: string): string | null {
  return loadKey(KEY_NAME, projectDir);
}

export function getAnthropicKeyStatus(projectDir?: string): AnthropicKeyStatus {
  return getKeyStatus(KEY_NAME, projectDir);
}

export function writeAnthropicKeyToEnvFile(envPath: string, value: string | null): void {
  writeKeyToEnvFile(envPath, KEY_NAME, value);
}

export const ANTHROPIC_KEY_NAME = KEY_NAME;
