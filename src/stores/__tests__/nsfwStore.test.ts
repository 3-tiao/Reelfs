// Unit tests for src/stores/nsfwStore.ts (zustand persist middleware over
// jsdom localStorage). Each test resets the module registry and re-imports the
// store so persistence round-trips run against a fresh store instance.
import { beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "nsfw-storage-v2";

const readStorage = (): { state: { showThumbnails: boolean }; version: number } =>
  JSON.parse(localStorage.getItem(STORAGE_KEY) as string);

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe("nsfwStore", () => {
  it("shows thumbnails by default when storage is empty (persist only writes on change)", async () => {
    const { useNsfwStore } = await import("../nsfwStore");

    expect(useNsfwStore.getState().showThumbnails).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("toggleShowThumbnails flips the flag and persists every toggle", async () => {
    const { useNsfwStore } = await import("../nsfwStore");

    useNsfwStore.getState().toggleShowThumbnails();
    expect(useNsfwStore.getState().showThumbnails).toBe(false);
    expect(readStorage().state.showThumbnails).toBe(false);

    useNsfwStore.getState().toggleShowThumbnails();
    expect(useNsfwStore.getState().showThumbnails).toBe(true);
    expect(readStorage().state.showThumbnails).toBe(true);
  });

  it("restores a persisted showThumbnails=false in a fresh store instance", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: { showThumbnails: false }, version: 0 })
    );

    const { useNsfwStore } = await import("../nsfwStore");

    expect(useNsfwStore.getState().showThumbnails).toBe(false);
    useNsfwStore.getState().toggleShowThumbnails();
    expect(useNsfwStore.getState().showThumbnails).toBe(true);
  });
});
