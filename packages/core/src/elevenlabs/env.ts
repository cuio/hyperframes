import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const KEY_NAME = "ELEVENLABS_API_KEY";

function parseDotenv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function readEnvFile(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    const env = parseDotenv(readFileSync(path, "utf-8"));
    return env[KEY_NAME] ?? null;
  } catch {
    return null;
  }
}

export type ElevenLabsKeySource = "process" | "project-env" | "global-env" | "none";

export interface ElevenLabsKeyStatus {
  hasKey: boolean;
  source: ElevenLabsKeySource;
}

/**
 * Look up the ElevenLabs API key. Resolution order:
 *   1. process.env.ELEVENLABS_API_KEY
 *   2. <projectDir>/.env (if projectDir provided)
 *   3. ~/.hyperframes/.env
 */
export function loadElevenLabsKey(projectDir?: string): string | null {
  const fromProcess = process.env[KEY_NAME];
  if (fromProcess) return fromProcess;

  if (projectDir) {
    const fromProject = readEnvFile(join(projectDir, ".env"));
    if (fromProject) return fromProject;
  }

  return readEnvFile(join(homedir(), ".hyperframes", ".env"));
}

/**
 * Report whether a key is set and which layer it came from. The actual key
 * value is intentionally not returned — callers only need presence + source.
 */
export function getElevenLabsKeyStatus(projectDir?: string): ElevenLabsKeyStatus {
  if (process.env[KEY_NAME]) return { hasKey: true, source: "process" };
  if (projectDir && readEnvFile(join(projectDir, ".env"))) {
    return { hasKey: true, source: "project-env" };
  }
  if (readEnvFile(join(homedir(), ".hyperframes", ".env"))) {
    return { hasKey: true, source: "global-env" };
  }
  return { hasKey: false, source: "none" };
}

/**
 * Write or replace ELEVENLABS_API_KEY in the given .env file, preserving
 * surrounding lines (other vars, comments, blank lines). Creates the file
 * if missing. Pass null to remove the entry.
 */
export function writeElevenLabsKeyToEnvFile(envPath: string, value: string | null): void {
  const existing = existsSync(envPath) ? readFileSync(envPath, "utf-8") : "";
  const lines = existing.length > 0 ? existing.split(/\r?\n/) : [];

  let replaced = false;
  const next: string[] = [];
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match && match[1] === KEY_NAME) {
      if (value != null) {
        next.push(`${KEY_NAME}=${quoteIfNeeded(value)}`);
        replaced = true;
      }
      // null → drop the line
      continue;
    }
    next.push(line);
  }

  if (value != null && !replaced) {
    if (next.length > 0 && next[next.length - 1] !== "") next.push("");
    next.push(`${KEY_NAME}=${quoteIfNeeded(value)}`);
  }

  // Preserve trailing newline.
  let out = next.join("\n");
  if (!out.endsWith("\n")) out += "\n";
  writeFileSync(envPath, out, { mode: 0o600 });
}

function quoteIfNeeded(value: string): string {
  // Quote values containing whitespace, quotes, or special shell chars to
  // keep the file safe when sourced.
  if (/[\s"'`$\\]/.test(value)) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

export const ELEVENLABS_KEY_NAME = KEY_NAME;
