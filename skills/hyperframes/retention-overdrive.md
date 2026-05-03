# Retention Overdrive — pushing past 85/100

The retention-ladder skill (`retention-ladder.md`) encodes the structural rules that take a video from "watchable" to "well-paced." This doc is about the next tier — engineering the **opening 5 seconds** as a hyper-cut typographic-flash sequence, and adding a **Haiku-powered scorer + recommendation layer** that runs on every plan so retention is measured continuously, not just after render.

## The principle

Two layers of leverage past the ladder:

1. **Engineer the first 5 seconds harder than any other window.** The opening determines whether the viewer scrolls. A single 3s hook scene is correct but conservative. The retention winners cut at 4-6 cuts/sec for the first 5s — type changes, theme flashes, hard color cuts. Each cut answers a different question: "What is this?" → "Why should I care?" → "What's at stake?" → "Watch."

2. **Measure retention before render, not after.** The Gemini retention review (gemini-review.ts) only runs on the rendered video. By the time we see a 60/100 score, we've burned 30 minutes of render time. A pre-render Haiku scorer that scores every scene's hook strength + sentiment + predicted retention lets us iterate on the script in seconds, not minutes.

## What ships in PR #40

### A. `engineerFirstFiveSeconds` heuristic

A fifth post-processor in `retentionHeuristics.ts` that runs after the four existing rules. Detects the opening hook scene; if its narration is dense (≥ 6 words) AND its duration is ≥ 2.5s, splits it into 3–5 micro-scenes:

- Each micro-scene is **0.6–1.5s**.
- Templates **rotate** through `[hook-bigtext, kinetic-words, cyber-glitch-word]` for visible type changes.
- Backgrounds **flash** through a palette: `[bg, accent-tint, fg-tint, bg]` via the `bgOverride` prop.
- **Hard cuts only** (no fades) — the runtime's transition-in default is fine, but we explicitly set transition: "cut" so the planner doesn't pick fade.
- The hook narration is split into punchwords — typically 1–3 words per micro-scene.

This implements the retention-ladder skill's table:

```
Phase   | Window | Cuts/sec
Hook    | 0–3s   | 4–6      ← THIS is what the hyper-hook delivers
```

### B. `scriptScorer.ts` — Haiku-powered per-scene scoring

Calls Claude Haiku 4.5 (cheap, fast — 25¢/1M input tokens) once per planned Script. The model returns structured JSON per scene:

```ts
{
  scenes: [
    {
      sceneId: "s01",
      hookStrength: 8,           // 0–10
      sentiment: "alarming",     // alarming | aspirational | neutral | curious | warm | cold
      sentimentIntensity: 7,     // 0–10
      energy: 9,                 // 0–10 — visual + narrative momentum
      predictedRetention: 88,    // 0–100
      narrativeRole: "hook",     // hook | stake | proof | payoff | transition | close
      recommendations: [
        {
          type: "rewrite-text",
          field: "title",
          suggestion: "'BOTS' is generic — try '49% BOTS' to lead with the stat",
          confidence: "high",
          predictedImpact: 4,
        }
      ],
      rationale: "Strong opener but the title doesn't carry the specific claim..."
    },
    // ... one per scene
  ],
  arcAnalysis: {
    overallRetention: 78,        // weighted average + curve penalty
    hookQuality: 8,
    energyPeaks: [0, 5, 9],      // scene indices
    momentumRisks: [
      { scene: "s06", reason: "9s static counter after a high-energy hook — energy crash" }
    ],
    closingStrength: 7,
  }
}
```

### C. `hyperframes score` CLI command

```
hyperframes score [project-dir]
  --json         output structured JSON instead of pretty text
  --apply-top    automatically apply the top N=high-confidence recommendations
  --model        override Haiku model id (default: claude-haiku-4-5)
```

Pretty-prints the report:

```
🎯 Retention score: 78/100   ▲ baseline 65
🔥 Hook quality: 8/10
⚠️  2 momentum risks flagged

Per-scene:
✅ s01  hook    9/10  alarming   88% retention
✅ s02  stake   8/10  curious    85%
🟡 s03  proof   6/10  neutral    72%   ← weak — see rec
✅ s04  payoff  9/10  aspirational 90%

Top recommendations:
  [HIGH +4]   rewrite s01 title: 'BOTS' → '49% BOTS' to lead with the stat
  [HIGH +3]   split s03 — narration runs 8s on a static visual
  [MED  +2]   swap s06 template kinetic-words → cyber-glitch-word for energy continuity
```

### D. Continuous-loop integration

The CLI workflow becomes:

```bash
hyperframes script ./script.md      # plan + synth (heuristics auto-apply)
hyperframes score                   # Haiku scorer reports retention
# author iterates on script.md based on recs
hyperframes score                   # re-score
hyperframes render                  # render once score is satisfying
hyperframes optimize                # post-render Gemini review (closes the loop)
```

Two scoring passes — one cheap pre-render (Haiku, ~$0.01 per script), one expensive post-render (Gemini Flash on rendered video, ~$0.10 per review). Catches different classes of issue.

## All four follow-ups shipped (PR #41)

The four items previously queued landed as one cohesive PR. Use them via flags on `hyperframes score`:

### Visual storyboard scorer

`scoreVisualStoryboard(script)` runs a deterministic pass over the planned scenes' visual choices — no AI. Reports a 0–100 overall + per-axis subscores:

- **Template variety** — penalises 3+ identical templates in a row
- **Atmosphere variety** — penalises author-set monotony (defaults are no-opinion, not penalised)
- **Palette evolution** — penalises identical theme+bgOverride across scenes that explicitly set them
- **Rhythm match** — flags hooks > 4s and chart-scenes > 10s
- **Opening density** — flags first-5s with < 3 beats

Surfaced alongside the Haiku score in `hyperframes score`'s default output. Pure function, easy to call programmatically.

### Auto-apply (`--apply-top N`)

`hyperframes score --apply-top 3` takes the top N high-confidence Haiku recommendations and applies them to the script. Conservative scope:

- `rewrite-text` → parses target from suggestion (`'X' → 'Y'`, `try 'Y'`, `to 'Y'`), writes to `scene.props[field]`
- `duration-adjust` → parses `Ns` target, writes `scene.durationHint`
- `template-swap` → parses kebab-case target, validates against the catalog
- `theme-shift` → parses theme name, validates against registered themes

Structural recommendations (`split-scene`, `merge-scene`, `add-hook`) are surfaced but not auto-applied — they need human judgment.

Default `minConfidence: "high"`. Use `--dry-run` to preview without writing back.

### A/B hook variant scoring (`--vary-hook`)

`hyperframes score --vary-hook` generates 3 alternative visual treatments for scene 0 via `planSceneVariants`, scores each in a 1-scene Haiku call, picks the highest-retention winner, and replaces scene 0. Total cost ~$0.05.

Reports the comparison so you can see which variant won and why.

### Sentiment-driven theming (`--apply-themes`)

After scoring, sentiment labels (alarming / aspirational / curious / warm / cold / neutral) map to `bgOverride` atmospheres on `chart-scene` and `chart-payoff` scenes. Author-set `bgOverride` is preserved. Light themes (cream FT) are skipped — preserving editorial parchment identity.

Mapping (`SENTIMENT_BG_OVERRIDES`):

- `alarming` → dark red gradient
- `aspirational` → deep navy gradient
- `curious` → ink-violet radial
- `warm` → amber gradient
- `cold` → desaturated grey gradient
- `neutral` → no override

### End-to-end iteration loop with all 4

```bash
hyperframes script ./script.md
hyperframes score --vary-hook --apply-top 3 --apply-themes
# review the diff, decide whether to re-score or render
hyperframes render
```

One shell command runs all 4 features in order: vary the hook → score everything → apply top 3 high-confidence recs → apply sentiment theming. Total cost ~$0.06 vs ~30 min × $0.10 of render iteration.
