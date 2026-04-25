import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type KeySource = "process" | "project-env" | "global-env" | "none";

export interface KeyStatus {
  hasKey: boolean;
  source: KeySource;
}

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

function readEnvFile(path: string, name: string): string | null {
  if (!existsSync(path)) return null;
  try {
    const env = parseDotenv(readFileSync(path, "utf-8"));
    return env[name] ?? null;
  } catch {
    return null;
  }
}

function quoteIfNeeded(value: string): string {
  if (/[\s"'`$\\]/.test(value)) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

const GLOBAL_ENV_PATH = () => join(homedir(), ".hyperframes", ".env");

/**
 * Read a key from env. Resolution order:
 *   1. process.env[name]
 *   2. <projectDir>/.env
 *   3. ~/.hyperframes/.env
 */
export function loadKey(name: string, projectDir?: string): string | null {
  const fromProcess = process.env[name];
  if (fromProcess) return fromProcess;
  if (projectDir) {
    const fromProject = readEnvFile(join(projectDir, ".env"), name);
    if (fromProject) return fromProject;
  }
  return readEnvFile(GLOBAL_ENV_PATH(), name);
}

/** Report whether a key is set and which layer it came from. Never returns the value. */
export function getKeyStatus(name: string, projectDir?: string): KeyStatus {
  if (process.env[name]) return { hasKey: true, source: "process" };
  if (projectDir && readEnvFile(join(projectDir, ".env"), name)) {
    return { hasKey: true, source: "project-env" };
  }
  if (readEnvFile(GLOBAL_ENV_PATH(), name)) {
    return { hasKey: true, source: "global-env" };
  }
  return { hasKey: false, source: "none" };
}

/**
 * Write or replace `name=value` in the given .env file, preserving surrounding
 * lines (other vars, comments, blank lines). Pass null to remove the entry.
 * File is created if missing with mode 0600.
 */
export function writeKeyToEnvFile(envPath: string, name: string, value: string | null): void {
  const existing = existsSync(envPath) ? readFileSync(envPath, "utf-8") : "";
  const lines = existing.length > 0 ? existing.split(/\r?\n/) : [];

  let replaced = false;
  const next: string[] = [];
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match && match[1] === name) {
      if (value != null) {
        next.push(`${name}=${quoteIfNeeded(value)}`);
        replaced = true;
      }
      continue;
    }
    next.push(line);
  }

  if (value != null && !replaced) {
    if (next.length > 0 && next[next.length - 1] !== "") next.push("");
    next.push(`${name}=${quoteIfNeeded(value)}`);
  }

  let out = next.join("\n");
  if (!out.endsWith("\n")) out += "\n";
  writeFileSync(envPath, out, { mode: 0o600 });
}
