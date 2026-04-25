import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const FILES = ["DESIGN.md", "design.md", "Design.md"];

/**
 * Read a project's design brief if one exists. Looks for DESIGN.md in the
 * project root. Returns null when no file is found or readable. Truncates
 * very long files so the planner prompt stays bounded.
 */
export function loadDesignBrief(projectDir: string, maxChars = 8000): string | null {
  for (const name of FILES) {
    const path = join(projectDir, name);
    if (!existsSync(path)) continue;
    try {
      const raw = readFileSync(path, "utf-8");
      if (!raw.trim()) return null;
      return raw.length > maxChars ? raw.slice(0, maxChars) + "\n\n[…truncated]" : raw;
    } catch {
      return null;
    }
  }
  return null;
}
