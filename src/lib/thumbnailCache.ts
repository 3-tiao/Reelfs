import { readBinaryFile } from "@tauri-apps/api/fs";
import { logger } from "../services/tauri";

/**
 * Global thumbnail cache — survives component unmount/remount.
 * Maps file paths to Blob URLs to avoid re-reading files on every navigation.
 *
 * Bounded LRU: without a cap the renderer accumulated one Blob per movie ever
 * scrolled past (the project targets 10k+ libraries). Entries that a mounted
 * component still renders are "pinned" via `acquireThumbnail`, so eviction can
 * never revoke an in-use URL and break an <img>.
 */
const cache = new Map<string, string>();
const pins = new Map<string, number>();
const inflight = new Map<string, Promise<string | null>>();

const MAX_ENTRIES = 400;

// Concurrency limit for homepage bulk thumbnail loading (low-priority).
// Detail-page images (poster/fanart) bypass this limit via priority flag.
const MAX_CONCURRENT = 6;
let activeCount = 0;
const queue: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (activeCount < MAX_CONCURRENT) {
    activeCount++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    queue.push(() => {
      activeCount++;
      resolve();
    });
  });
}

function releaseSlot() {
  activeCount--;
  if (queue.length > 0) {
    const next = queue.shift()!;
    next();
  }
}

/** Mark an entry as most recently used. Map preserves insertion order. */
function touch(path: string) {
  const url = cache.get(path);
  if (url !== undefined) {
    cache.delete(path);
    cache.set(path, url);
  }
}

function isPinned(path: string): boolean {
  return (pins.get(path) ?? 0) > 0;
}

/** Revoke and drop the oldest unpinned entries until the cache fits the cap. */
function evictIfNeeded() {
  if (cache.size <= MAX_ENTRIES) return;

  for (const path of cache.keys()) {
    if (cache.size <= MAX_ENTRIES) break;
    if (isPinned(path)) continue;
    const url = cache.get(path);
    if (url) URL.revokeObjectURL(url);
    cache.delete(path);
  }
}

async function readAsBlob(path: string): Promise<string | null> {
  try {
    const data = await readBinaryFile(path);
    const blob = new Blob([data as BlobPart], { type: "image/jpeg" });
    const url = URL.createObjectURL(blob);
    cache.set(path, url);
    evictIfNeeded();
    return url;
  } catch (error) {
    logger.error("[ThumbnailCache] 加载失败:", path, String(error));
    return null;
  }
}

function loadThumbnail(path: string, highPriority: boolean): Promise<string | null> {
  const existing = inflight.get(path);
  if (existing) return existing;

  let promise: Promise<string | null>;

  if (highPriority) {
    // High-priority: read immediately without waiting for the slot queue
    promise = readAsBlob(path).finally(() => {
      inflight.delete(path);
    });
  } else {
    // Low-priority (bulk homepage thumbnails): go through the concurrency limiter
    promise = (async () => {
      await acquireSlot();
      try {
        return await readAsBlob(path);
      } finally {
        releaseSlot();
        inflight.delete(path);
      }
    })();
  }

  inflight.set(path, promise);
  return promise;
}

/**
 * Get (or load) a cached Blob URL for the given file path.
 * Use this when the URL is transient (e.g. handed to another consumer) or when
 * the caller cannot pair it with `releaseThumbnail`.
 *
 * @param path - Absolute file path to read.
 * @param highPriority - When true (e.g., detail-page poster/fanart), the read
 *   bypasses the concurrency queue so it is never blocked by bulk homepage
 *   thumbnail loads. Default is false (low-priority, queued).
 */
export async function getCachedThumbnail(
  path: string,
  highPriority = false
): Promise<string | null> {
  const cached = cache.get(path);
  if (cached) {
    touch(path);
    return cached;
  }
  return loadThumbnail(path, highPriority);
}

/**
 * Like `getCachedThumbnail`, but pins the entry so LRU eviction will not revoke
 * the URL while a mounted component is still rendering it. Every successful
 * acquire must be paired with `releaseThumbnail` (typically in effect cleanup).
 */
export async function acquireThumbnail(
  path: string,
  highPriority = false
): Promise<string | null> {
  pins.set(path, (pins.get(path) ?? 0) + 1);
  const url = await getCachedThumbnail(path, highPriority);
  if (!url) {
    // Nothing was cached, so drop the pin we just added.
    releasePin(path);
  }
  return url;
}

export function releaseThumbnail(path: string) {
  releasePin(path);
  evictIfNeeded();
}

function releasePin(path: string) {
  const current = pins.get(path);
  if (current === undefined) return;
  if (current <= 1) {
    pins.delete(path);
  } else {
    pins.set(path, current - 1);
  }
}

/**
 * Drop one cached entry. Needed after a thumbnail is regenerated in place:
 * the stored path is reused (`{cache}/thumbnails/{id}.jpg`), so the cache key
 * stays the same and the UI would keep showing the stale image.
 */
export function invalidateThumbnail(path: string) {
  const url = cache.get(path);
  if (url) {
    URL.revokeObjectURL(url);
  }
  cache.delete(path);
}

export function invalidateAllThumbnails() {
  for (const url of cache.values()) {
    URL.revokeObjectURL(url);
  }
  cache.clear();
}

/** Cache statistics, for diagnostics. */
export function getThumbnailCacheStats() {
  return { entries: cache.size, pinned: pins.size, inflight: inflight.size };
}

/** @deprecated Use `invalidateAllThumbnails`; kept for the existing call sites. */
export function clearThumbnailCache() {
  invalidateAllThumbnails();
}
