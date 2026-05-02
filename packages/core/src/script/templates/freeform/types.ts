/**
 * Type contracts for the freeform Gemini-generated scene path.
 *
 * Architectural overview:
 *
 *   ┌──── planner ────┐
 *   │ picks template:  │
 *   │   "freeform"      │
 *   └──────┬──────────┘
 *          ▼
 *   ┌─ resolveFreeformScenes() ─────────────────────────────────┐
 *   │ For each freeform scene:                                  │
 *   │  1. cache key = SHA256(narration + profile + tokens)     │
 *   │  2. cache hit? → reuse                                    │
 *   │  3. miss?      → Gemini call → validator → cache         │
 *   │  4. mutate scene.props.generatedHtml = result            │
 *   └────────────────────┬──────────────────────────────────────┘
 *                        ▼
 *   ┌─ assembleMaster() ────────────────────────────────────────┐
 *   │ freeform template's render() emits scene.props.generatedHtml │
 *   │ verbatim — synchronous, no Gemini call here.              │
 *   └───────────────────────────────────────────────────────────┘
 *
 * Why a pre-assembly resolution step:
 *   `assembleMaster()` is sync and called from many places (CLI, studio
 *   API, optimizer loop). Making it async would ripple through every
 *   caller. Resolving freeform scenes BEFORE assembly keeps the existing
 *   contract intact — the scene reaches the template with its HTML
 *   already in `props.generatedHtml`.
 *
 * The cache is project-local (`.hyperframes/freeform-cache/`) so a
 * re-render with the same script + profile + theme is free. Changing any
 * of those three rotates the hash and triggers regeneration.
 */

/**
 * Result of a single freeform-scene generation. Stored on disk under the
 * cache hash; round-trips through the validator on every read so a
 * tampered cache file can't inject untrusted HTML at render time.
 */
export interface FreeformGeneration {
  /** The validated HTML emitted as the scene's body. Already scope-locked
   *  to the scene id; safe to drop into the assembled master HTML. */
  html: string;
  /** Gemini model that produced this. Stamped for audit; the cache key
   *  doesn't include the model so swapping to a smarter model doesn't
   *  invalidate every cached scene unless the user explicitly clears. */
  model: string;
  /** ISO timestamp of generation. */
  generatedAt: string;
  /** Token usage for the cost log. */
  usage: {
    promptTokens: number;
    outputTokens: number;
  };
}

/**
 * Inputs that go into the cache key. Anything that affects what the
 * scene SHOULD look like belongs here; anything cosmetic (telemetry,
 * model id) does not.
 */
export interface FreeformCacheKey {
  /** Narration text — re-synth invalidates cache. */
  narration: string;
  /** Scene id — kept in the key so swapping a scene's id forces a
   *  regen. The id is in the rendered HTML's outer wrapper, so two
   *  different ids produce different output even with identical
   *  narration. */
  sceneId: string;
  /** The portion of the reference profile the generator reads.
   *  Stringified before hashing for deterministic key generation. */
  referenceProfileShape: {
    vibe?: string;
    palette?: string[];
    typographyEnergy?: string;
    pacingDensity?: string;
    motionVibe?: string;
  };
  /** The theme tokens the generator reads. */
  themeTokens: {
    bg: string;
    fg: string;
    accent: string;
    accent2: string;
    fontDisplay: string;
    fontMono: string;
  };
  /** Generator version — bump to invalidate every cached scene when the
   *  prompt or validator rules change in a breaking way. */
  generatorVersion: number;
}

/**
 * Validator outcome. The validator is the entire safety surface — every
 * Gemini-generated string passes through it before being persisted or
 * rendered. Runs on cache reads too (defense against tampered files).
 */
export interface ValidationResult {
  ok: boolean;
  /** When ok=true, this is the canonicalized HTML (whitespace
   *  normalized, scope-locked). When ok=false, undefined. */
  html?: string;
  /** Per-rule violations. Empty when ok=true. */
  violations: Array<{
    rule: string;
    message: string;
    /** Severity tier. `error` blocks the scene; `warn` is logged but
     *  doesn't reject. Today every rule is `error`; `warn` reserved
     *  for future style-only checks. */
    severity: "error" | "warn";
  }>;
}

/**
 * Public options for the per-scene generator. Caller (the resolver in
 * the assembler hook) provides everything; the generator reaches no
 * other state.
 */
export interface GenerateFreeformSceneOptions {
  apiKey: string;
  sceneId: string;
  /** The narration that ElevenLabs will speak. The visual must support
   *  this exact text — Gemini reads it as both content prior AND timing
   *  proxy (longer narration → more visual beats). */
  narration: string;
  /** Optional accent word the planner pulled from narration. The
   *  generator weights it as the scene's focal element. */
  accentWord?: string;
  /** True when this is a hook (first 0–30s) — generator pushes more
   *  motion / chromatic intensity. */
  isHook?: boolean;
  /** Theme tokens the generator must use. The bg/fg/accent palette
   *  drives every color choice; the fonts must appear in declarations. */
  themeTokens: FreeformCacheKey["themeTokens"];
  /** Reference profile (subset that affects visuals). Optional — when
   *  absent the generator falls back to the active theme alone. */
  referenceProfile?: FreeformCacheKey["referenceProfileShape"];
  /** Override the model. Default: gemini-2.5-flash. */
  model?: string;
  /** Cap on Gemini output length. The validator rejects anything
   *  larger; setting this here lets the prompt budget ahead of time. */
  maxOutputBytes?: number;
}
