import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { Template, TemplateRenderContext } from "../templates/types.js";
import { renderTemplate } from "./templateEngine.js";

/**
 * Optional sidecar metadata for a theme-shipped template. Lives next to
 * the .html file as <id>.json. All fields are optional — a missing
 * sidecar still produces a working template with sensible defaults.
 */
interface TemplateSidecar {
  description?: string;
  whenToUse?: string[];
  durationRange?: { min?: number; max?: number };
  hookOnly?: boolean;
  /** JSON-Schema-style props block. Defaults to a permissive object. */
  propsSchema?: Record<string, unknown>;
  /** Sample props payload the studio could use to render a preview. */
  exampleProps?: Record<string, unknown>;
}

/**
 * Scan <theme-folder>/templates/*.html and return Template objects ready
 * to merge into BUILTIN_TEMPLATES. Each .html may have a sibling .json
 * file carrying metadata; if missing, the template is created with
 * defaults (permissive props schema, 4-7s duration range).
 *
 * Template ids are namespaced as `<theme-id>__<file-basename>` to avoid
 * collisions with built-ins. e.g. `dreamspace/templates/cold-open.html`
 * registers as id `dreamspace__cold-open`. Double-underscore so the id
 * survives use as a CSS class identifier (a dot would be parsed as a
 * class separator and silently break the template's scoped styles).
 */
export function loadThemeTemplates(themeFolder: string, themeId: string): Template[] {
  const templatesDir = join(themeFolder, "templates");
  if (!existsSync(templatesDir)) return [];
  let entries: string[] = [];
  try {
    entries = readdirSync(templatesDir);
  } catch {
    return [];
  }
  const templates: Template[] = [];
  for (const name of entries) {
    if (extname(name).toLowerCase() !== ".html") continue;
    const filePath = join(templatesDir, name);
    let isFile = false;
    try {
      isFile = statSync(filePath).isFile();
    } catch {
      continue;
    }
    if (!isFile) continue;
    const baseName = basename(name, ".html");
    const id = `${themeId}__${baseName}`;
    const html = safeRead(filePath);
    if (!html) continue;
    const sidecar = readSidecar(join(templatesDir, `${baseName}.json`));
    templates.push(buildTemplate(id, html, sidecar));
  }
  return templates;
}

function safeRead(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

function readSidecar(path: string): TemplateSidecar {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    if (parsed && typeof parsed === "object") return parsed as TemplateSidecar;
  } catch {
    /* malformed sidecar is treated as absent — no crash */
  }
  return {};
}

function buildTemplate(id: string, html: string, sidecar: TemplateSidecar): Template {
  const description =
    sidecar.description ?? `${id} — theme-shipped template (no description provided)`;
  const whenToUse = Array.isArray(sidecar.whenToUse) ? sidecar.whenToUse : [];
  const durationRange = {
    min: sidecar.durationRange?.min ?? 3,
    max: sidecar.durationRange?.max ?? 9,
  };
  const propsSchema =
    sidecar.propsSchema && typeof sidecar.propsSchema === "object"
      ? sidecar.propsSchema
      : ({ type: "object", properties: {}, additionalProperties: true } as Record<string, unknown>);
  return {
    id,
    description,
    whenToUse,
    propsSchema,
    durationRange,
    hookOnly: sidecar.hookOnly === true,
    render(props: Record<string, unknown>, ctx: TemplateRenderContext): string {
      // Build the substitution context. Anything in `props` is exposed at
      // top level; framework values are exposed under stable names.
      const context = {
        ...props,
        scene_id: ctx.sceneId,
        template_id: id,
        duration: ctx.durationSeconds.toFixed(2),
        is_hook: ctx.isHook,
        audio_src: ctx.audioSrc ?? "",
        tokens: ctx.tokens,
        // Convenience aliases so themes can write {{colors.bg}} too.
        colors: ctx.tokens.colors,
        fonts: ctx.tokens.fonts,
        motion: ctx.tokens.motion,
      };
      return renderTemplate(html, context);
    },
  };
}
