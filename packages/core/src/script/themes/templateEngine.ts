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

export function renderTemplate(html: string, ctx: TemplateContext): string {
  // Handle {{#each path}}…{{/each}} first so its body can also contain
  // variable substitutions that we resolve in the recursive pass.
  let out = html.replace(EACH_RE, (_, path: string, body: string) => {
    const arr = lookup(ctx, path);
    if (!Array.isArray(arr)) return "";
    return arr
      .map((item, i) =>
        renderTemplate(body, {
          ...ctx,
          this: item,
          "@index": i,
          "@first": i === 0,
          "@last": i === arr.length - 1,
        }),
      )
      .join("");
  });

  // Variable substitutions. Skip anything we already consumed in EACH_RE.
  out = out.replace(VAR_RE, (_, path: string, filter: string | undefined) => {
    const v = lookup(ctx, path);
    return applyFilter(v, filter);
  });

  return out;
}
