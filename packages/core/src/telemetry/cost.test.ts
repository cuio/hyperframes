import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CostLogger, computeCost, timed, DEFAULT_RATES, type CostOp } from "./cost.js";
import { loadRates } from "./rates.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "cost-test-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("computeCost", () => {
  it("prices Anthropic input + output tokens", () => {
    const op: CostOp = {
      kind: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    };
    // Sonnet defaults: 3 in, 15 out
    expect(computeCost(DEFAULT_RATES, op)).toBeCloseTo(18, 5);
  });

  it("prices cache-read + cache-write tokens at their own rates", () => {
    // 1M input total, 600k cached read, 100k cache create — the remaining 300k
    // is billable at full input rate.
    const op: CostOp = {
      kind: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadInputTokens: 600_000,
      cacheCreationInputTokens: 100_000,
    };
    // 0.3M * 3 + 0.6M * 0.3 + 0.1M * 3.75 = 0.9 + 0.18 + 0.375 = 1.455
    expect(computeCost(DEFAULT_RATES, op)).toBeCloseTo(1.455, 4);
  });

  it("prices ElevenLabs by character count", () => {
    const op: CostOp = { kind: "elevenlabs", voiceId: "v1", characters: 500_000 };
    expect(computeCost(DEFAULT_RATES, op)).toBeCloseTo(15, 5);
  });

  it("prices render by wall-time minutes", () => {
    const op: CostOp = {
      kind: "render",
      durationSeconds: 600,
      framesCaptured: 18000,
      quality: "draft",
      fps: 30,
      outputBytes: 1_000_000,
    };
    expect(computeCost(DEFAULT_RATES, op)).toBeCloseTo(1, 5);
  });

  it("falls back to a sane default model rate for unknown models", () => {
    const op: CostOp = {
      kind: "anthropic",
      model: "claude-future-9000",
      inputTokens: 1_000_000,
      outputTokens: 0,
    };
    expect(computeCost(DEFAULT_RATES, op)).toBeGreaterThan(0);
  });

  it("treats vision ops the same as anthropic ops for pricing", () => {
    const op: CostOp = {
      kind: "vision",
      model: "claude-sonnet-4-6",
      inputTokens: 2000,
      outputTokens: 200,
      imageCount: 1,
    };
    expect(computeCost(DEFAULT_RATES, op)).toBeGreaterThan(0);
  });
});

describe("CostLogger", () => {
  it("appends a JSONL entry to <project>/.hyperframes/costs.jsonl", async () => {
    const logger = new CostLogger(tmp);
    const entry = await logger.log(
      "script.plan",
      {
        kind: "anthropic",
        model: "claude-sonnet-4-6",
        inputTokens: 100,
        outputTokens: 50,
      },
      1234,
      { sceneCount: 8 },
    );
    expect(entry.costUsd).toBeGreaterThan(0);
    expect(entry.wallMs).toBe(1234);
    expect(entry.op).toBe("script.plan");
    expect(entry.meta).toEqual({ sceneCount: 8 });
    const path = join(tmp, ".hyperframes", "costs.jsonl");
    const content = readFileSync(path, "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed.op).toBe("script.plan");
    expect(parsed.projectId).toBe(tmp.split("/").pop());
  });

  it("creates the .hyperframes dir if missing", async () => {
    const logger = new CostLogger(tmp);
    await logger.log(
      "render",
      {
        kind: "render",
        durationSeconds: 60,
        framesCaptured: 1800,
        quality: "draft",
        fps: 30,
        outputBytes: 1_000,
      },
      60_000,
    );
    expect(readFileSync(join(tmp, ".hyperframes", "costs.jsonl"), "utf-8")).toContain(
      `"op":"render"`,
    );
  });

  it("read() returns all logged entries", async () => {
    const logger = new CostLogger(tmp);
    await logger.log("a", { kind: "elevenlabs", voiceId: "v", characters: 100 }, 50);
    await logger.log("b", { kind: "elevenlabs", voiceId: "v", characters: 200 }, 60);
    const entries = logger.read();
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.op)).toEqual(["a", "b"]);
  });

  it("read() skips malformed lines without throwing", () => {
    const dir = join(tmp, ".hyperframes");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "costs.jsonl"),
      `{"ts":"x","projectId":"p","op":"a","wallMs":1,"costUsd":0,"details":{"kind":"render","durationSeconds":1,"framesCaptured":1,"quality":"draft","fps":30,"outputBytes":1}}\n` +
        `not json\n` +
        `{"ts":"y","projectId":"p","op":"b","wallMs":1,"costUsd":0,"details":{"kind":"render","durationSeconds":1,"framesCaptured":1,"quality":"draft","fps":30,"outputBytes":1}}\n`,
    );
    const logger = new CostLogger(tmp);
    const entries = logger.read();
    expect(entries.map((e) => e.op)).toEqual(["a", "b"]);
  });

  it("serializes concurrent writes via withMutex", async () => {
    const logger = new CostLogger(tmp);
    const ops = Array.from({ length: 20 }, (_, i) =>
      logger.log(`op-${i}`, { kind: "elevenlabs", voiceId: "v", characters: i }, i),
    );
    await Promise.all(ops);
    const entries = logger.read();
    expect(entries).toHaveLength(20);
    const ordered = entries.map((e) => e.op).sort();
    expect(ordered).toEqual(Array.from({ length: 20 }, (_, i) => `op-${i}`).sort());
  });

  it("read() returns empty list when log doesn't exist yet", () => {
    const logger = new CostLogger(tmp);
    expect(logger.read()).toEqual([]);
  });

  it("loadRates merges project override on top of defaults", () => {
    const cfgDir = join(tmp, ".hyperframes");
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(join(cfgDir, "cost-rates.json"), JSON.stringify({ render: { perMinute: 0.5 } }));
    const rates = loadRates(tmp);
    expect(rates.render.perMinute).toBe(0.5);
    expect(rates.elevenlabs.perMChar).toBe(DEFAULT_RATES.elevenlabs.perMChar);
  });

  it("loadRates ignores malformed override JSON without crashing", () => {
    const cfgDir = join(tmp, ".hyperframes");
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(join(cfgDir, "cost-rates.json"), "{ not valid json");
    expect(() => loadRates(tmp)).not.toThrow();
    expect(loadRates(tmp).render.perMinute).toBe(DEFAULT_RATES.render.perMinute);
  });
});

describe("timed", () => {
  it("returns the result and a positive wallMs", async () => {
    const { result, wallMs } = await timed(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return 42;
    });
    expect(result).toBe(42);
    expect(wallMs).toBeGreaterThanOrEqual(5);
  });

  it("propagates errors and the caller can still measure", async () => {
    await expect(
      timed(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});
