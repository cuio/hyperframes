import { describe, it, expect } from "vitest";
import { validateFreeformHtml, VALIDATOR_RULES } from "./validator.js";

const SCENE_ID = "s07";
const ctx = { sceneId: SCENE_ID };

const validHtml = (overrides: { extraScript?: string; extraStyle?: string } = {}): string => {
  const extraStyle = overrides.extraStyle ?? "";
  const extraScript = overrides.extraScript ?? "";
  return [
    `<style>`,
    `  #${SCENE_ID} { position: absolute; inset: 0; background: #000; color: #fff; }`,
    `  #${SCENE_ID} .word { font-size: 96px; }`,
    extraStyle,
    `</style>`,
    `<div id="${SCENE_ID}" data-composition-id="${SCENE_ID}" data-scene-id="${SCENE_ID}" data-duration="4">`,
    `  <div class="word">HELLO</div>`,
    `</div>`,
    `<script>`,
    `  (function(){`,
    `    const tl = gsap.timeline({ paused: true });`,
    `    tl.to('#${SCENE_ID} .word', { opacity: 1, duration: 0.4 });`,
    `    window.__timelines = window.__timelines || {};`,
    `    window.__timelines['${SCENE_ID}'] = tl;`,
    `  })();`,
    extraScript,
    `</script>`,
  ].join("\n");
};

describe("validateFreeformHtml — happy path", () => {
  it("accepts a well-formed scene", () => {
    const result = validateFreeformHtml(validHtml(), ctx);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.html).toBeDefined();
  });

  it("returns the canonicalized html (collapsed blank lines)", () => {
    const html = validHtml() + "\n\n\n\n\n"; // trailing whitespace + 5 newlines
    const result = validateFreeformHtml(html, ctx);
    expect(result.ok).toBe(true);
    // No more than 2 consecutive newlines anywhere
    expect(result.html).not.toMatch(/\n{3,}/);
  });

  it("accepts an alternate wrapper attribute order (data-composition-id before id)", () => {
    const html = validHtml().replace(
      `<div id="${SCENE_ID}" data-composition-id="${SCENE_ID}"`,
      `<div data-composition-id="${SCENE_ID}" id="${SCENE_ID}"`,
    );
    const result = validateFreeformHtml(html, ctx);
    expect(result.ok).toBe(true);
  });
});

describe("validateFreeformHtml — outer wrapper", () => {
  it("rejects when the wrapper id doesn't match the scene id", () => {
    const html = validHtml().replace(`id="${SCENE_ID}"`, `id="wrong"`);
    const result = validateFreeformHtml(html, ctx);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.rule === "outer-wrapper")).toBe(true);
  });

  it("rejects when there's no wrapper at all", () => {
    const html = `<style>#${SCENE_ID} { color: red; }</style><script>window.__timelines['${SCENE_ID}'] = gsap.timeline({paused:true});</script>`;
    const result = validateFreeformHtml(html, ctx);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.rule === "outer-wrapper")).toBe(true);
  });
});

describe("validateFreeformHtml — forbidden tags + attrs", () => {
  it("rejects <iframe>", () => {
    const html = validHtml().replace(
      `<div class="word">HELLO</div>`,
      `<div class="word">HELLO</div><iframe src="https://evil"></iframe>`,
    );
    const result = validateFreeformHtml(html, ctx);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.rule === "forbidden-tag")).toBe(true);
  });

  it("rejects external <script src=...>", () => {
    const html = validHtml({
      extraScript: `</script><script src="https://attacker.example/evil.js"></script><script>`,
    });
    const result = validateFreeformHtml(html, ctx);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.rule === "external-script")).toBe(true);
  });

  it("rejects <link rel=stylesheet> via the link tag block", () => {
    const html = validHtml().replace(
      `<style>`,
      `<link rel="stylesheet" href="https://attacker.example/evil.css" /><style>`,
    );
    const result = validateFreeformHtml(html, ctx);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.rule === "forbidden-tag")).toBe(true);
  });

  it("rejects onclick and onerror attributes", () => {
    const html = validHtml().replace(
      `<div class="word">HELLO</div>`,
      `<div class="word" onclick="alert(1)" onerror="evil()">HELLO</div>`,
    );
    const result = validateFreeformHtml(html, ctx);
    expect(result.ok).toBe(false);
    const forbiddenAttr = result.violations.filter((v) => v.rule === "forbidden-attr");
    expect(forbiddenAttr.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects javascript: URLs in attributes", () => {
    const html = validHtml().replace(
      `<div class="word">HELLO</div>`,
      `<a href="javascript:alert(1)">link</a><div class="word">HELLO</div>`,
    );
    const result = validateFreeformHtml(html, ctx);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.rule === "forbidden-attr-value")).toBe(true);
  });

  it("rejects <form> + form-related tags", () => {
    const html = validHtml().replace(
      `<div class="word">HELLO</div>`,
      `<form><input type="text" /></form><div class="word">HELLO</div>`,
    );
    const result = validateFreeformHtml(html, ctx);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.rule === "forbidden-tag")).toBe(true);
  });
});

describe("validateFreeformHtml — timeline registration", () => {
  it("rejects when no window.__timelines registration is present", () => {
    // Strip ALL window.__timelines lines (both the init + the assignment).
    const html = validHtml().replace(/.*window\.__timelines.*\n?/g, "");
    const result = validateFreeformHtml(html, ctx);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.rule === "missing-timeline-registration")).toBe(true);
  });

  it("rejects when the timeline is registered for the wrong scene id", () => {
    const html = validHtml().replace(
      `window.__timelines['${SCENE_ID}']`,
      `window.__timelines['otherscene']`,
    );
    const result = validateFreeformHtml(html, ctx);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.rule === "missing-timeline-registration")).toBe(true);
  });
});

describe("validateFreeformHtml — CSS scope", () => {
  it("rejects unscoped selectors in <style>", () => {
    const html = validHtml({
      extraStyle: `\n.global-class { color: red; }`,
    });
    const result = validateFreeformHtml(html, ctx);
    expect(result.ok).toBe(false);
    const unscoped = result.violations.filter((v) => v.rule === "unscoped-css");
    expect(unscoped.length).toBeGreaterThan(0);
    expect(unscoped[0]?.message).toContain(".global-class");
  });

  it("rejects body/html-level resets", () => {
    const html = validHtml({
      extraStyle: `\nbody { background: red; }`,
    });
    const result = validateFreeformHtml(html, ctx);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.rule === "unscoped-css")).toBe(true);
  });

  it("allows multiple scoped selectors and comma-separated lists", () => {
    const html = validHtml({
      extraStyle:
        `\n#${SCENE_ID} .a, #${SCENE_ID} .b { color: white; }` +
        `\n#${SCENE_ID} > * { transition: opacity 0.3s; }`,
    });
    const result = validateFreeformHtml(html, ctx);
    expect(result.ok).toBe(true);
  });
});

describe("validateFreeformHtml — size cap", () => {
  it("rejects output larger than the byte cap", () => {
    const filler = "<!-- " + "x".repeat(VALIDATOR_RULES.MAX_HTML_BYTES + 100) + " -->";
    const html = validHtml() + filler;
    const result = validateFreeformHtml(html, ctx);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.rule === "size-cap")).toBe(true);
  });
});

describe("validateFreeformHtml — empty input", () => {
  it("rejects empty string", () => {
    const result = validateFreeformHtml("", ctx);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.rule === "empty")).toBe(true);
  });

  it("rejects whitespace-only string", () => {
    const result = validateFreeformHtml("   \n  \t   \n", ctx);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.rule === "empty")).toBe(true);
  });
});
