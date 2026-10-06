import { convertFileSrc } from "@tauri-apps/api/core";

/**
 * Build the webview URL for an image on disk via Tauri's asset protocol.
 *
 * This module replaced an older design that `readFile`'d every image over IPC,
 * wrapped the bytes in a Blob and handed out `blob:` URLs from a bounded
 * LRU cache with pin/inflight bookkeeping. None of that machinery survives the
 * switch to `asset://` URLs, on purpose:
 *
 *  - A Blob URL held image bytes in the renderer JS heap for its whole lifetime;
 *    the LRU cap (400 entries) was a high-water mark that never shrank below
 *    full on a 10k+ library browse. An asset URL is a short string — the bytes
 *    stay in the webview's native image/network cache, which evicts decoded
 *    bitmaps for unmounted <img> elements on its own. Resident memory now
 *    scales with visible rows (bounded by react-window virtualization), not
 *    with how far the user has scrolled.
 *  - Loading no longer costs a per-image IPC round trip; the OS/webview serve
 *    the file straight from disk, with range-request support on the Rust side.
 *  - There is nothing to revoke, so nothing can evict an in-use URL — the pin
 *    mechanism existed only to make LRU eviction safe for Blob URLs.
 *
 * The former `acquireThumbnail`/`releaseThumbnail`/`invalidate*` API and the
 * readFile concurrency limiter (6 slots) are gone; call sites now build their
 * URL synchronously with this function.
 *
 * Cache busting: the asset protocol response carries no Cache-Control header
 * (tauri src/protocol/asset.rs), so the webview caches heuristically and an
 * in-place rewrite of `{cache}/thumbnails/{id}.jpg` would keep showing the old
 * pixels. `version` appends a `?v=` query — ignored by the asset handler, which
 * parses only the URI path — to force a re-fetch. `Movie.updated_at` is the
 * token for DB-backed thumbnails: the backend bumps it exactly when a thumbnail
 * path is written (database.rs `update_thumbnail_path`). For a thumbnail that
 * was just generated on demand (the store's row is stale), callers pass a
 * fresh nonce instead — see `thumbnailGenQueue`.
 *
 * @param path - Absolute file path inside the asset protocol scope.
 * @param version - Optional cache-busting token (`Movie.updated_at`, a nonce…).
 */
export function thumbnailUrl(
  path: string,
  version?: string | number | null
): string {
  const url = convertFileSrc(path);
  if (version === undefined || version === null || version === "") {
    return url;
  }
  return `${url}?v=${encodeURIComponent(String(version))}`;
}
