import { invoke } from '@tauri-apps/api/tauri';
import { acquireThumbnail } from './thumbnailCache';
import { logger } from '../services/tauri';

/**
 * Thumbnail Generation Queue
 *
 * Responsibilities:
 *  - Accept enqueue(movieId, onSuccess) requests from card components
 *  - Deduplicate: each movieId only queued once at a time
 *  - Rate-limit: at most MAX_GENERATING concurrent Rust generate_thumbnail calls
 *  - On completion: read result into Blob URL via getCachedThumbnail, invoke onSuccess callback
 *  - Non-blocking: uses Rust-side image processing, never touches JS canvas/main-thread IO
 */

const MAX_GENERATING = 2; // max simultaneous Rust thumbnail generation calls

// pending movieIds in FIFO order
const pendingQueue: number[] = [];
// set of movieIds currently enqueued or being processed (dedup guard)
const pendingSet = new Set<number>();
// callbacks to invoke once a thumbnail is ready (by movieId)
const callbacks = new Map<number, (url: string, thumbnailPath: string) => void>();

let activeCount = 0;

function processNext() {
  while (activeCount < MAX_GENERATING && pendingQueue.length > 0) {
    const movieId = pendingQueue.shift()!;
    activeCount++;
    generateOne(movieId).finally(() => {
      activeCount--;
      pendingSet.delete(movieId);
      processNext();
    });
  }
}

async function generateOne(movieId: number): Promise<void> {
  try {
    logger.info(`[ThumbnailGen] 开始生成: movieId=${movieId}`);
    const thumbnailPath = await invoke<string>('generate_thumbnail', { movieId });
    logger.info(`[ThumbnailGen] 生成成功: movieId=${movieId}, path=${thumbnailPath}`);

    // Load into cache and get a Blob URL, using high-priority to avoid queuing.
    // Pinned so LRU eviction cannot revoke it while the card renders it.
    const url = await acquireThumbnail(thumbnailPath, true);
    if (url) {
      const cb = callbacks.get(movieId);
      if (cb) {
        cb(url, thumbnailPath);
      }
    }
  } catch (error) {
    // No poster found or generation failed — silently skip (card stays as placeholder)
    logger.info(`[ThumbnailGen] 跳过(无海报或生成失败): movieId=${movieId}`);
  } finally {
    callbacks.delete(movieId);
  }
}

/**
 * Request thumbnail generation for a movie that has no cached thumbnail yet.
 *
 * - Safe to call multiple times for the same movieId (deduplicated)
 * - onSuccess is called at most once, with the Blob URL of the generated thumbnail
 * - If the component unmounts before generation finishes, the callback simply won't
 *   update anything meaningful (caller should guard with isMounted check)
 */
export function enqueueThumbnailGen(
  movieId: number,
  onSuccess: (url: string, thumbnailPath: string) => void
): void {
  if (pendingSet.has(movieId)) {
    // Already queued or generating — update callback to latest (e.g. after re-mount)
    callbacks.set(movieId, onSuccess);
    return;
  }

  pendingSet.add(movieId);
  callbacks.set(movieId, onSuccess);
  pendingQueue.push(movieId);
  processNext();
}
