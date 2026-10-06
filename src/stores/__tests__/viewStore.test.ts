// Unit tests for src/stores/viewStore.ts (zustand persist middleware over
// jsdom localStorage). Each test resets the module registry and re-imports the
// store so persistence round-trips run against a fresh store instance.
import { beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "view-storage";

const seedStorage = (state: Record<string, unknown>, version = 0) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, version }));
};

const readStorage = (): { state: Record<string, unknown>; version: number } =>
  JSON.parse(localStorage.getItem(STORAGE_KEY) as string);

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe("viewStore", () => {
  it("defaults to grid view with name/ASC actor sorting when storage is empty", async () => {
    const { useViewStore } = await import("../viewStore");
    const s = useViewStore.getState();
    expect(s.viewMode).toBe("grid");
    expect(s.actorSortBy).toBe("name");
    expect(s.actorSortOrder).toBe("ASC");
    expect(s.actorSearchQuery).toBe("");
  });

  it("setViewMode updates the state and persists it under view-storage", async () => {
    const { useViewStore } = await import("../viewStore");

    useViewStore.getState().setViewMode("list");

    expect(useViewStore.getState().viewMode).toBe("list");
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    const parsed = readStorage();
    expect(parsed.state.viewMode).toBe("list");
    expect(parsed.version).toBe(0);
  });

  it("round-trips a persisted view state into a fresh store instance", async () => {
    seedStorage({
      viewMode: "actors",
      actorSortBy: "movie_count",
      actorSortOrder: "DESC",
      actorSearchQuery: "Keanu",
    });

    const { useViewStore } = await import("../viewStore");
    const s = useViewStore.getState();

    expect(s.viewMode).toBe("actors");
    expect(s.actorSortBy).toBe("movie_count");
    expect(s.actorSortOrder).toBe("DESC");
    expect(s.actorSearchQuery).toBe("Keanu");
  });

  it("keeps defaults for fields absent from the persisted payload (partial merge)", async () => {
    seedStorage({ viewMode: "list" });

    const { useViewStore } = await import("../viewStore");

    expect(useViewStore.getState().viewMode).toBe("list");
    expect(useViewStore.getState().actorSortBy).toBe("name");
    expect(useViewStore.getState().actorSortOrder).toBe("ASC");
  });

  it("persists the actor sort/search setters too", async () => {
    const { useViewStore } = await import("../viewStore");

    useViewStore.getState().setActorSortBy("movie_count");
    useViewStore.getState().setActorSortOrder("DESC");
    useViewStore.getState().setActorSearchQuery("neo");

    const parsed = readStorage();
    expect(parsed.state.actorSortBy).toBe("movie_count");
    expect(parsed.state.actorSortOrder).toBe("DESC");
    expect(parsed.state.actorSearchQuery).toBe("neo");
  });
});
