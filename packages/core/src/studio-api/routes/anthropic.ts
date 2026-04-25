import type { Hono } from "hono";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StudioApiAdapter } from "../types.js";
import { getAnthropicKeyStatus, writeAnthropicKeyToEnvFile } from "../../anthropic/index.js";

export function registerAnthropicRoutes(api: Hono, adapter: StudioApiAdapter): void {
  // Status only — never returns the value.
  api.get("/projects/:id/anthropic/key", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    return c.json(getAnthropicKeyStatus(project.dir));
  });

  // Persist a key to <project>/.env, ensure .gitignore covers it.
  api.put("/projects/:id/anthropic/key", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);

    let body: { value?: string | null };
    try {
      body = (await c.req.json()) as { value?: string | null };
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const raw = typeof body.value === "string" ? body.value.trim() : null;
    const value = raw && raw.length > 0 ? raw : null;
    try {
      writeAnthropicKeyToEnvFile(join(project.dir, ".env"), value);
      ensureGitignoreCovers(project.dir, ".env");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
    return c.json(getAnthropicKeyStatus(project.dir));
  });
}

function ensureGitignoreCovers(projectDir: string, entry: string): void {
  const gitignorePath = join(projectDir, ".gitignore");
  let content = "";
  try {
    if (existsSync(gitignorePath)) content = readFileSync(gitignorePath, "utf-8");
  } catch {
    return;
  }
  const lines = content.split(/\r?\n/);
  if (lines.some((l) => l.trim() === entry || l.trim() === `/${entry}`)) return;
  const trailingNl = content.length === 0 || content.endsWith("\n");
  try {
    writeFileSync(gitignorePath, (trailingNl ? content : content + "\n") + `${entry}\n`);
  } catch {
    /* best-effort */
  }
}
