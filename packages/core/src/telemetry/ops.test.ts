import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpsLogger, opsFireAndForget, type OpEntry } from "./ops.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "ops-test-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("OpsLogger", () => {
  it("appends a JSONL entry to <project>/.hyperframes/ops.jsonl", async () => {
    const logger = new OpsLogger(tmp);
    const entry = await logger.log({
      op: "lint.run",
      message: "0 errors, 0 warnings",
      wallMs: 320,
      meta: { fileCount: 12 },
    });
    expect(entry).toBeDefined();
    expect(entry?.op).toBe("lint.run");
    expect(entry?.level).toBe("info");
    expect(entry?.ok).toBe(true);
    const path = join(tmp, ".hyperframes", "ops.jsonl");
    const parsed = JSON.parse(readFileSync(path, "utf-8").trim()) as OpEntry;
    expect(parsed.message).toBe("0 errors, 0 warnings");
    expect(parsed.meta).toEqual({ fileCount: 12 });
  });

  it("logError captures an error message and a clipped stack", async () => {
    const logger = new OpsLogger(tmp);
    let entry: OpEntry | null = null;
    try {
      throw new Error("boom");
    } catch (err) {
      entry = await logger.logError("script.plan", err, { sceneId: "s01" });
    }
    expect(entry).toBeDefined();
    expect(entry?.level).toBe("error");
    expect(entry?.ok).toBe(false);
    expect(entry?.message).toBe("boom");
    expect((entry?.meta as Record<string, unknown>)?.sceneId).toBe("s01");
    expect((entry?.meta as Record<string, unknown>)?.stack).toContain("boom");
  });

  it("respects minLevel filter (debug entries dropped at info default)", async () => {
    const logger = new OpsLogger(tmp);
    const dropped = await logger.log({ op: "debug.heartbeat", message: "tick", level: "debug" });
    expect(dropped).toBeNull();
    expect(logger.read()).toEqual([]);
  });

  it("debug entries pass when minLevel is debug", async () => {
    const logger = new OpsLogger(tmp, { minLevel: "debug" });
    const entry = await logger.log({ op: "debug.heartbeat", message: "tick", level: "debug" });
    expect(entry).toBeDefined();
    expect(logger.read()).toHaveLength(1);
  });

  it("read() skips malformed lines", async () => {
    const logger = new OpsLogger(tmp);
    await logger.log({ op: "a", message: "first" });
    await logger.log({ op: "b", message: "second" });
    const path = join(tmp, ".hyperframes", "ops.jsonl");
    const content = readFileSync(path, "utf-8");
    const fs = await import("node:fs");
    fs.writeFileSync(path, content + "garbage line not json\n");
    const entries = logger.read();
    expect(entries.map((e) => e.op)).toEqual(["a", "b"]);
  });

  it("serializes concurrent writes via withMutex", async () => {
    const logger = new OpsLogger(tmp);
    const ops = Array.from({ length: 25 }, (_, i) =>
      logger.log({ op: `op-${i}`, message: `m${i}` }),
    );
    await Promise.all(ops);
    const entries = logger.read();
    expect(entries).toHaveLength(25);
  });

  it("opsFireAndForget returns synchronously and the entry shows up after a tick", async () => {
    const logger = new OpsLogger(tmp);
    expect(() => opsFireAndForget(logger, { op: "x", message: "y" })).not.toThrow();
    // wait for the fire-and-forget write to flush
    await new Promise((r) => setTimeout(r, 30));
    expect(logger.read().map((e) => e.op)).toContain("x");
  });
});
