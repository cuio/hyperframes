/**
 * Tiny Mustache-style template engine for theme-shipped templates.
 * Supports the minimum that lets a theme designer port a Remotion JSX
 * component to HTML+GSAP without losing the loop / interpolation / token
 * access they had in JSX. Not a full Mustache implementation — explicitly
 * scoped to the four primitives 90% of templates need:
 *
 *   {{prop}}                  → HTML-escaped value lookup (dot-path supported)
 *   {{prop|raw}}              → unescaped (use only for trusted markup)
 *   {{prop|json}}             → JSON.stringify-safe for embedding in JS
 *   {{prop|attr}}             → HTML-attribute-escaped (= same as default)
 *   {{tokens.colors.bg}}      → dot-path through any object in context
 *   {{#each items}}…{{/each}} → iterate an array; inside the body
 *                                {{this}}        is the current item
 *                                {{this.label}}  works for object items
 *                                {{@index}}      is the 0-based position
 *
 * That's it. No conditionals, no helpers, no partials. If a theme needs
 * more, port the template by hand or contribute a richer engine.
 */

export type TemplateContext = Record<string, unknown>;

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

/**
 * Embed-safe JSON: escapes "</" so a JSON value inside a <script> tag can't
 * close the script context. Anthropic / OpenAI prompt-caching SDKs use the
 * same trick.
 */
function escapeJsonForScript(v: unknown): string {
  return JSON.stringify(v).replace(/</g, "\\u003c");
}

function lookup(ctx: TemplateContext, path: string): unknown {
  if (path === "this") return ctx.this;
  return path.split(".").reduce<unknown>((cur, key) => {
    if (cur == null || typeof cur !== "object") return undefined;
    return (cur as Record<string, unknown>)[key];
  }, ctx);
}

function applyFilter(v: unknown, filter: string | undefined): string {
  if (v == null) return "";
  if (filter === "json") return escapeJsonForScript(v);
  if (filter === "raw") return typeof v === "string" ? v : String(v);
  // default + attr both escape; HTML attribute escaping is a superset of
  // text escaping that includes quotes — handled by the same map.
  const s = typeof v === "string" ? v : String(v);
  return escapeHtml(s);
}

const EACH_RE = /\{\{#each\s+([\w.@]+)\s*\}\}([\s\S]*?)\{\{\/each\}\}/g;
const VAR_RE = /\{\{([@\w.]+)(?:\|(\w+))?\}\}/g;

/**
 * Hard caps to keep a malicious or buggy sidecar from blowing the stack or
 * memory. A real production template needs nowhere near these limits — most
 * port from JSX with depth ≤2 and output well under a megabyte.
 */
export const MAX_RENDER_DEPTH = 8;
export const MAX_RENDER_OUTPUT_BYTES = 4 * 1024 * 1024;
export const MAX_RENDER_ITERATIONS = 50_000;

export class TemplateRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateRenderError";
  }
}

interface RenderState {
  depth: number;
  iterations: { count: number };
}

function renderInternal(html: string, ctx: TemplateContext, state: RenderState): string {
  if (state.depth > MAX_RENDER_DEPTH) {
    throw new TemplateRenderError(
      `Template recursion exceeded ${MAX_RENDER_DEPTH} levels — refusing to render. ` +
        `Nest {{#each}} blocks shallower or pre-flatten the data.`,
    );
  }

  let out = html.replace(EACH_RE, (_, path: string, body: string) => {
    const arr = lookup(ctx, path);
    if (!Array.isArray(arr)) return "";
    const pieces: string[] = [];
    for (let i = 0; i < arr.length; i++) {
      state.iterations.count++;
      if (state.iterations.count > MAX_RENDER_ITERATIONS) {
        throw new TemplateRenderError(
          `Template iteration count exceeded ${MAX_RENDER_ITERATIONS} — refusing to render. ` +
            `Reduce array sizes or unroll the loop.`,
        );
      }
      pieces.push(
        renderInternal(
          body,
          {
            ...ctx,
            this: arr[i],
            "@index": i,
            "@first": i === 0,
            "@last": i === arr.length - 1,
          },
          { ...state, depth: state.depth + 1 },
        ),
      );
    }
    return pieces.join("");
  });

  out = out.replace(VAR_RE, (_, path: string, filter: string | undefined) => {
    const v = lookup(ctx, path);
    return applyFilter(v, filter);
  });

  if (out.length > MAX_RENDER_OUTPUT_BYTES) {
    throw new TemplateRenderError(
      `Template output exceeded ${MAX_RENDER_OUTPUT_BYTES} bytes (${out.length}). ` +
        `Cap the data fed in or split the template.`,
    );
  }

  return out;
}

export function renderTemplate(html: string, ctx: TemplateContext): string {
  return renderInternal(html, ctx, { depth: 0, iterations: { count: 0 } });
}
