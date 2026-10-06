// Unit tests for src/lib/thumbnailGenQueue.ts.
//
// The queue owns module-level singletons (pendingQueue/pendingSet/callbacks and
// an active counter), so each test re-imports it fresh via `vi.resetModules()` +
// dynamic import. `generate_thumbnail` (api/core invoke) and `convertFileSrc`
// (consumed through thumbnailCache) are mocked.
import { beforeEach, describe, expect, it, vi } from "vitest";

const coreMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${encodeURIComponent(path)}`),
}));
const loggerFns = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => coreMocks);
vi.mock("../../services/tauri", () => ({ logger: loggerFns }));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Drain pending microtasks (enqueue → invoke → thumbnailUrl chain). */
async function flushMicrotasks(times = 25): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

type QueueModule = typeof import("../../lib/thumbnailGenQueue");

async function loadQueue(): Promise<QueueModule> {
  return await import("../../lib/thumbnailGenQueue");
}

beforeEach(() => {
  vi.resetModules();
  coreMocks.invoke.mockReset();
  coreMocks.convertFileSrc.mockClear();
  Object.values(loggerFns).forEach((fn) => fn.mockReset());
});

describe("thumbnailGenQueue — dedup", () => {
  it("issues one invoke per pending movieId and keeps only the latest callback", async () => {
    const gen = deferred<string>();
    coreMocks.invoke.mockReturnValue(gen.promise);
    const queue = await loadQueue();

    const fromA: string[] = [];
    const fromB: string[] = [];
    queue.enqueueThumbnailGen(1, (url) => fromA.push(url));
    queue.enqueueThumbnailGen(1, (url) => fromB.push(url)); // remount: replaces cb

    // :74-78 — already queued/generating, so no second invoke.
    expect(coreMocks.invoke).toHaveBeenCalledTimes(1);
    expect(coreMocks.invoke).toHaveBeenCalledWith("generate_thumbnail", {
      movieId: 1,
    });

    gen.resolve("/cache/thumbnails/1.jpg");
    await flushMicrotasks();

    // The swapped-in callback won; the first one is never called.
    expect(fromA).toEqual([]);
    expect(fromB).toHaveLength(1);

    // The callback URL points at the generated file via the asset protocol.
    expect(coreMocks.convertFileSrc).toHaveBeenCalledWith("/cache/thumbnails/1.jpg");
    expect(fromB[0]).toMatch(/^asset:\/\/localhost\/%2Fcache%2Fthumbnails%2F1\.jpg\?v=\d+$/);

    // Completion removed the movieId from the dedup guard: retry re-invokes.
    coreMocks.invoke.mockResolvedValue("/cache/thumbnails/1.jpg");
    queue.enqueueThumbnailGen(1, () => {});
    expect(coreMocks.invoke).toHaveBeenCalledTimes(2);
    await flushMicrotasks(); // let the retry chain finish before state resets
  });
});

describe("thumbnailGenQueue — cache busting", () => {
  it("nonce-busts the URL so an in-place rewrite is re-fetched", async () => {
    coreMocks.invoke.mockResolvedValue("/cache/thumbnails/5.jpg");
    const now = vi.spyOn(Date, "now");
    let tick = 1_730_000_000_000;
    now.mockImplementation(() => ++tick);
    const queue = await loadQueue();

    const urls: string[] = [];
    queue.enqueueThumbnailGen(5, (url) => urls.push(url));
    await flushMicrotasks();
    queue.enqueueThumbnailGen(5, (url) => urls.push(url)); // retry, same path
    await flushMicrotasks();

    expect(urls).toHaveLength(2);
    // Both URLs target the same file but carry distinct ?v= nonces.
    expect(urls[0]).toMatch(/\?v=1730000000001$/);
    expect(urls[1]).toMatch(/\?v=1730000000002$/);
    expect(urls[0].split("?")[0]).toBe(urls[1].split("?")[0]);
    expect(urls[0]).not.toBe(urls[1]);
    now.mockRestore();
  });
});

describe("thumbnailGenQueue — concurrency", () => {
  it("runs at most 2 generations at once and drains the queue FIFO", async () => {
    const gens = new Map<number, Deferred<string>>();
    coreMocks.invoke.mockImplementation((_cmd: unknown, args: unknown) => {
      const d = deferred<string>();
      gens.set((args as { movieId: number }).movieId, d);
      return d.promise;
    });
    const queue = await loadQueue();

    const completed: number[] = [];
    for (const id of [1, 2, 3, 4]) {
      queue.enqueueThumbnailGen(id, (_url, _path) => completed.push(id));
    }

    // MAX_GENERATING=2 — only the first two movies were dispatched. The Rust
    // generation stays rate-limited even though image loading no longer is.
    expect(coreMocks.invoke).toHaveBeenCalledTimes(2);
    expect(coreMocks.invoke.mock.calls.map((c) => c[1])).toEqual([
      { movieId: 1 },
      { movieId: 2 },
    ]);

    gens.get(1)!.resolve("/t/1.jpg");
    await flushMicrotasks();
    expect(coreMocks.invoke).toHaveBeenCalledTimes(3);
    expect(coreMocks.invoke.mock.calls[2][1]).toEqual({ movieId: 3 });
    expect(completed).toEqual([1]);

    gens.get(2)!.resolve("/t/2.jpg");
    await flushMicrotasks();
    expect(coreMocks.invoke).toHaveBeenCalledTimes(4);
    expect(coreMocks.invoke.mock.calls[3][1]).toEqual({ movieId: 4 });

    gens.get(3)!.resolve("/t/3.jpg");
    gens.get(4)!.resolve("/t/4.jpg");
    await flushMicrotasks();
    expect(completed).toEqual([1, 2, 3, 4]);
  });
});

describe("thumbnailGenQueue — failure handling", () => {
  it("silently skips a movie whose invoke rejects and allows a retry", async () => {
    coreMocks.invoke.mockRejectedValue(new Error("no poster found"));
    const queue = await loadQueue();

    const cb = vi.fn();
    expect(() => queue.enqueueThumbnailGen(9, cb)).not.toThrow();
    await flushMicrotasks();

    expect(cb).not.toHaveBeenCalled();
    expect(loggerFns.info).toHaveBeenCalledWith(
      expect.stringContaining("跳过")
    );

    // :33 finally-cleanup removed the guard — the same movie can be re-enqueued.
    coreMocks.invoke.mockResolvedValue("/t/9.jpg");
    queue.enqueueThumbnailGen(9, cb);
    expect(coreMocks.invoke).toHaveBeenCalledTimes(2);
    await flushMicrotasks();
  });

  it("fires the callback as soon as the command returns the path", async () => {
    // Unlike the Blob-cache era there is no follow-up read that can fail: the
    // asset URL is built synchronously from the returned path.
    coreMocks.invoke.mockResolvedValue("/t/ok.jpg");
    const queue = await loadQueue();

    const cb = vi.fn();
    queue.enqueueThumbnailGen(11, cb);
    await flushMicrotasks();

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(
      expect.stringContaining("asset://localhost/%2Ft%2Fok.jpg"),
      "/t/ok.jpg"
    );
    expect(loggerFns.error).not.toHaveBeenCalled();
  });
});
