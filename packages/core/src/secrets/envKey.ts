import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { atomicWriteFileSync } from "../internal/atomicWrite.js";

export type KeySource = "process" | "project-env" | "global-env" | "none";

export interface KeyStatus {
  hasKey: boolean;
  source: KeySource;
}

function readFileIfExists(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

function unescapeQuoted(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "\\" && i + 1 < value.length) {
      const next = value[i + 1];
      if (
        next === "\\" ||
        next === '"' ||
        next === "'" ||
        next === "n" ||
        next === "r" ||
        next === "t"
      ) {
        if (next === "n") out += "\n";
        else if (next === "r") out += "\r";
        else if (next === "t") out += "\t";
        else out += next;
        i++;
        continue;
      }
    }
    out += ch;
  }
  return out;
}

function parseDotenv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      const wasDouble = value.startsWith('"');
      value = value.slice(1, -1);
      if (wasDouble) value = unescapeQuoted(value);
    }
    out[key] = value;
  }
  return out;
}

function readEnvFile(path: string, name: string): string | null {
  const content = readFileIfExists(path);
  if (content == null) return null;
  try {
    return parseDotenv(content)[name] ?? null;
  } catch {
    return null;
  }
}

function quoteIfNeeded(value: string): string {
  if (/[\s"'`$\\#]/.test(value) || value === "") {
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
 *
 * Empty-string values are treated as unset at every layer. This avoids passing
 * an empty key downstream (which would produce a confusing 401 from the
 * provider rather than the explicit "key missing" error path).
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
 * Write is atomic (temp file + rename) so a crash mid-write cannot corrupt the
 * file. Parent directory is created with 0700 if missing. File is mode 0600.
 */
export function writeKeyToEnvFile(envPath: string, name: string, value: string | null): void {
  const existing = readFileIfExists(envPath) ?? "";
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
  if (out.length > 0 && !out.endsWith("\n")) out += "\n";
  atomicWriteFileSync(envPath, out, { mode: 0o600, dirMode: 0o700 });
}
