import { describe, it, expect } from "vitest";
import { getTemplate } from "./index.js";
import { DEFAULT_TOKENS } from "./tokens.js";
import type { TemplateRenderContext } from "./types.js";

function renderCtx(durationSeconds: number, sceneId = "s01"): TemplateRenderContext {
  return {
    sceneId,
    durationSeconds,
    isHook: true,
    tokens: DEFAULT_TOKENS,
  };
}

// Regression: the user reviewed a real render and reported that many letters
// in the hook headline landed at opacity:0 for the entire scene duration —
// dropping arbitrary characters mid-word ("y failing", "compre e si e fede al",
// "framewo k", "neithe goal"). The handoff filed two hypotheses (stagger-
// overruns-duration and layout-clipping). The fix shipped here makes those
// failure modes structurally impossible regardless of which one was the cause:
//   1. `.hb-letter` defaults to opacity:1 — graceful degradation if the GSAP
//      tween never runs.
//   2. A pre-cascade `tl.set(letters, { opacity:0, y:50 }, 0)` records the
//      initial state at t=0 so seeks into the cascade window observe a real
//      tween rather than a default-state element.
//   3. A defensive `tl.set(letters, { opacity:1 ... }, sceneDur - 0.01)` at
//      the absolute end of the scene window guarantees the last captured
//      frame has every letter visible — even if any earlier math drifts.
describe("HOOK_BIGTEXT — letter-cascade safety net", () => {
  const HOOK_BIGTEXT = getTemplate("hook-bigtext");

  it("is registered as a builtin template", () => {
    expect(HOOK_BIGTEXT).toBeDefined();
  });

  it("renders one .hb-letter span per character of the title (no chars dropped at render time)", () => {
    const title =
      "By failing to establish a comprehensive federal market structure framework, we have achieved neither goal.";
    const html = HOOK_BIGTEXT!.render({ title }, renderCtx(6));
    const expectedLetters = Array.from(title).filter((c) => !/\s/.test(c));
    const letterMatches = html.match(/<span class="hb-letter">/g) ?? [];
    expect(letterMatches.length).toBe(expectedLetters.length);
  });

  it("uses opacity:1 as the .hb-letter default — graceful degradation when GSAP fails", () => {
    const html = HOOK_BIGTEXT!.render({ title: "Hello world" }, renderCtx(3));
    expect(html).toMatch(/\.hb-letter\s*\{[^}]*opacity:\s*1/);
  });

  it("pre-records opacity:0 at t=0 so the cascade is visible from the first frame", () => {
    const html = HOOK_BIGTEXT!.render({ title: "Quick test" }, renderCtx(3));
    expect(html).toMatch(/tl\.set\(letters,\s*\{\s*opacity:\s*0,\s*y:\s*50\s*\},\s*0\)/);
  });

  it("snaps every letter to opacity:1 at sceneDur - 0.01 as a final-frame guarantee", () => {
    const html = HOOK_BIGTEXT!.render({ title: "Quick test" }, renderCtx(3));
    expect(html).toMatch(
      /tl\.set\(letters,\s*\{\s*opacity:\s*1,\s*y:\s*0,\s*clearProps:\s*'transform'\s*\},\s*Math\.max\(0,\s*sceneDur\s*-\s*0\.01\)\)/,
    );
  });

  it("keeps the cascade math bounded for long headlines at minimum scene duration (no stagger overrun)", () => {
    // Worst case from the bug report: ~12-word, 100-letter headline at the
    // template's minimum allowed duration. The stagger math should still
    // schedule the final-frame snap inside the scene window.
    const title =
      "By failing to establish a comprehensive federal market structure framework, we have achieved neither goal.";
    const html = HOOK_BIGTEXT!.render({ title }, renderCtx(2));
    // Must NOT contain `Math.max(0, 2 - 0.01)` evaluating to a negative —
    // and must contain the literal sceneDur var being used in the snap.
    expect(html).toMatch(/var sceneDur = 2/);
    expect(html).toMatch(/sceneDur\s*-\s*0\.01/);
  });

  it("still renders correctly when the title has only one letter (edge case)", () => {
    const html = HOOK_BIGTEXT!.render({ title: "X" }, renderCtx(2));
    const letterMatches = html.match(/<span class="hb-letter">/g) ?? [];
    expect(letterMatches.length).toBe(1);
    // The eachStagger math uses Math.max(1, letterCount) — must not divide by 0.
    expect(html).not.toMatch(/eachStagger\s*=\s*[^;]*Infinity/);
  });

  it("highlights the accent word as a separate `.hb-accent` block, leaving its letters intact", () => {
    const html = HOOK_BIGTEXT!.render(
      { title: "We achieved nothing", accentWord: "nothing" },
      renderCtx(3),
    );
    expect(html).toMatch(/<span class="hb-word hb-accent">/);
    // Letters inside the accent word still get .hb-letter spans
    expect(html).toMatch(/<span class="hb-word hb-accent"><span class="hb-letter">n<\/span>/);
  });
});
