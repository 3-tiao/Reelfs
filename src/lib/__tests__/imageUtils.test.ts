// Unit tests for src/lib/imageUtils.ts.
//
// imageUtils is stateless, but it talks to Tauri (`check_file_exists` invoke) —
// mocked here. The `check_file_exists` stubs below hand out one deferred per
// path so batch scheduling (concurrency inside a batch, priority across
// batches) can be observed deterministically.
import { beforeEach, describe, expect, it, vi } from "vitest";

const coreMocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: coreMocks.invoke }));

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

/** Drain pending microtasks (batch await + result scan). */
async function flushMicrotasks(times = 25): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

type ImageUtilsModule = typeof import("../../lib/imageUtils");

async function loadImageUtils(): Promise<ImageUtilsModule> {
  return await import("../../lib/imageUtils");
}

/** invoke stub resolving per-path booleans from a plain map. */
function mockExistsByPath(exists: Record<string, boolean>) {
  coreMocks.invoke.mockImplementation((_cmd: unknown, args: unknown) => {
    return Promise.resolve(exists[(args as { path: string }).path] ?? false);
  });
}

/** invoke stub handing out one deferred<boolean> per requested path. */
function mockExistsDeferred(map: Map<string, Deferred<boolean>>) {
  coreMocks.invoke.mockImplementation((_cmd: unknown, args: unknown) => {
    const d = deferred<boolean>();
    map.set((args as { path: string }).path, d);
    return d.promise;
  });
}

beforeEach(() => {
  vi.resetModules();
  coreMocks.invoke.mockReset();
});

describe("findFirstExisting", () => {
  it("returns the first existing path of the first batch and skips later batches", async () => {
    const pending = new Map<string, Deferred<boolean>>();
    mockExistsDeferred(pending);
    const mod = await loadImageUtils();

    const paths = ["/a.avi", "/b.avi", "/c.avi", "/d.avi", "/e.avi"];
    const result = mod.findFirstExisting(paths);

    // Default batchSize=4: exactly the first four candidates were queried.
    expect(coreMocks.invoke).toHaveBeenCalledTimes(4);
    expect(coreMocks.invoke.mock.calls.map((c) => c[0])).toEqual(
      Array(4).fill("check_file_exists")
    );
    expect(coreMocks.invoke.mock.calls.map((c) => (c[1] as { path: string }).path)).toEqual(
      paths.slice(0, 4)
    );

    pending.get("/a.avi")!.resolve(false);
    pending.get("/b.avi")!.resolve(false);
    pending.get("/c.avi")!.resolve(true); // first hit at index 2
    pending.get("/d.avi")!.resolve(false);
    await expect(result).resolves.toBe("/c.avi");

    // Early exit: the 5th candidate was never queried.
    expect(coreMocks.invoke).toHaveBeenCalledTimes(4);
  });

  it("prefers the lowest-index hit regardless of resolution order", async () => {
    const pending = new Map<string, Deferred<boolean>>();
    mockExistsDeferred(pending);
    const mod = await loadImageUtils();

    const paths = ["/p.jpg", "/p.png", "/f.jpg", "/f.png"];
    const result = mod.findFirstExisting(paths);

    pending.get("/f.png")!.resolve(true); // last candidate resolves true first
    await flushMicrotasks();
    pending.get("/p.jpg")!.resolve(true); // top-priority candidate lands later
    pending.get("/p.png")!.resolve(false);
    pending.get("/f.jpg")!.resolve(false);

    await expect(result).resolves.toBe("/p.jpg");
  });

  it("only issues the next batch after the previous batch fully settles", async () => {
    const pending = new Map<string, Deferred<boolean>>();
    mockExistsDeferred(pending);
    const mod = await loadImageUtils();

    const paths = ["/1.jpg", "/2.jpg", "/3.jpg", "/4.jpg", "/5.jpg", "/6.jpg"];
    const result = mod.findFirstExisting(paths);
    expect(coreMocks.invoke).toHaveBeenCalledTimes(4); // batch 1 only

    for (const p of paths.slice(0, 4)) pending.get(p)!.resolve(false);
    await flushMicrotasks();

    // Batch 2 issued with the remaining candidates, in priority order.
    expect(coreMocks.invoke).toHaveBeenCalledTimes(6);
    expect(coreMocks.invoke.mock.calls.slice(4).map((c) => (c[1] as { path: string }).path)).toEqual(
      ["/5.jpg", "/6.jpg"]
    );

    pending.get("/5.jpg")!.resolve(false);
    pending.get("/6.jpg")!.resolve(true);
    await expect(result).resolves.toBe("/6.jpg");
  });

  it("honors an explicit batchSize", async () => {
    const pending = new Map<string, Deferred<boolean>>();
    mockExistsDeferred(pending);
    const mod = await loadImageUtils();

    const result = mod.findFirstExisting(["/x.jpg", "/y.jpg", "/z.jpg"], 2);
    expect(coreMocks.invoke).toHaveBeenCalledTimes(2);
    expect(coreMocks.invoke.mock.calls.map((c) => (c[1] as { path: string }).path)).toEqual([
      "/x.jpg",
      "/y.jpg",
    ]);

    pending.get("/x.jpg")!.resolve(false);
    pending.get("/y.jpg")!.resolve(false);
    await flushMicrotasks();
    expect(coreMocks.invoke).toHaveBeenCalledTimes(3);

    pending.get("/z.jpg")!.resolve(true);
    await expect(result).resolves.toBe("/z.jpg");
  });

  it("treats a rejected check as 'not found' and keeps scanning", async () => {
    const pending = new Map<string, Deferred<boolean>>();
    coreMocks.invoke.mockImplementation((_cmd: unknown, args: unknown) => {
      const path = (args as { path: string }).path;
      if (path === "/a.avi") return Promise.reject(new Error("ipc boom"));
      const d = deferred<boolean>();
      pending.set(path, d);
      return d.promise;
    });
    const mod = await loadImageUtils();

    const result = mod.findFirstExisting(["/a.avi", "/b.avi"]);
    pending.get("/b.avi")!.resolve(true);

    await expect(result).resolves.toBe("/b.avi");
  });

  it("returns null for an empty candidate list without invoking", async () => {
    const mod = await loadImageUtils();
    await expect(mod.findFirstExisting([])).resolves.toBeNull();
    expect(coreMocks.invoke).not.toHaveBeenCalled();
  });
});

describe("findPosterAndFanart", () => {
  it("queries both candidate sets in parallel and returns the first hit of each", async () => {
    const pending = new Map<string, Deferred<boolean>>();
    mockExistsDeferred(pending);
    const mod = await loadImageUtils();

    const result = mod.findPosterAndFanart("/media/movies/film.mkv");

    // Both branches issued their full candidate batch up front — poster.jpg is
    // still pending while every fanart candidate has already been queried.
    expect(coreMocks.invoke).toHaveBeenCalledTimes(8);
    expect(coreMocks.invoke.mock.calls.map((c) => (c[1] as { path: string }).path)).toEqual([
      "/media/movies/poster.jpg",
      "/media/movies/poster.png",
      "/media/movies/folder.jpg",
      "/media/movies/cover.jpg",
      "/media/movies/fanart.jpg",
      "/media/movies/fanart.png",
      "/media/movies/backdrop.jpg",
      "/media/movies/background.jpg",
    ]);

    // The fanart branch resolves while the poster's first candidate hangs.
    pending.get("/media/movies/fanart.jpg")!.resolve(false);
    pending.get("/media/movies/fanart.png")!.resolve(false);
    pending.get("/media/movies/backdrop.jpg")!.resolve(true);
    pending.get("/media/movies/background.jpg")!.resolve(false);
    await flushMicrotasks();

    // Now let the poster branch finish on its second candidate.
    pending.get("/media/movies/poster.jpg")!.resolve(false);
    pending.get("/media/movies/poster.png")!.resolve(true);
    pending.get("/media/movies/folder.jpg")!.resolve(false);
    pending.get("/media/movies/cover.jpg")!.resolve(false);

    await expect(result).resolves.toEqual({
      posterPath: "/media/movies/poster.png",
      fanartPath: "/media/movies/backdrop.jpg",
    });
  });

  it("returns null paths when no candidate exists", async () => {
    mockExistsByPath({});
    const mod = await loadImageUtils();

    await expect(
      mod.findPosterAndFanart("/media/movies/film.mkv")
    ).resolves.toEqual({ posterPath: null, fanartPath: null });
    expect(coreMocks.invoke).toHaveBeenCalledTimes(8);
  });
});
