// Unit tests for src/lib/thumbnailCache.ts.
//
// The module is a stateless asset-URL factory on top of `convertFileSrc`
// (@tauri-apps/api/core), so the tests mock that module and pin down the URL
// grammar: raw delegation, `?v=` cache-busting tokens, and encoding.
import { beforeEach, describe, expect, it, vi } from "vitest";

const coreMocks = vi.hoisted(() => ({
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${encodeURIComponent(path)}`),
}));

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: coreMocks.convertFileSrc }));

type CacheModule = typeof import("../../lib/thumbnailCache");

async function loadCache(): Promise<CacheModule> {
  return await import("../../lib/thumbnailCache");
}

beforeEach(() => {
  coreMocks.convertFileSrc.mockClear();
});

describe("thumbnailUrl — delegation to convertFileSrc", () => {
  it("passes the raw path through and returns the asset URL unchanged", async () => {
    const mod = await loadCache();

    expect(mod.thumbnailUrl("/media/movies/poster.jpg")).toBe(
      "asset://localhost/%2Fmedia%2Fmovies%2Fposter.jpg"
    );
    expect(coreMocks.convertFileSrc).toHaveBeenCalledTimes(1);
    expect(coreMocks.convertFileSrc).toHaveBeenCalledWith("/media/movies/poster.jpg");
  });

  it("keeps delegating when a version is appended", async () => {
    const mod = await loadCache();

    mod.thumbnailUrl("/cache/thumbnails/7.jpg", "2026-10-06 00:00:00");
    expect(coreMocks.convertFileSrc).toHaveBeenCalledWith("/cache/thumbnails/7.jpg");
  });
});

describe("thumbnailUrl — ?v= cache-busting token", () => {
  it("appends the version as an encoded ?v= query", async () => {
    const mod = await loadCache();

    expect(mod.thumbnailUrl("/cache/thumbnails/7.jpg", "2026-10-06 00:00:00")).toBe(
      `asset://localhost/${encodeURIComponent("/cache/thumbnails/7.jpg")}` +
        `?v=${encodeURIComponent("2026-10-06 00:00:00")}`
    );
  });

  it("stringifies number versions (e.g. a Date.now() nonce)", async () => {
    const mod = await loadCache();

    const url = mod.thumbnailUrl("/cache/thumbnails/7.jpg", 1730000000000);
    expect(url).toBe(
      `asset://localhost/${encodeURIComponent("/cache/thumbnails/7.jpg")}?v=1730000000000`
    );
  });

  it("encodes characters that would break out of the query value", async () => {
    const mod = await loadCache();

    const url = mod.thumbnailUrl("/m/a.jpg", "a&b=c d?e#f");
    expect(url.endsWith(`?v=${encodeURIComponent("a&b=c d?e#f")}`)).toBe(true);
    expect(url).not.toContain("&");
  });

  it.each([undefined, null, ""])(
    "omits the query entirely for the falsy version %j",
    async (version) => {
      const mod = await loadCache();

      expect(mod.thumbnailUrl("/m/a.jpg", version)).toBe(
        "asset://localhost/%2Fm%2Fa.jpg"
      );
    }
  );

  it("produces a distinct URL per distinct version so a rewritten file is re-fetched", async () => {
    const mod = await loadCache();

    const before = mod.thumbnailUrl("/cache/thumbnails/1.jpg", "2026-01-01 00:00:00");
    const after = mod.thumbnailUrl("/cache/thumbnails/1.jpg", "2026-10-06 12:00:00");
    expect(before).not.toBe(after);
    // Same path → same base, only the token differs.
    expect(before.split("?")[0]).toBe(after.split("?")[0]);
  });
});
