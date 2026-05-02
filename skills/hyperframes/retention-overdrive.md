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

## Future overdrive (not in PR #40)

- **Visual storyboard scorer** — deterministic scorer for template variety, atmosphere variety, color palette evolution, rhythm-match. ~150 LOC, no AI needed.
- **Auto-apply mode** — `--apply-top N` actually edits the script.json based on high-confidence recommendations. Right now it just lists them.
- **A/B variant scoring** — generate 3 variants of the opening, score each, pick the winner. Already have `planSceneVariants` — wire scoring around it.
- **Sentiment-driven theme adjustments** — alarming sentiment auto-shifts theme to red-accented variant; aspirational to gradient; neutral to cream. Heuristic on top of the Haiku output.
