import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import {
  ingestImage,
  readManifest,
  writeManifest,
  findById,
  upsertEntry,
  removeEntry,
  type ImageEntry,
  type ImageRole,
} from "@hyperframes/core";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { c } from "../ui/colors.js";
import { resolveProject } from "../utils/project.js";

const VALID_ROLES: ReadonlyArray<ImageRole> = ["hero", "subject", "atmosphere", "graphic"];

function pad(s: string, w: number): string {
  return s.length >= w ? s : s + " ".repeat(w - s.length);
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1_048_576) return `${(n / 1024).toFixed(0)}KB`;
  return `${(n / 1_048_576).toFixed(1)}MB`;
}

function fmtAspect(width: number, height: number): string {
  const r = width / Math.max(1, height);
  if (Math.abs(r - 16 / 9) < 0.02) return "16:9";
  if (Math.abs(r - 9 / 16) < 0.02) return "9:16";
  if (Math.abs(r - 1) < 0.02) return "1:1";
  if (Math.abs(r - 4 / 3) < 0.02) return "4:3";
  return r.toFixed(2);
}

function isRole(value: string): value is ImageRole {
  return (VALID_ROLES as readonly string[]).includes(value);
}

// ── add subcommand ─────────────────────────────────────────────────────────
const addCommand = defineCommand({
  meta: {
    name: "add",
    description: "Resize, normalize to webp, and add image(s) to assets/images.json",
  },
  args: {
    paths: {
      type: "positional",
      description: "Source image file paths (jpg/png/heic/webp)",
      required: true,
    },
    dir: { type: "string", description: "Project directory" },
    "max-long-edge": {
      type: "string",
      description: "Resize so the long edge is at most this many pixels (default: 3840)",
    },
    quality: {
      type: "string",
      description: "WebP quality 1-100 (default: 85)",
    },
  },
  async run({ args, rawArgs }) {
    const project = resolveProject(args.dir as string | undefined);
    // Citty's `positional` only captures the first; the rest land in
    // rawArgs after the option flags. Filter to looks-like-an-image-path
    // to avoid sucking in --dir's value or other flag operands.
    const IMAGE_EXTS = /\.(jpg|jpeg|png|webp|heic|heif|tiff|tif|gif|bmp|avif)$/i;
    const sources: string[] = [];
    for (const arg of rawArgs ?? []) {
      if (arg.startsWith("-")) continue;
      if (!IMAGE_EXTS.test(arg)) continue;
      sources.push(resolve(arg));
    }
    if (sources.length === 0) {
      console.error(
        "hyperframes images add: pass at least one image path (jpg/png/webp/heic/etc).",
      );
      process.exit(1);
    }

    const maxLongEdge = args["max-long-edge"]
      ? parseInt(args["max-long-edge"] as string, 10)
      : undefined;
    const quality = args.quality ? parseInt(args.quality as string, 10) : undefined;

    console.log(
      c.accent("◆") + ` Importing ${sources.length} image${sources.length === 1 ? "" : "s"}…`,
    );
    let success = 0;
    for (const src of sources) {
      if (!existsSync(src)) {
        console.log("  " + c.error("✗") + " " + src + c.dim(" — not found"));
        continue;
      }
      try {
        const result = await ingestImage(src, {
          projectDir: project.dir,
          maxLongEdge,
          quality,
        });
        success++;
        const e = result.entry;
        const note = result.replaced ? c.warn(" (replaced)") : "";
        console.log(
          "  " +
            c.success("✓") +
            " " +
            pad(e.id, 22) +
            c.dim(
              `${e.width}×${e.height}  ${fmtAspect(e.width, e.height)}  ${fmtBytes(e.bytes)}  `,
            ) +
            c.dim("dom ") +
            e.dominantColor +
            note,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log("  " + c.error("✗") + " " + src + c.dim(" — " + message));
      }
    }
    console.log();
    console.log(
      c.dim(
        "  Edit metadata (role / description / focal) with " +
          c.bold("hyperframes images edit <id>") +
          " or in the Studio Images tab.",
      ),
    );
    if (success === 0) process.exit(1);
  },
});

// ── list subcommand ────────────────────────────────────────────────────────
const listCommand = defineCommand({
  meta: { name: "list", description: "List all images in the project's manifest" },
  args: {
    dir: { type: "string", description: "Project directory" },
    json: { type: "boolean", description: "Output as JSON", default: false },
  },
  async run({ args }) {
    const project = resolveProject(args.dir as string | undefined);
    const manifest = readManifest(project.dir);
    if (args.json) {
      console.log(JSON.stringify(manifest, null, 2));
      return;
    }
    if (manifest.images.length === 0) {
      console.log(c.bold(`Images — ${project.name}`));
      console.log(c.dim("\n  No images imported yet."));
      console.log(
        c.dim(
          "  Add images with " +
            c.bold("hyperframes images add <paths>") +
            " or drop them in the Studio.",
        ),
      );
      return;
    }
    console.log(c.bold(`Images — ${project.name}`) + c.dim(` (${manifest.images.length})\n`));
    const idWidth = Math.max(8, ...manifest.images.map((i) => i.id.length)) + 2;
    for (const e of manifest.images) {
      const role = e.role ? c.accent(pad(e.role, 12)) : c.warn(pad("(no role)", 12));
      const desc =
        e.description.trim().length > 0
          ? e.description.length > 60
            ? e.description.slice(0, 57) + "…"
            : e.description
          : c.dim("(no description)");
      console.log(
        "  " +
          pad(e.id, idWidth) +
          role +
          c.dim(pad(`${e.width}×${e.height}`, 11)) +
          c.dim(pad(fmtAspect(e.width, e.height), 6)) +
          c.dim(pad(e.dominantColor, 10)) +
          " " +
          desc,
      );
    }
  },
});

// ── edit subcommand ────────────────────────────────────────────────────────
const editCommand = defineCommand({
  meta: {
    name: "edit",
    description: "Edit role / description / tags / focalPoint for an image (opens $EDITOR)",
  },
  args: {
    id: { type: "positional", description: "Image id (from `images list`)", required: true },
    dir: { type: "string", description: "Project directory" },
    role: {
      type: "string",
      description: "Set role non-interactively (hero/subject/atmosphere/graphic)",
    },
    description: { type: "string", description: "Set description non-interactively" },
    tags: { type: "string", description: "Set tags as a comma-separated list" },
    focal: { type: "string", description: "Set focal point as 'x,y' in 0..1, e.g. '0.45,0.38'" },
  },
  async run({ args }) {
    const project = resolveProject(args.dir as string | undefined);
    const manifest = readManifest(project.dir);
    const id = args.id as string;
    const entry = findById(manifest, id);
    if (!entry) {
      console.error(`Image '${id}' not found in manifest. Run \`hyperframes images list\`.`);
      process.exit(1);
    }

    let next: ImageEntry = { ...entry };

    // Non-interactive flags take precedence over the editor flow.
    let nonInteractive = false;
    if (args.role) {
      const r = (args.role as string).toLowerCase();
      if (!isRole(r)) {
        console.error(`Invalid role '${r}'. Must be one of: ${VALID_ROLES.join(", ")}`);
        process.exit(1);
      }
      next.role = r;
      nonInteractive = true;
    }
    if (args.description !== undefined) {
      next.description = args.description as string;
      nonInteractive = true;
    }
    if (args.tags !== undefined) {
      next.tags = (args.tags as string)
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      nonInteractive = true;
    }
    if (args.focal) {
      const [xs, ys] = (args.focal as string).split(",");
      const x = Number(xs);
      const y = Number(ys);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
        console.error(`Invalid --focal '${args.focal}'. Use 'x,y' with both in 0..1.`);
        process.exit(1);
      }
      next.focalPoint = { x, y };
      nonInteractive = true;
    }

    if (!nonInteractive) {
      // Editor flow — open $EDITOR with a tiny YAML-ish stub the user fills in.
      next = await editInteractive(next);
    }

    const updated = upsertEntry(manifest, next);
    writeManifest(project.dir, updated);
    console.log(c.success("✓") + " " + c.bold(id) + c.dim(" updated"));
  },
});

async function editInteractive(entry: ImageEntry): Promise<ImageEntry> {
  const tmp = mkdtempSync(join(tmpdir(), "hf-image-edit-"));
  const file = join(tmp, `${entry.id}.txt`);
  const stub = [
    "# Edit the values below. Lines starting with # are ignored.",
    `# Image: ${entry.id}  (${entry.width}×${entry.height}, ${entry.dominantColor})`,
    "#",
    `# Roles: hero | subject | atmosphere | graphic   (or leave blank)`,
    "",
    `role: ${entry.role ?? ""}`,
    `description: ${entry.description.replace(/\n/g, " ")}`,
    `tags: ${entry.tags.join(", ")}`,
    `focal_x: ${entry.focalPoint.x}`,
    `focal_y: ${entry.focalPoint.y}`,
    "",
  ].join("\n");
  writeFileSync(file, stub);

  const editor = process.env.EDITOR ?? process.env.VISUAL ?? "vi";
  const result = spawnSync(editor, [file], { stdio: "inherit" });
  if (result.error || result.status !== 0) {
    rmSync(tmp, { recursive: true, force: true });
    throw new Error(`Editor "${editor}" exited with status ${result.status ?? "error"}.`);
  }

  const edited = readFileSync(file, "utf-8");
  rmSync(tmp, { recursive: true, force: true });

  const updated: ImageEntry = { ...entry };
  for (const rawLine of edited.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "role") {
      if (value === "" || value === "(none)") updated.role = null;
      else if (isRole(value.toLowerCase())) updated.role = value.toLowerCase() as ImageRole;
    } else if (key === "description") {
      updated.description = value;
    } else if (key === "tags") {
      updated.tags = value
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    } else if (key === "focal_x") {
      const n = Number(value);
      if (Number.isFinite(n)) updated.focalPoint = { ...updated.focalPoint, x: clamp01(n) };
    } else if (key === "focal_y") {
      const n = Number(value);
      if (Number.isFinite(n)) updated.focalPoint = { ...updated.focalPoint, y: clamp01(n) };
    }
  }
  return updated;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

// ── remove subcommand ──────────────────────────────────────────────────────
const removeCommand = defineCommand({
  meta: { name: "remove", description: "Remove an image from the manifest (file remains on disk)" },
  args: {
    id: { type: "positional", description: "Image id to remove", required: true },
    dir: { type: "string", description: "Project directory" },
  },
  async run({ args }) {
    const project = resolveProject(args.dir as string | undefined);
    const manifest = readManifest(project.dir);
    const id = args.id as string;
    if (!findById(manifest, id)) {
      console.error(`Image '${id}' not found.`);
      process.exit(1);
    }
    writeManifest(project.dir, removeEntry(manifest, id));
    console.log(c.success("✓") + " " + c.bold(id) + c.dim(" removed from manifest"));
  },
});

// ── parent images command ──────────────────────────────────────────────────
export const examples: Example[] = [
  ["Import a few images", "hyperframes images add hero1.jpg hero2.png atmosphere.webp"],
  ["List the manifest", "hyperframes images list"],
  [
    "Tag an image's role + description",
    "hyperframes images edit cowboy --role hero --description 'Lone figure under flying birds'",
  ],
  ["Set focal point", "hyperframes images edit cowboy --focal 0.45,0.38"],
];

export default defineCommand({
  meta: {
    name: "images",
    description: "Manage image assets used by the visual director",
  },
  subCommands: { add: addCommand, list: listCommand, edit: editCommand, remove: removeCommand },
  async run() {
    // No-op when no subcommand — citty prints help. Guard against the
    // double-run-after-subcommand quirk handled in costs.ts.
    const argv = process.argv.slice(2);
    const idx = argv.indexOf("images");
    if (idx !== -1 && ["add", "list", "edit", "remove"].includes(argv[idx + 1] ?? "")) return;
    console.log("Run `hyperframes images --help` for available subcommands.");
  },
});
