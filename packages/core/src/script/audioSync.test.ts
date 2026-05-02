import { describe, it, expect } from "vitest";
import {
  spokenForms,
  extractChartLeadValues,
  findChartLeadInTranscript,
  type TranscriptWord,
} from "./audioSync.js";

describe("spokenForms", () => {
  it("returns the digit form for any finite value", () => {
    const f = spokenForms(49.6);
    expect(f).toContain("49.6");
  });
  it("emits 'X point Y' for decimals", () => {
    const f = spokenForms(49.6);
    expect(f).toContain("49 point 6");
  });
  it("emits compact-suffix forms for large magnitudes", () => {
    const f = spokenForms(1.4e12);
    expect(f).toContain("1.4 trillion");
    expect(f).toContain("1.4t");
  });
  it("emits both billion and trillion forms when applicable", () => {
    const f = spokenForms(325e9);
    expect(f).toContain("325 billion");
  });
  it("emits word form for small integers", () => {
    expect(spokenForms(5)).toContain("five");
    expect(spokenForms(50)).toContain("fifty");
    expect(spokenForms(99)).toContain("ninety-nine");
  });
  it("emits year forms for 1900-2099 integers", () => {
    const f = spokenForms(2024);
    expect(f).toContain("twenty twenty-four");
  });
  it("returns empty for non-finite input", () => {
    expect(spokenForms(NaN)).toEqual([]);
    expect(spokenForms(Infinity)).toEqual([]);
  });
  it("dedupes when forms overlap", () => {
    const f = spokenForms(50);
    const set = new Set(f);
    expect(set.size).toBe(f.length);
  });
});

describe("extractChartLeadValues", () => {
  it("pulls values out of grouped-bars series", () => {
    const v = extractChartLeadValues({
      series: [
        { name: "S1", values: [27, 14, 3] },
        { name: "S2", values: [29, 18, 18] },
      ],
    });
    expect(v).toEqual([27, 14, 3, 29, 18]);
  });
  it("pulls y values out of point arrays (annotated-area)", () => {
    const v = extractChartLeadValues({
      points: [
        { x: "Q1", y: 0 },
        { x: "Q2", y: 50 },
      ],
    });
    expect(v).toEqual([0, 50]);
  });
  it("pulls value out of bar items", () => {
    const v = extractChartLeadValues({
      items: [
        { label: "A", value: 100 },
        { label: "B", value: 200 },
      ],
    });
    expect(v).toEqual([100, 200]);
  });
  it("pulls percent + centerValue numbers from donut-ring", () => {
    const v = extractChartLeadValues({ percent: 99, centerValue: "99%" });
    expect(v).toContain(99);
  });
  it("strips $/comma/letters from string centerValue and parses", () => {
    const v = extractChartLeadValues({ centerValue: "$1,234" });
    expect(v).toContain(1234);
  });
  it("returns empty for missing/malformed input", () => {
    expect(extractChartLeadValues(null)).toEqual([]);
    expect(extractChartLeadValues({})).toEqual([]);
    expect(extractChartLeadValues({ series: "not-an-array" })).toEqual([]);
  });
});

describe("findChartLeadInTranscript", () => {
  const transcript: TranscriptWord[] = [
    { text: "In", start: 10.0, end: 10.2 },
    { text: "2024", start: 10.2, end: 10.7 },
    { text: "bot", start: 10.7, end: 10.9 },
    { text: "traffic", start: 10.9, end: 11.3 },
    { text: "hit", start: 11.3, end: 11.5 },
    { text: "49.6", start: 11.5, end: 12.0 },
    { text: "percent", start: 12.0, end: 12.5 },
  ];

  it("finds the spoken form of a chart's lead value", () => {
    const m = findChartLeadInTranscript({
      chartProps: { points: [{ x: "Q1", y: 49.6 }] },
      transcriptWindow: transcript,
      sceneStartSec: 10.0,
      leadSec: 0.25,
    });
    expect(m).not.toBeNull();
    expect(m?.matchedValue).toBe(49.6);
    // 49.6 starts at 11.5s absolute, scene starts at 10.0s, lead 0.25 →
    // delaySec = 11.5 - 10.0 - 0.25 = 1.25
    expect(m?.delaySec).toBeCloseTo(1.25, 2);
  });
  it("returns null when no chart values appear in the transcript", () => {
    const m = findChartLeadInTranscript({
      chartProps: { points: [{ x: "Q1", y: 99 }] },
      transcriptWindow: transcript,
      sceneStartSec: 10.0,
    });
    expect(m).toBeNull();
  });
  it("returns null with empty transcript window", () => {
    const m = findChartLeadInTranscript({
      chartProps: { points: [{ x: "Q1", y: 50 }] },
      transcriptWindow: [],
      sceneStartSec: 0,
    });
    expect(m).toBeNull();
  });
  it("returns null when chart props have no extractable values", () => {
    const m = findChartLeadInTranscript({
      chartProps: { events: [{ date: "Q1" }] }, // no numbers
      transcriptWindow: transcript,
      sceneStartSec: 10.0,
    });
    expect(m).toBeNull();
  });
  it("clamps delaySec to non-negative even if word starts before scene", () => {
    const m = findChartLeadInTranscript({
      chartProps: { points: [{ x: "Q1", y: 49.6 }] },
      transcriptWindow: transcript,
      sceneStartSec: 12.0, // way after the spoken word
      leadSec: 0.25,
    });
    expect(m?.delaySec).toBeGreaterThanOrEqual(0);
  });
});
