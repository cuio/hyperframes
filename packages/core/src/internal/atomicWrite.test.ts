import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicWriteFileSync, withMutex } from "./atomicWrite.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "atomic-write-test-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("atomicWriteFileSync", () => {
  it("writes the content and creates parent dirs", () => {
    const path = join(tmp, "deep", "nested", "out.txt");
    atomicWriteFileSync(path, "hello");
    expect(readFileSync(path, "utf-8")).toBe("hello");
  });

  it("respects file mode", () => {
    const path = join(tmp, "secret.env");
    atomicWriteFileSync(path, "K=v\n", { mode: 0o600 });
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("does not leave a temp file on success", () => {
    const path = join(tmp, "out.txt");
    atomicWriteFileSync(path, "ok");
    const entries = readdirSync(tmp);
    expect(entries.filter((e) => e.includes(".tmp."))).toEqual([]);
  });

  it("accepts a Uint8Array payload", () => {
    const path = join(tmp, "bin.bin");
    const bytes = new Uint8Array([1, 2, 3, 4]);
    atomicWriteFileSync(path, bytes);
    const buf = readFileSync(path);
    expect(Array.from(buf)).toEqual([1, 2, 3, 4]);
  });

  it("overwrites an existing file atomically", () => {
    const path = join(tmp, "out.txt");
    atomicWriteFileSync(path, "first");
    atomicWriteFileSync(path, "second");
    expect(readFileSync(path, "utf-8")).toBe("second");
  });
});

describe("withMutex", () => {
  it("serializes concurrent calls with the same key", async () => {
    const order: string[] = [];
    const a = withMutex("k", async () => {
      order.push("a-start");
      await new Promise((r) => setTimeout(r, 10));
      order.push("a-end");
      return "A";
    });
    const b = withMutex("k", async () => {
      order.push("b-start");
      await new Promise((r) => setTimeout(r, 10));
      order.push("b-end");
      return "B";
    });
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toBe("A");
    expect(rb).toBe("B");
    expect(order).toEqual(["a-start", "a-end", "b-start", "b-end"]);
  });

  it("does not block calls with different keys", async () => {
    const order: string[] = [];
    const a = withMutex("ka", async () => {
      order.push("a-start");
      await new Promise((r) => setTimeout(r, 20));
      order.push("a-end");
    });
    const b = withMutex("kb", async () => {
      order.push("b-start");
      order.push("b-end");
    });
    await Promise.all([a, b]);
    // b should be able to slot between a-start and a-end
    expect(order.indexOf("b-start")).toBeLessThan(order.indexOf("a-end"));
  });

  it("propagates errors but releases the lock so the next call can run", async () => {
    let firstErr: unknown = null;
    try {
      await withMutex("k", async () => {
        throw new Error("boom");
      });
    } catch (e) {
      firstErr = e;
    }
    expect(firstErr).toBeInstanceOf(Error);
    const result = await withMutex("k", async () => "after");
    expect(result).toBe("after");
  });
});
