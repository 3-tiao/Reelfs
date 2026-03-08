import { readBinaryFile } from "@tauri-apps/api/fs";
import { logger } from "../services/tauri";

/**
 * Global thumbnail cache — survives component unmount/remount.
 * Maps file paths to Blob URLs to avoid re-reading files on every navigation.
 */
const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

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

async function readAsBlob(path: string): Promise<string | null> {
  try {
    const data = await readBinaryFile(path);
    const blob = new Blob([data as BlobPart], { type: "image/jpeg" });
    const url = URL.createObjectURL(blob);
    cache.set(path, url);
    return url;
  } catch (error) {
    logger.error("[ThumbnailCache] 加载失败:", path, String(error));
    return null;
  }
}

/**
 * Get (or load) a cached Blob URL for the given file path.
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
  // Return cached Blob URL if available
  const cached = cache.get(path);
  if (cached) {
    return cached;
  }

  // Deduplicate: if this path is already being loaded, wait for it
  const existing = inflight.get(path);
  if (existing) {
    return existing;
  }

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

export function clearThumbnailCache() {
  for (const url of cache.values()) {
    URL.revokeObjectURL(url);
  }
  cache.clear();
}
