/**
 * Audio-sync — chart entrance synced to spoken word timestamps.
 *
 * The retention-ladder skill's rule 2 ('Voice leads chart by 200–400ms')
 * is implemented here. After audio synthesis we have:
 *
 *   - A scene's narration text + audio file + measured duration
 *   - A word-level transcript at <projectDir>/transcript.json (when
 *     `hyperframes transcribe` has been run)
 *
 * For every chart-scene, we want the data layer to enter AT the moment
 * the speaker says the chart's lead number. This module is the matcher:
 * given a chart's props (which contain numeric values like 49.6, 1.4e12,
 * 99) and a transcript window (the speaker's timed words), find the
 * spoken word whose meaning matches the chart's lead value, and return
 * how many seconds INTO the scene that word starts.
 *
 * The chart-scene template's `dataDelaySec` prop then holds the data
 * layer at opacity 0 for that many seconds, so bars/lines/markers/pills
 * animate in UNDER the voiceover, not before or after.
 *
 * No I/O in this module — caller passes in the transcript words. Pure
 * helpers, easy to unit-test.
 */

/** A word from a Whisper transcript (or any timestamped transcript). */
export interface TranscriptWord {
  text: string;
  /** Start time in seconds, absolute on the master timeline. */
  start: number;
  /** End time in seconds, absolute on the master timeline. */
  end: number;
}

/** Result of a successful chart-lead match. */
export interface ChartLeadMatch {
  /** Seconds INTO the scene where the matching spoken word starts. */
  delaySec: number;
  /** The text that matched (joined if multi-word). Useful for logging. */
  matchedText: string;
  /** The chart-prop value the match resolved to. */
  matchedValue: number;
}

/**
 * Generate the spoken forms for a numeric value. Each chart's props might
 * carry the value 49.6 — the speaker could say "forty-nine point six",
 * "forty-nine point six percent", "49.6", "49.6 percent", and we want to
 * match any of them.
 *
 * Forms emitted (deduped, lowercase):
 *   - Digit form: "49.6"
 *   - Digit-point-digit: "49 point 6"
 *   - Words form (compact magnitudes only): "1.4 trillion", "$325 billion",
 *     "fifty million", etc. — we cover small integers + the suffixes that
 *     compact-money / compact-count emit.
 *
 * Conservative coverage: we don't try to spell out every possible reading,
 * just the most common patterns for editorial dataviz numbers (percents,
 * compact-money, integer counts).
 */
export function spokenForms(value: number): string[] {
  if (!Number.isFinite(value)) return [];
  const out = new Set<string>();
  const abs = Math.abs(value);

  // 1. Raw decimal form. 49.6 → "49.6".
  out.add(toLiteral(value));

  // 2. "X point Y" form. 49.6 → "49 point 6".
  if (!Number.isInteger(value)) {
    const [intPart, decPart] = String(value).split(".");
    if (intPart && decPart) {
      out.add(`${intPart} point ${decPart}`);
    }
  }

  // 3. Compact suffix forms. Speaker says "1.4 trillion" / "1.4T" — both
  //    map to the same value. We pre-compute the compact base + suffix.
  const suffixes: Array<[number, string]> = [
    [1e12, "trillion"],
    [1e9, "billion"],
    [1e6, "million"],
    [1e3, "thousand"],
  ];
  for (const [scale, word] of suffixes) {
    if (abs >= scale) {
      const compact = abs / scale;
      const compactStr = trimZero(compact);
      out.add(`${value < 0 ? "-" : ""}${compactStr} ${word}`);
      out.add(`${value < 0 ? "-" : ""}${compactStr}${word[0]}`); // 1.4T
    }
  }

  // 4. Small-integer word form. 1 → "one", 50 → "fifty". We only cover
  //    1-100 here; beyond that the digit form is what matters.
  if (Number.isInteger(value) && abs >= 1 && abs <= 100) {
    const w = integerToWords(Math.trunc(value));
    if (w) out.add(w);
  }

  // 5. Year-form integers (4-digit) often spoken as two-pair: 2024 →
  //    "twenty twenty-four" or "two thousand twenty-four". Add both.
  if (Number.isInteger(value) && abs >= 1900 && abs <= 2099) {
    const yr = Math.trunc(abs);
    const lo = yr % 100;
    const hi = Math.floor(yr / 100);
    const hiW = integerToWords(hi);
    const loW = lo === 0 ? "hundred" : integerToWords(lo);
    if (hiW && loW) out.add(`${hiW} ${loW}`);
    out.add(`two thousand ${integerToWords(yr - 2000) ?? ""}`.trim());
  }

  return Array.from(out).map((s) => s.toLowerCase());
}

function toLiteral(v: number): string {
  // Keep up to 2 decimals if present, never trailing zero.
  if (Number.isInteger(v)) return String(v);
  const s = v.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return s;
}

function trimZero(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1).replace(/\.0$/, "");
}

const ONES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function integerToWords(n: number): string | null {
  if (n < 0 || n > 100 || !Number.isInteger(n)) return null;
  if (n < 20) return ONES[n] ?? null;
  if (n === 100) return "one hundred";
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o === 0 ? (TENS[t] ?? null) : `${TENS[t]}-${ONES[o]}`;
}

/**
 * Extract the chart's "lead values" — the numbers the speaker is most
 * likely to mention when introducing the chart. This is a coarse heuristic
 * that walks the chart props and pulls out:
 *   - bar values (grouped-bars: every value across every series)
 *   - point y-values (annotated-area, line charts)
 *   - center value (donut-ring)
 *   - explicit numeric props (percent, value, etc.)
 *
 * Order matters: returns values in priority order — first values are
 * tried first. The matcher uses the FIRST one whose spoken form appears
 * in the transcript, so put the most-likely-to-be-said first.
 */
export function extractChartLeadValues(chartProps: unknown): number[] {
  if (!chartProps || typeof chartProps !== "object") return [];
  const props = chartProps as Record<string, unknown>;
  const out: number[] = [];

  // Series-of-series (grouped-bars). Walk each series' values.
  if (Array.isArray(props.series)) {
    for (const s of props.series) {
      if (s && typeof s === "object" && Array.isArray((s as { values?: unknown }).values)) {
        for (const v of (s as { values: unknown[] }).values) {
          const num = Number(v);
          if (Number.isFinite(num)) out.push(num);
        }
      }
    }
  }

  // Single-series points (annotated-area, divergence-lines).
  if (Array.isArray(props.points)) {
    for (const p of props.points) {
      if (p && typeof p === "object" && "y" in p) {
        const num = Number((p as { y: unknown }).y);
        if (Number.isFinite(num)) out.push(num);
      }
    }
  }

  // Bar items (proportional-bars, waterfall-bars).
  if (Array.isArray(props.items)) {
    for (const it of props.items) {
      if (it && typeof it === "object" && "value" in it) {
        const num = Number((it as { value: unknown }).value);
        if (Number.isFinite(num)) out.push(num);
      }
    }
  }

  // Donut center value. Could be "99%" string or 99 number.
  for (const key of ["percent", "centerValue", "value", "endValue"]) {
    const v = props[key];
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
    else if (typeof v === "string") {
      const stripped = v.replace(/[$%,A-Za-z\s]/g, "");
      const num = Number(stripped);
      if (Number.isFinite(num)) out.push(num);
    }
  }

  // Dedup while preserving first-seen order.
  return [...new Set(out)];
}

export interface FindChartLeadOptions {
  /** Chart props (the inner chart.props, not the chart-scene props). */
  chartProps: unknown;
  /** Transcript words covering this scene (start times absolute on master timeline). */
  transcriptWindow: TranscriptWord[];
  /** Scene start time on the master timeline. delaySec returns are relative to this. */
  sceneStartSec: number;
  /** Lead time — pull the data entry forward by this many seconds so the bars rise WITH the word. Default 0.25. */
  leadSec?: number;
}

/**
 * Search the transcript for the first spoken form of any chart-lead
 * value. Returns the start time of that word (relative to the scene's
 * start) minus a small lead so the data animation crests with the word.
 *
 * If nothing matches, returns null — the assembler should leave
 * dataDelaySec at whatever the author set.
 */
export function findChartLeadInTranscript(opts: FindChartLeadOptions): ChartLeadMatch | null {
  const { chartProps, transcriptWindow, sceneStartSec, leadSec = 0.25 } = opts;
  if (transcriptWindow.length === 0) return null;
  const values = extractChartLeadValues(chartProps);
  if (values.length === 0) return null;

  // Pre-tokenise the transcript window into a lowercase string + a parallel
  // array of word-start positions, so we can do a substring search and
  // recover the start time from the position.
  const tokens: string[] = [];
  const tokenStarts: number[] = [];
  for (const w of transcriptWindow) {
    const text = w.text.replace(/[^a-zA-Z0-9.-]+/g, "").toLowerCase();
    if (!text) continue;
    tokens.push(text);
    tokenStarts.push(w.start);
  }
  const joined = tokens.join(" ");

  for (const value of values) {
    const forms = spokenForms(value);
    for (const form of forms) {
      const idx = joined.indexOf(form);
      if (idx < 0) continue;
      // Map the character offset back to a token index.
      let charCount = 0;
      let tokenIdx = 0;
      for (let i = 0; i < tokens.length; i++) {
        if (charCount >= idx) {
          tokenIdx = i;
          break;
        }
        charCount += (tokens[i] ?? "").length + 1; // +1 for the space
      }
      const wordStart = tokenStarts[tokenIdx];
      if (wordStart === undefined) continue;
      const delaySec = Math.max(0, wordStart - sceneStartSec - leadSec);
      return {
        delaySec,
        matchedText: form,
        matchedValue: value,
      };
    }
  }
  return null;
}
