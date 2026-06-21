# Plan: ElevenLabs SFX/Music + Gemini video & image intelligence

> **For the next Claude session.** This document is a complete brief — read top
> to bottom, then start at Phase 1. Two parallel feature tracks (audio + AI
> intelligence) that converge on retention engineering. Keep the existing
> Storyline cockpit's apply-pipeline as the spine; everything new feeds patches
> into it.

## Why

The cockpit can now write and direct copy, swap themes, and reorder scenes —
but two big retention levers are still missing:

1. **Audio beyond voiceover.** Most viewers' affect is set by the _bed_ (music
   - SFX), not the narration. We have a Music and SFX lane on the timeline
     already (PR #20 wired the placeholders) but nothing flows in.
2. **Pre-render visual judgement.** We compose carefully but ship blind. The
   only "is this on-brand?" check is the user's eye on a finished render.
   Gemini's video understanding lets us close that loop _during_ direction,
   not after.

Both are LLM-driven in design — the studio asks the user what they want, the
model proposes, the user accepts à la carte. Same UX language as Director.

## What ships, broken into milestones

### Milestone A — ElevenLabs SFX (1 PR, ~2 days)

Per-scene generated sound effects landing on the existing SFX lane.

- New backend route `POST /storyline/sfx-suggest` — Haiku reads one scene
  (window same as scene-intent: focal + ±2) and proposes 1-3 SFX ideas with
  text prompts and durations. Returns `{ suggestions: [{ id, prompt,
durationS, anchor: "scene-start" | "accent-word" | "scene-end" }] }`.
- New backend route `POST /storyline/sfx-generate` — takes a suggestion + a
  destination path, calls ElevenLabs Sound Generation
  (`POST /v1/sound-generation`), writes mp3 to `assets/sfx/<sceneId>-<id>.mp3`,
  appends an entry to `assets/sfx/sfx.manifest.json`.
- Assembler (already supports the SFX track placeholder): consume the
  manifest and emit one `<audio data-track-index="3" data-timeline-group="sfx" data-start="…">`
  per entry. Anchor maps to absolute time:
  - `scene-start` → `cursor + leadIn`
  - `accent-word` → narration tokenisation (Phase B uses ElevenLabs alignment;
    Milestone A pins to `cursor + (accentWordIndex * narrationDuration / wordCount)`
    as a heuristic — good enough for a first cut)
  - `scene-end` → `cursor + sceneDuration - durationS`
- New per-card AI action: **🔊 Add SFX** — reuses the SceneSuggestion stack.
  Clicking generates the audio file and shows a play button + apply-to-scene.
- Cost telemetry: log under `script.storyline.sfx.suggest` (Haiku) and
  `script.storyline.sfx.generate` (ElevenLabs). The CostLogger already supports
  ElevenLabs entries.
- Studio Timeline: SFX placeholder lane already renders. Add a "play this clip"
  affordance on each generated SFX so the user can audition without scrubbing.

**ElevenLabs API reference**

```
POST https://api.elevenlabs.io/v1/sound-generation
Headers: { "xi-api-key": "...", "Content-Type": "application/json" }
Body: {
  "text": "snap zoom whoosh, low end thump",
  "duration_seconds": 1.5,        // 0.5..22, optional
  "prompt_influence": 0.4,        // 0..1, optional, default 0.3
  "output_format": "mp3_44100_128"
}
Response: audio/mpeg
```

Gotchas:

- ElevenLabs SFX runs on credits — surface cost in the cost badge.
- Duration is best-effort; the model decides final length within ±20%.
- Stereo by default — fine for our pipeline (existing voice mix is mono but
  the assembler doesn't downmix).

### Milestone B — ElevenLabs Music (1 PR, ~2 days)

Multi-scene background music tracks landing on the Music lane.

ElevenLabs Music API (Eleven v3 Music) is async: you submit a prompt + length,
get back a job id, poll until ready, then download. Plan accordingly.

- New backend route `POST /storyline/music-suggest` — Haiku reads the _whole_
  storyline + active theme + intent ("upbeat", "investigative", "cinematic
  dread") and returns `{ tracks: [{ id, prompt, scenesCovered: ["s01", …],
durationS, role: "underscore" | "stinger" }] }`. A typical 2-minute video
  gets 1-3 underscore tracks + occasional stingers.
- New backend route `POST /storyline/music-generate` — takes one track,
  POSTs to ElevenLabs Music, polls (with backoff: 2s, 4s, 8s, max 60s),
  writes mp3 to `assets/music/<id>.mp3`, appends to `assets/music/music.manifest.json`.
  Returns the job id immediately so the UI can show progress.
- Assembler: emit `<audio data-track-index="2" data-timeline-group="music" data-start="…">`
  per entry. The Studio's existing music lane consumes these natively.
- Studio: a "🎵 Music wizard" button at the top of the Storyline tab opens a
  textarea ("describe the vibe"). On submit → `music-suggest` → preview the
  proposed tracks (with prompt + scene coverage + duration) → user clicks
  "Generate" per track → backend triggers ElevenLabs.
- Volume ducking for voiceover: the assembler's audio mix already sums tracks
  flat. Add a `data-music-duck-db="-12"` attribute to music tracks so the
  encoder can apply a sidechain duck during voiceover windows. (Producer
  package does the actual mix — see `packages/producer/src/audio/mix.ts`.)

**ElevenLabs Music API reference (Eleven v3 Music)**

```
POST /v1/music
Body: { "prompt": "investigative documentary, tense pulse, low strings", "music_length_ms": 90000 }
Response: { "music_id": "abc123", "status": "processing" }

GET /v1/music/:id
Response: { "status": "completed" | "processing" | "failed", "audio_url": "..." }
```

The job-poll pattern is also used for ElevenLabs voice cloning so the helper
can be shared (`pollUntilReady` in `packages/core/src/elevenlabs/`).

### Milestone C — Gemini render review (1 PR, ~3 days)

Run a Gemini pass on the rendered MP4 and surface structured retention
feedback in the studio. This is the highest-value piece because it closes the
"is this any good?" loop pre-publish.

- New env var `GEMINI_API_KEY` (loaded the same way as `ANTHROPIC_API_KEY`).
- New module `packages/core/src/gemini/` — REST client, key loader,
  `callMultimodalTool<T>(opts)` mirroring the Anthropic pattern so the prompt
  shape is consistent.
- Model: `gemini-2.5-flash` for everything in this PR. Pro is overkill for
  vision tasks at this scope and costs 4-8× more.
- New backend route `POST /storyline/render-review` — accepts `{ renderPath }`,
  uploads the file via Gemini Files API, prompts with the assembled storyline
  meta (scene id → start time → narration → on-screen headline) and asks for
  structured output:

```ts
{
  overallRetentionScore: number;     // 0-100, single rough estimate
  scrollRiskWindows: Array<{
    startS: number;
    endS: number;
    severity: "low" | "med" | "high";
    why: string;                     // "audio dips, no visual change"
    fix: string;                     // "add a kinetic-words beat at 0:14"
  }>;
  brandConsistency: {
    score: number;                   // 0-100
    drift: string[];                 // notes per scene where the look departs
  };
  audioMix: {
    voiceClarity: "good" | "muddy" | "clipped";
    musicLevels: "ducked" | "flat" | "fighting";
    sfxBalance: "well-placed" | "missing" | "overused";
  };
  perScene: Array<{
    sceneId: string;
    visualHook: number;              // 0-10
    paceMatch: number;               // 0-10 (does pacing match narration?)
    onBrand: number;                 // 0-10
    note: string;
  }>;
}
```

- Frontend: a **🔍 Render review** button at the top of the Storyline tab,
  visible when the project has been rendered. Click → spinner, then a panel
  with retention windows surfaced as "jump to time" links + per-scene chips.
- Cost: ~$0.05 per 2-minute video at flash pricing. Cheap enough to run
  on every render.

**Gemini API references**

Files API (upload):

```
POST https://generativelanguage.googleapis.com/upload/v1beta/files?key=…
Body: multipart/form-data with the mp4
Response: { name: "files/abc", uri: "files/abc", state: "PROCESSING" }
```

After polling state → ACTIVE, send the prompt with `file_data`:

```
POST .../v1beta/models/gemini-2.5-flash:generateContent?key=…
Body: { contents: [{ parts: [{ file_data: { file_uri: "files/abc", mime_type: "video/mp4" } }, { text: SYSTEM + USER }] }], tools: [{ function_declarations: [...] }] }
```

### Milestone D — Gemini image analysis (smaller PR, ~1 day)

Replace / augment the current sharp-only image role detection with a Gemini
pass. The existing `packages/core/src/images/` pipeline already extracts
dominant color, palette, and aspect — we add intent-aware role + treatment
recommendation.

- On image upload (Studio → Images tab), after the sharp ingest finishes,
  POST the thumbnail to Gemini and ask for:
  - role: hero | subject | atmosphere | graphic
  - vibe: 2-3 word descriptor ("editorial harsh", "cinematic warm")
  - suggestedTreatment: editorial-bleed | duotone-bg | type-mask-fill | (any
    image-aware template)
  - retentionStrengthAtAttachment: 1-10 (how strong is this image as a
    scroll-stopper if used as scene 1?)
- These extend the existing `ImageEntry` shape in
  `packages/core/src/images/manifest.ts`. Visual director consumes the
  `suggestedTreatment` as a soft prior.

### Milestone E — Per-scene Gemini "would-they-scroll" (1 PR, ~2 days)

The retention killer feature. For any scene the user is unsure about, a
"📉 Scroll test" button samples 3 frames at 0.5s / scene midpoint / -0.5s,
sends them to Gemini with the narration + on-screen text + the previous
scene's outgoing frame, asks:

> Would a viewer on a feed scroll past this scene? If so, why, and what
> single change would keep them?

Output: `{ wouldScroll: boolean; whyOrWhyNot: string; oneChangeFix: string; sceneStrengthScore: number }`.

This drops a SceneSuggestion onto the card with the proposed fix as a patch
the user can apply à la carte.

### Milestone F — Storyline-level retention map

Combine all the per-scene retention scores from C/E into a small horizontal
strip at the top of the Storyline tab — one square per scene, coloured
green/amber/red by retention score. Click a square to scroll to that scene.
Updates live as suggestions are applied.

This is what the user means by "engineer retention" — every directorial
decision is now anchored to a measurable retention prediction.

## How the pieces compose

```
                        ┌─ Director (Storyline / Project) ─┐
                        │   Haiku, single textarea         │
                        └──────────────┬───────────────────┘
                                       │ proposes patches
   ┌─ Per-scene Director ──────────────┴──────────────────┐
   │   Haiku, scoped window                                │
   │   "✦ Direct this scene"                               │
   └──────────────┬────────────────────────────────────────┘
                  │ all funnel into …
   ┌──────────────▼─────────────────────────────────────────┐
   │       applyPatch(sceneId, patch) → PUT /scenes/:id     │
   │                  (single write surface)                │
   └──────────────┬─────────────────────────────────────────┘
                  │
                  └─ Storyline reload
                       │
                       ├─ SFX manifest → SFX lane (Milestone A)
                       ├─ Music manifest → Music lane (Milestone B)
                       └─ Retention map ← Gemini render review (C+E+F)
```

The point: every new feature lands on the existing apply pipeline. We do not
invent parallel write surfaces. The only new write paths are
`POST /storyline/sfx-generate` (file write) and `POST /storyline/music-generate`
(file write) — both are _additive_, neither mutates `script.json`.

## Architecture decisions, written down so we don't re-litigate

1. **Haiku for proposing, ElevenLabs for generating, Gemini for judging.** Each
   model does what it's best at. Haiku is the directorial brain; ElevenLabs
   ships audio assets; Gemini reviews the rendered output. No overlap.

2. **Manifests, not script.json fields.** SFX and music live in
   `assets/sfx/sfx.manifest.json` and `assets/music/music.manifest.json`. The
   assembler reads them at assemble time. This keeps `script.json` purely
   about narration + scene visual decisions; audio assets stay decoupled.

3. **Anchor model for SFX timing.** Three anchors (scene-start /
   accent-word / scene-end) cover 95% of cinematic usage. Resist the urge to
   add a free-form offset until users ask for it — anchors keep the suggestion
   model simple.

4. **Music ducking is the producer's job, not the renderer's.** The encoder
   reads `data-music-duck-db` from each music element and applies a sidechain
   duck during voiceover. This keeps the runtime simple and the producer in
   charge of the final mix.

5. **Gemini Flash everywhere except where Pro is mandated.** Flash is
   sufficient for retention review, image analysis, and per-scene scroll
   tests. Pro only when we move to multi-video comparison work later.

6. **Gemini Files API uploads happen on the studio server, not the client.**
   Mp4s are big; we stream them server-to-server rather than client→server→Gemini.
   The studio server is already trusted with the project directory.

7. **Cost transparency.** Every new endpoint logs to `CostLogger` with a
   distinctive op name. The CostBadge already aggregates by op — users will
   see "sfx.generate" and "music.generate" land in real time.

## Out of scope for this round

- **AI voice cloning per scene.** Different reader per scene is a
  retention-killer most of the time. Skip.
- **Auto-generated B-roll.** Sora / Runway integration is a separate stack;
  not landing here.
- **Render-blocking quality gates.** Gemini's review is _advisory_, never
  gating. We don't want to add a "your video failed retention review, please
  re-direct" wall.
- **Multi-language SFX prompts.** ElevenLabs SFX is English-only at the
  moment. International voice already works via the existing voice picker.
- **Music as score (timing-aware).** Generating music that hits beats on
  specific scene transitions is a much harder problem. Phase 2 once SFX is
  shipping.

## Risks

- **Eleven v3 Music API maturity.** It's newer than the SFX API. If it
  changes shape during this work, we have a fallback: use the existing
  voice-cloning generation pattern for the polling, and treat music as
  fire-and-forget with a "regenerate" button.
- **Gemini quotas.** Default project quotas are tight. Document the env var
  setup and add a friendly 429 banner.
- **Audio mix complexity.** Sidechain ducking in ffmpeg is fiddly. If the
  producer's mix gets gnarly, fall back to fixed -12 dB on music during
  voiceover windows — uglier but reliable.
- **Storage growth.** Generated SFX/music files can balloon the project
  directory. Add a `npx hyperframes assets prune` CLI command in a
  follow-up to delete unused entries.

## Suggested phase order for the next session

1. **Read this doc** end to end. Stop here if anything's unclear.
2. **Milestone A (SFX) backend**, then frontend. Verify against the
   `my-first-video` project — pick scene s04 and add a "broadcast static"
   SFX at scene-start.
3. **Milestone C (Gemini render review)** before B. Render review unlocks the
   feedback loop the rest of the work depends on; music can land afterward
   informed by retention data.
4. **Milestone B (Music)** wired into the music lane.
5. **Milestone D (image analysis)** as a small standalone PR — small scope,
   immediate UX win on the Images tab.
6. **Milestone E (per-scene scroll test)** — the retention killer feature.
7. **Milestone F (retention map)** — the final piece that ties it all
   together.

## State of the repo at handoff (2026-04-27)

- main HEAD: PR #24 (per-scene Director, theme try/revert, shortcuts, Claude
  Design docs) is the latest merge.
- Storyline cockpit is fully directing-capable: write-back, intent at three
  scopes (scene / storyline / project), reorder/insert/delete, inline edit,
  preview-sync, keyboard shortcuts, theme try/revert.
- Audio: voiceover via ElevenLabs is working. SFX + Music lanes are visible
  but empty — placeholder elements sit at `data-track-index=2,3` in every
  assembled HTML, ready to receive content.
- Existing `packages/core/src/elevenlabs/` has TTS + key-loader patterns to
  copy from for SFX + Music.
- `packages/core/src/anthropic/` has the structured-tool client pattern to
  copy from for Gemini.
- `packages/core/src/telemetry/cost.ts` already supports
  `kind: "elevenlabs"` cost entries; add `kind: "gemini"` when we wire it.

## Files this work will touch

```
packages/core/src/elevenlabs/
  sfx.ts                            (NEW)
  music.ts                          (NEW)
packages/core/src/gemini/
  index.ts                          (NEW)
  client.ts                         (NEW)
  env.ts                            (NEW — mirrors anthropic/env.ts)
packages/core/src/studio-api/routes/
  storyline.ts                      (extend with sfx/music/render-review/scroll-test)
packages/core/src/script/
  assemble.ts                       (read sfx.manifest.json + music.manifest.json,
                                     emit audio elements on tracks 3 + 2)
packages/core/src/telemetry/
  rates.ts                          (add gemini-2.5-flash + elevenlabs-music rates)
  cost.ts                           (add gemini cost-op kind)
packages/studio/src/components/storyline/
  SceneCard.tsx                     (add 🔊 Add SFX, 📉 Scroll test buttons)
packages/studio/src/components/sidebar/
  StorylineTab.tsx                  (Music wizard panel, Render-review panel,
                                     retention strip)
packages/studio/src/components/images/
  ImagesTab.tsx                     (auto-analyze on upload via Gemini)
```

## Done means

- A 16-scene project with voiceover gets 3-5 SFX, 1-2 music tracks, a Gemini
  render review with per-scene retention scores, and a horizontal retention
  map at the top of the Storyline tab — all generated from the user typing
  one to two prompts.
- Total cost per video: voiceover (~\$0.40) + SFX (~\$0.05) + music (~\$0.10) +
  Gemini reviews (~\$0.10) = under \$0.70 for the AI-augmented direction
  pipeline. Below the cost of a single render's compute time.
