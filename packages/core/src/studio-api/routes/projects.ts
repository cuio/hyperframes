import type { Hono } from "hono";
import type { StudioApiAdapter } from "../types.js";
import { walkDir } from "../helpers/safePath.js";

export function registerProjectRoutes(api: Hono, adapter: StudioApiAdapter): void {
  // List all projects
  api.get("/projects", async (c) => {
    const projects = await adapter.listProjects();
    return c.json({ projects });
  });

  // Create a new project
  api.post("/projects", async (c) => {
    if (!adapter.createProject) {
      return c.json({ error: "createProject not supported by this server" }, 501);
    }
    let body: { id?: string; title?: string };
    try {
      body = (await c.req.json()) as { id?: string; title?: string };
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const rawId = (body.id ?? "").trim();
    if (!rawId) return c.json({ error: "id is required" }, 400);
    const id = rawId
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!id) return c.json({ error: "id must contain a-z 0-9 -" }, 400);
    try {
      const project = await adapter.createProject({ id, title: body.title });
      return c.json({ project });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 500);
    }
  });

  // Resolve session to project (multi-project mode)
  api.get("/resolve-session/:sessionId", async (c) => {
    if (!adapter.resolveSession) {
      return c.json({ error: "not available" }, 404);
    }
    const { sessionId } = c.req.param();
    const result = await adapter.resolveSession(sessionId);
    if (!result) return c.json({ error: "Session not found" }, 404);
    return c.json(result);
  });

  // Project file tree
  api.get("/projects/:id", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const files = walkDir(project.dir);
    return c.json({ id: project.id, files });
  });
}
