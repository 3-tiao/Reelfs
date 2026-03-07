import { readBinaryFile } from "@tauri-apps/api/fs";
import { logger } from "../services/tauri";

/**
 * Global thumbnail cache — survives component unmount/remount.
 * Maps file paths to Blob URLs to avoid re-reading files on every navigation.
 */
const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

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

export async function getCachedThumbnail(path: string): Promise<string | null> {
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

  const promise = (async () => {
    await acquireSlot();
    try {
      const data = await readBinaryFile(path);
      const blob = new Blob([data as BlobPart], { type: "image/jpeg" });
      const url = URL.createObjectURL(blob);
      cache.set(path, url);
      return url;
    } catch (error) {
      logger.error("[ThumbnailCache] 加载失败:", path, String(error));
      return null;
    } finally {
      releaseSlot();
      inflight.delete(path);
    }
  })();

  inflight.set(path, promise);
  return promise;
}

export function clearThumbnailCache() {
  for (const url of cache.values()) {
    URL.revokeObjectURL(url);
  }
  cache.clear();
}
