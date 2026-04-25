import { describe, it, expect } from "vitest";
import { renderTemplate, TemplateRenderError, MAX_RENDER_ITERATIONS } from "./templateEngine.js";

describe("renderTemplate basics", () => {
  it("substitutes simple {{var}} with HTML escaping", () => {
    expect(renderTemplate("hi {{name}}", { name: "<world>" })).toBe("hi &lt;world&gt;");
  });

  it("returns empty string for missing variables", () => {
    expect(renderTemplate("[{{missing}}]", {})).toBe("[]");
  });

  it("supports dot-path lookup", () => {
    expect(renderTemplate("{{theme.colors.bg}}", { theme: { colors: { bg: "#000" } } })).toBe(
      "#000",
    );
  });

  it("supports |raw filter (no escaping)", () => {
    expect(renderTemplate("{{html|raw}}", { html: "<b>x</b>" })).toBe("<b>x</b>");
  });

  it("supports |json filter and escapes </ for <script> safety", () => {
    expect(renderTemplate("{{data|json}}", { data: { x: "</script>" } })).toBe(
      `{"x":"\\u003c/script>"}`,
    );
  });

  it("iterates {{#each}} arrays", () => {
    const tpl = "{{#each items}}[{{@index}}:{{this}}]{{/each}}";
    expect(renderTemplate(tpl, { items: ["a", "b", "c"] })).toBe("[0:a][1:b][2:c]");
  });

  it("supports object items inside #each via this.<key>", () => {
    const tpl = "{{#each items}}<li>{{this.label}}</li>{{/each}}";
    expect(renderTemplate(tpl, { items: [{ label: "A" }, { label: "B" }] })).toBe(
      "<li>A</li><li>B</li>",
    );
  });

  it("returns empty body when iteration target is not an array", () => {
    expect(renderTemplate("[{{#each x}}NO{{/each}}]", { x: 5 })).toBe("[]");
  });
});

describe("renderTemplate guards", () => {
  it("throws when iteration count exceeds the cap", () => {
    const big = new Array(MAX_RENDER_ITERATIONS + 100).fill("x");
    expect(() => renderTemplate("{{#each items}}.{{/each}}", { items: big })).toThrow(
      TemplateRenderError,
    );
  });

  it("does not blow up on a benign large array within the cap", () => {
    const arr = new Array(100).fill(1);
    const out = renderTemplate("{{#each items}}.{{/each}}", { items: arr });
    expect(out).toHaveLength(100);
  });
});
