import type { Hono } from "hono";
import { existsSync, readFileSync, unlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import {
  analyzeImage,
  findById,
  ingestImage,
  readManifest,
  removeEntry,
  upsertEntry,
  writeManifest,
  type ImageEntry,
  type ImageRole,
} from "../../images/index.js";
import { GeminiError, loadGeminiKey, DEFAULT_GEMINI_MODEL } from "../../gemini/index.js";
import { CostLogger, loggerSink } from "../../telemetry/cost.js";
import { OpsLogger, opsFireAndForget } from "../../telemetry/ops.js";
import type { StudioApiAdapter } from "../types.js";

const VALID_ROLES: ReadonlyArray<ImageRole> = ["hero", "subject", "atmosphere", "graphic"];
const ALLOWED_EXTS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
  ".heif",
  ".tiff",
  ".tif",
  ".gif",
  ".bmp",
  ".avif",
]);
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

/**
 * Studio image-management routes. Mirrors the CLI verbs but over HTTP so
 * the Studio Images tab can drop-zone upload, grid-display, and inline-edit
 * metadata (role, description, tags, focalPoint) without leaving the
 * browser.
 */
export function registerImagesRoutes(api: Hono, adapter: StudioApiAdapter): void {
  // List everything in the manifest.
  api.get("/projects/:id/images", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    return c.json(readManifest(project.dir));
  });

  // Stream the underlying image file. The Studio uses this for the grid
  // thumbnail src (relative to /api/...). Cache aggressively because the
  // file changes only when re-ingested under the same id.
  api.get("/projects/:id/images/:imageId/file", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const entry = findById(readManifest(project.dir), c.req.param("imageId"));
    if (!entry) return c.json({ error: "image not found" }, 404);
    const abs = join(project.dir, entry.src);
    if (!existsSync(abs)) return c.json({ error: "file missing on disk" }, 404);
    const bytes = readFileSync(abs);
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=300",
      },
    });
  });

  // Upload one image via multipart/form-data (one file per request keeps
  // error handling clean). Studio sends N requests in parallel for bulk.
  api.post("/projects/:id/images", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);

    let form: FormData;
    try {
      form = await c.req.formData();
    } catch (err) {
      console.warn("[images] POST invalid form body", err);
      return c.json({ error: "expected multipart/form-data with a 'file' field" }, 400);
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      return c.json({ error: "missing 'file' field" }, 400);
    }
    if (file.size === 0) {
      return c.json({ error: "empty file" }, 400);
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return c.json({ error: `file too large (${file.size}B; max ${MAX_UPLOAD_BYTES}B)` }, 413);
    }
    const ext = extname(file.name).toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) {
      return c.json(
        {
          error: `unsupported file extension '${ext}'. Allowed: ${[...ALLOWED_EXTS].join(", ")}`,
        },
        415,
      );
    }

    // Stage the upload to a tmp file so sharp can read from disk (its
    // streaming API is heavier; for a one-shot CLI-style import the
    // simplest path is fine).
    const stagingDir = join(tmpdir(), `hf-image-upload-${randomBytes(6).toString("hex")}`);
    mkdirSync(stagingDir, { recursive: true });
    const stagedPath = join(stagingDir, basename(file.name) || `upload${ext}`);
    const ops = new OpsLogger(project.dir);
    const start = Date.now();
    try {
      writeFileSync(stagedPath, Buffer.from(await file.arrayBuffer()));
      const { entry, replaced } = await ingestImage(stagedPath, { projectDir: project.dir });
      opsFireAndForget(ops, {
        op: "images.upload",
        message: `${entry.id} (${entry.width}×${entry.height}, ${(entry.bytes / 1024).toFixed(0)}KB)`,
        wallMs: Date.now() - start,
        meta: { id: entry.id, replaced, originalName: file.name, originalBytes: file.size },
      });

      // Kick off Gemini analysis fire-and-forget. Mark the entry pending
      // synchronously so the studio shows a spinner from the moment the
      // upload response lands. If GEMINI_API_KEY is missing or the call
      // fails, the entry's analysisStatus flips to "failed" with a reason.
      const withPending = markAnalysisPending(project.dir, entry.id);
      void runImageAnalysis(project.dir, withPending ?? entry).catch((err) => {
        void ops.logError("images.analyze", err, { id: entry.id });
      });

      return c.json({ ok: true, entry: withPending ?? entry, replaced });
    } catch (err) {
      void ops.logError("images.upload", err, { originalName: file.name });
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    } finally {
      try {
        unlinkSync(stagedPath);
      } catch {
        /* ignore */
      }
    }
  });

  // Manually re-run Gemini analysis for an existing image. Useful if the
  // user added GEMINI_API_KEY after the original upload, or wants to
  // refresh stale priors after editing a description.
  api.post("/projects/:id/images/:imageId/analyze", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const entry = findById(readManifest(project.dir), c.req.param("imageId"));
    if (!entry) return c.json({ error: "image not found" }, 404);

    const pending = markAnalysisPending(project.dir, entry.id);
    try {
      const updated = await runImageAnalysis(project.dir, pending ?? entry);
      return c.json({ ok: true, entry: updated });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const failedEntry = markAnalysisFailed(project.dir, entry.id, reason);
      return c.json({ ok: false, entry: failedEntry, error: reason }, 502);
    }
  });

  // Patch metadata (role / description / tags / focalPoint). Body is a
  // partial — only the keys present are updated.
  api.patch("/projects/:id/images/:imageId", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);

    let body: {
      role?: ImageRole | null;
      description?: string;
      tags?: string[];
      focalPoint?: { x: number; y: number };
    };
    try {
      body = (await c.req.json()) as typeof body;
    } catch (err) {
      console.warn("[images] PATCH invalid JSON", err);
      return c.json({ error: "invalid JSON body" }, 400);
    }

    const manifest = readManifest(project.dir);
    const entry = findById(manifest, c.req.param("imageId"));
    if (!entry) return c.json({ error: "image not found" }, 404);

    const next: ImageEntry = { ...entry };
    if (body.role === null) {
      next.role = null;
    } else if (typeof body.role === "string") {
      const r = body.role.toLowerCase() as ImageRole;
      if (!(VALID_ROLES as readonly string[]).includes(r)) {
        return c.json({ error: `role must be one of ${VALID_ROLES.join(", ")}` }, 400);
      }
      next.role = r;
    }
    if (typeof body.description === "string") {
      next.description = body.description;
    }
    if (Array.isArray(body.tags)) {
      next.tags = body.tags.filter((t): t is string => typeof t === "string");
    }
    if (body.focalPoint) {
      const { x, y } = body.focalPoint;
      if (
        typeof x !== "number" ||
        typeof y !== "number" ||
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        x < 0 ||
        x > 1 ||
        y < 0 ||
        y > 1
      ) {
        return c.json({ error: "focalPoint.x and y must be numbers in 0..1" }, 400);
      }
      next.focalPoint = { x, y };
    }

    writeManifest(project.dir, upsertEntry(manifest, next));
    opsFireAndForget(new OpsLogger(project.dir), {
      op: "images.patch",
      message: `${entry.id} updated`,
      meta: {
        id: entry.id,
        roleChanged: body.role !== undefined,
        focalChanged: body.focalPoint !== undefined,
      },
    });
    return c.json({ ok: true, entry: next });
  });

  // Remove an image from the manifest. The bytes on disk are also
  // unlinked so the project's assets/ stays clean, but errors are
  // ignored — the manifest is the source of truth.
  api.delete("/projects/:id/images/:imageId", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const id = c.req.param("imageId");
    const manifest = readManifest(project.dir);
    const entry = findById(manifest, id);
    if (!entry) return c.json({ error: "image not found" }, 404);

    const abs = join(project.dir, entry.src);
    try {
      if (existsSync(abs)) unlinkSync(abs);
    } catch {
      /* best effort — manifest update is the canonical step */
    }
    writeManifest(project.dir, removeEntry(manifest, id));
    opsFireAndForget(new OpsLogger(project.dir), {
      op: "images.remove",
      message: `${id} removed from manifest`,
    });
    return c.json({ ok: true });
  });
}

// ── Analysis helpers ───────────────────────────────────────────────────────
//
// These run AFTER an upload response has been sent, so failures here must
// never throw out of an HTTP handler. The route owner already wraps the
// fire-and-forget call in `.catch(...)` for telemetry.

/**
 * Patch a single entry's analysis status in the manifest. Read-modify-write
 * with no merge logic — analysis fields are owned by the analyzer alone.
 * Returns the patched entry, or null if the id has been removed in the
 * meantime (race with DELETE).
 */
function patchEntryAnalysis(
  projectDir: string,
  imageId: string,
  patch: Partial<ImageEntry>,
): ImageEntry | null {
  const manifest = readManifest(projectDir);
  const existing = findById(manifest, imageId);
  if (!existing) return null;
  const next: ImageEntry = { ...existing, ...patch };
  writeManifest(projectDir, upsertEntry(manifest, next));
  return next;
}

function markAnalysisPending(projectDir: string, imageId: string): ImageEntry | null {
  return patchEntryAnalysis(projectDir, imageId, {
    analysisStatus: "pending",
    analysisError: undefined,
  });
}

function markAnalysisFailed(
  projectDir: string,
  imageId: string,
  reason: string,
): ImageEntry | null {
  return patchEntryAnalysis(projectDir, imageId, {
    analysisStatus: "failed",
    analysisError: reason.slice(0, 240),
  });
}

/**
 * Read the image bytes off disk, call Gemini, write the result back to the
 * manifest. Logs cost + ops. Throws on failure so the caller (the upload
 * route's fire-and-forget) can record an ops error — but ALSO patches the
 * manifest with analysisStatus: "failed" so the studio surfaces the
 * problem to the user without an out-of-band error toast.
 */
async function runImageAnalysis(projectDir: string, entry: ImageEntry): Promise<ImageEntry> {
  const apiKey = loadGeminiKey();
  if (!apiKey) {
    const failed = markAnalysisFailed(
      projectDir,
      entry.id,
      "GEMINI_API_KEY is not set — skipping analysis. Configure it in the studio Settings tab.",
    );
    return failed ?? entry;
  }

  const abs = join(projectDir, entry.src);
  if (!existsSync(abs)) {
    const failed = markAnalysisFailed(
      projectDir,
      entry.id,
      `Image file missing on disk at ${entry.src}`,
    );
    return failed ?? entry;
  }
  const bytes = readFileSync(abs);

  const ops = new OpsLogger(projectDir);
  const onCostEvent = loggerSink(new CostLogger(projectDir));
  const start = Date.now();
  try {
    const { analyzed, usage } = await analyzeImage(apiKey, bytes, "image/webp");
    onCostEvent(
      "images.analyze",
      {
        kind: "gemini",
        model: DEFAULT_GEMINI_MODEL,
        promptTokens: usage.promptTokens,
        outputTokens: usage.outputTokens,
      },
      Date.now() - start,
      { id: entry.id, role: analyzed.role, treatment: analyzed.suggestedTreatment },
    );
    const updated = patchEntryAnalysis(projectDir, entry.id, {
      // Don't overwrite a user-typed role — analyzer is a soft prior, not
      // a source of truth. Same for description / tags.
      role: entry.role ?? analyzed.role,
      vibe: analyzed.vibe,
      suggestedTreatment: analyzed.suggestedTreatment,
      retentionStrengthAtAttachment: analyzed.retentionStrengthAtAttachment,
      analysisRationale: analyzed.rationale,
      analysisStatus: "complete",
      analysisError: undefined,
      analyzedAt: new Date().toISOString(),
    });
    opsFireAndForget(ops, {
      op: "images.analyze",
      message: `${entry.id} → ${analyzed.role} · ${analyzed.suggestedTreatment ?? "(no treatment)"} · retention ${analyzed.retentionStrengthAtAttachment}/10`,
      wallMs: Date.now() - start,
      meta: {
        id: entry.id,
        role: analyzed.role,
        treatment: analyzed.suggestedTreatment,
        retention: analyzed.retentionStrengthAtAttachment,
      },
    });
    return updated ?? entry;
  } catch (err) {
    const reason =
      err instanceof GeminiError
        ? `Gemini error: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    const failed = markAnalysisFailed(projectDir, entry.id, reason);
    void ops.logError("images.analyze", err, { id: entry.id });
    return failed ?? entry;
  }
}
