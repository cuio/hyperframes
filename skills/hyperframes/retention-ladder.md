# The First-30-Seconds Retention Ladder

How to keep viewers from scrolling away in the opening of a short-form or long-form video — with specific guidance for **when and how to introduce charts** so editorial dataviz doesn't kill momentum.

## The core principle

**Charts are a payoff, not a setup.** A chart-scene at second zero has no stakes — the viewer doesn't yet know why the data matters. Lead with a HOOK that creates the question, then ladder up to the chart that answers it.

The first 5–30s of a video is a ladder, not a slide. Each rung must lift the viewer off the previous one with **higher specificity, not just more motion**. If you keep the visual energy high but don't escalate the stakes, the viewer scrolls away — they perceive the high motion as "nothing happening loudly."

```
0–5s    HOOK         "Why should I keep watching?"          1 idea, big visual, hard cut
5–15s   STAKE        "Here's what's at risk / what's new"   1 specific number tease, no chart yet
15–30s  PROOF        "Here's the data that proves it"       FIRST chart appears — pre-loaded
30s+    PAYOFF       "Here's what it means for you"         Subsequent charts + interpretation
```

The chart at second 20 lands because the viewer has already heard the number. The chart at second 0 lands as decoration the eye slides past.

## Short-form ladder (Reels / TikTok / Shorts, 30–90s total)

### Cut-rate budget by phase

| Phase  | Window | Cuts/sec  | Why                                                                                                  |
| ------ | ------ | --------- | ---------------------------------------------------------------------------------------------------- |
| Hook   | 0–3s   | **4–6**   | Hyper-cut visual chaos. The brain registers "something is happening" before it can decide to scroll. |
| Settle | 3–7s   | **2–3**   | Land the stake. One word per cut, not phrases.                                                       |
| Proof  | 7–15s  | **1.5–2** | Chart enters here. Slower cuts so the data registers.                                                |
| Payoff | 15–end | **1–1.5** | Interpretation. Vary based on density.                                                               |

### Pacing rules

1. **Don't open with a chart.** Open with a face / hand / object / hero word in the first 3s. The chart is a payoff scene, not an opener.
2. **Tease the number BEFORE the chart.** "$1.4 trillion." [hard cut to chart]. The brain has already heard the number; the chart shows the proof. Reverse the order and the chart reads as setup.
3. **Sustain phase ≤ 1.5s.** The chart-scene's 4-phase timeline (entrance → settle → development → sustain) defaults to a long sustain. For short-form, override `durationSeconds` so the scene cuts BEFORE sustain stretches — every static frame is a retention loss.
4. **Multiple charts? Stack them tighter.** Each chart gets one beat of explanation, then hard-cut to the next. Don't let any chart live more than 5s in short-form.
5. **End the chart segment with a stinger.** Cut from the final chart to a face / object / single word — gives the viewer's eye somewhere to land before the CTA.

### Short-form opening template (timed)

```
0:00 hook-bigtext      "BOTS"                                   2.0s
0:02 hook-statreveal   "$1.4T spent on AI tooling"              2.5s
0:04.5 cyber-glitch    "But here's the thing —"                 1.5s
0:06 chart-scene       (grouped-bars, the actual data)          5.0s   ← first chart
0:11 cyber-glitch      "It's about to flip."                    1.5s
0:12.5 chart-scene     (annotated-area, projection)             5.0s   ← second chart
0:17.5 outro-cta       "Follow for more"                        2.5s
```

The viewer has heard "$1.4T" and "but here's the thing" BEFORE either chart appears. By second 6, they're invested in the answer.

## Long-form ladder (1–10min explainer, landscape)

### Cut-rate budget by phase

| Phase           | Window | Cuts/sec    | Why                                                                                           |
| --------------- | ------ | ----------- | --------------------------------------------------------------------------------------------- |
| Cold open       | 0–5s   | **2–3**     | Visual + claim, slower than short-form because the audience is choosing-in to a longer watch. |
| Stake expansion | 5–15s  | **1–1.5**   | Paint the picture. Multiple supporting beats.                                                 |
| Turn            | 15–30s | **0.8–1**   | The surprise / counter-intuitive thing. Slow down here so it lands.                           |
| First chart     | 30–60s | **0.5–0.8** | Editorial chart with full chrome. Sustain phase is OK here.                                   |
| Walkthrough     | 60s+   | **0.5–1**   | Vary based on density.                                                                        |

### Pacing rules

1. **Cold open at 2–3 cuts/sec, not 6.** Long-form viewers self-selected; you don't need hyper-cut chaos to retain. Hyper-cut feels desperate at length.
2. **First chart at 25–45s, not 5s.** The audience needs to understand the question before the data answers it.
3. **Charts can have full sustain (3–5s).** The editorial frame's chrome (title + subtitle + sources + byline + annotation pill) is part of the credibility — give it time to read.
4. **Bridge between charts with metabolic cuts.** Face, B-roll, hand-drawn diagram, screen recording. Two charts back-to-back without a bridge feels like a slideshow.
5. **Create a chart series arc.** Same theme, evolving narrative — `lollipop-timeline` (the timeline) → `grouped-bars` (the magnitude) → `annotated-area` (the projection). The viewer sees the same aesthetic and knows they're inside one coherent argument.

### Long-form opening template

```
0:00–0:05  hook-bigtext      "BOTS WROTE HALF THE INTERNET LAST YEAR"
0:05–0:15  aroll-text        "Three numbers tell the story. Here's the first."
0:15–0:23  cyber-glitch      "49.6 percent."
0:23–0:30  hook-statreveal   "Of all global web traffic in 2024 was automated."
0:30–0:38  chart-scene       (grouped-bars, year-over-year)         ← first chart
0:38–0:45  aroll-text        "But the curve is accelerating, not flattening."
0:45–0:55  chart-scene       (annotated-area, projection)            ← second chart
0:55+      structured walkthrough
```

## How charts should ENTER — the seven rules

These are the hard-won pacing rules for the moment a chart-scene takes the screen. Apply to every chart, both formats.

1. **Pre-roll the chrome.** Show title + subtitle + the EMPTY chart canvas (gridlines + axis labels) for 0.5s before bars/lines animate in. This pre-loads the frame so the data lands ON the chrome, not next to it.
2. **The voiceover starts BEFORE the chart's data.** Voice introduces the chart's narrative ("In 2024, bot traffic hit 49.6 percent"); the bars rise UNDER that voice, not after it.
3. **Chart entrance must have a stinger.** A whip-pan, a glitch flash, a sound effect — something that marks "we are now showing data." Without a stinger, the chart fades in like a slideshow.
4. **Cut AWAY at 70% reveal.** Show 60% of the data, cut to a face/object/metaphor that gives it meaning, then cut BACK to the chart fully resolved. Two-shot rhythm beats one-shot every time.
5. **The annotation pill is its own beat.** When the pill fades in with its curved leader (around 1.6s into the chart-scene timeline), pair it with a hard sound effect — woosh, click, thump. The pill is "interpretation"; mark the transition from "showing data" to "telling the viewer what it means."
6. **Lead with the result, not the process.** "Claude Code grew 6×" — show the END STATE first, THEN reverse the chart to show the journey. Spoiling the answer paradoxically increases retention because viewers stay to understand HOW.
7. **End the chart on the annotation, not the chart.** The last frame of a chart-scene should be the annotation pill's text, not the bars. Crop tight on the pill before cutting to the next scene. Pulls the viewer's eye to the meaning, not the data.

## Audio sync — the often-skipped lever

Most chart videos lose retention because the AUDIO and the CHART are out of sync. The chart enters silently, then the voice catches up. Or the voice describes the chart while it's empty. Both kill momentum.

The fix:

- **Voice leads chart by 200–400ms.** Voice says "forty-nine point six percent" — chart's value-label pops at the word "percent."
- **Sound effect on entrance.** Hard transient (woosh, glitch hit, paper rustle) on the chart's first frame. Pulls the ear's attention forward.
- **Music ducks during chart explanation.** Drop the bed music –6 to –9 dB while the voiceover is interpreting. Restore on exit.
- **Annotation pill = sound cue.** Different cue than the chart entrance — softer, more interior. Suggests "this is the takeaway."

## What's encodable in the planner vs authorial choice

### Encode in the planner (system-level)

- **Never start a video with `chart-scene`.** If the planner picks a chart for scene 1, auto-insert a `hook-bigtext` (or `cyber-glitch-word` for cyberlofi) before it.
- **Limit consecutive chart-scenes to 2.** If 3+ in a row appear in the plan, insert a non-chart bridge scene between them.
- **Auto-pair chart-scenes with a payoff scene.** Every `chart-scene` should be followed by a 1.5–2s `aroll-text` or `cyber-glitch` with the chart's key takeaway. The planner can synthesize this from the chart's annotation text.
- **Pre-roll prop on chart-scene.** Optional `preRollSeconds: 0.5` that shows just title + subtitle + empty canvas before the chart animates in. Default 0 for backward-compat; planner sets to 0.5 by default for short-form.
- **Sustain budget per format.** Add `format: "short" | "long"` to the project meta; short-form caps `chart-scene` durations at 5s, long-form allows 8–10s.

### Leave to the author (skill-level)

- Specific cuts/sec rates — depends on script density.
- Which chart matches the narrative beat — bar vs line vs timeline.
- The exact wording of the hook, stake, payoff.
- Sound effect choice + music ducking levels.

## Concrete next implementations (queued, not yet built)

If we want to encode the rules above directly into the system, the smallest set of changes that delivers most of the win:

1. **`chart-preroll` prop on `chart-scene`** — `preRollSeconds: number`. Implementation: in the GSAP timeline, hold all chart elements at opacity 0 for the first preRollSeconds, only the title/subtitle/footer fade in during that window. ~10 LOC.

2. **`chart-payoff` template** — a 1.5s scene type that's just the chart's annotation text, big, centered, on the same theme. Auto-generated by the planner whenever it picks `chart-scene`. ~80 LOC.

3. **Planner heuristics in `planner.ts`**:
   - Reject scene-1 = chart-scene; auto-insert a hook before it.
   - Cap consecutive charts at 2; insert bridge after.
   - Auto-emit chart-payoff after every chart-scene.

4. **Format-aware sustain caps** — read `script.meta.format` (`"short"` vs `"long"`); chart-scene clamps `durationSeconds` to format-appropriate ceiling. ~5 LOC in chart-scene's render.

5. **Audio-sync helpers in the assembler** — when a scene's narration contains a number that matches a value in the chart's props, advance the chart's data animation to land at that word's timestamp from the audio's word-level transcript. This is real engineering (~200 LOC) but it's the single biggest retention lever and we already have word-level transcripts via the `transcribe` CLI.

## Summary

The first 5–30s isn't a slide. It's a ladder of specificity: hook → stake → proof → payoff. Charts are the proof rung, not the hook. Pre-load the number with voice and a stinger before the chart enters; cut away at 70% reveal; end on the annotation, not the data.

Encode the structural rules (no chart at scene-1, payoff scenes after charts, sustain caps, preroll) in the planner. Leave taste decisions (cut rates, sound design, copy) to the author.
