// Unit tests for src/services/tauri.ts — the parameter/payload mapping layer
// on top of @tauri-apps/api. Both Tauri API modules are mocked; only the pure
// mapping logic runs for real.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mInvoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke: mInvoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

import {
  frontendLog,
  getMovies,
  getMoviesFiltered,
  getAndUpdateVideoInfo,
  logger,
  type Movie,
} from "../tauri";

const makeMovie = (overrides: Partial<Movie> = {}): Movie => ({
  id: 1,
  file_path: "/nas/movies/Movie 1.mkv",
  title: "Movie 1",
  added_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
  play_count: 0,
  ...overrides,
});

const lastInvokeArgs = (): Record<string, unknown> => {
  const call = mInvoke.mock.calls[mInvoke.mock.calls.length - 1];
  return call?.[1] as Record<string, unknown>;
};

beforeEach(() => {
  mInvoke.mockReset();
});

describe("getMovies", () => {
  it("invokes get_movies with offset/limit and returns the rows as-is", async () => {
    const rows = [makeMovie()];
    mInvoke.mockResolvedValueOnce(rows);

    const result = await getMovies(0, 200);

    expect(mInvoke).toHaveBeenCalledWith("get_movies", { offset: 0, limit: 200 });
    expect(result).toBe(rows);
  });
});

describe("getMoviesFiltered", () => {
  it("maps every filter/sort field to camelCase invoke args", async () => {
    mInvoke.mockResolvedValueOnce([makeMovie()]);

    const result = await getMoviesFiltered(
      0,
      50,
      {
        minYear: 1999,
        maxYear: 2003,
        minRating: 7,
        maxRating: 9,
        actors: "Keanu Reeves",
        genres: "Action",
        isWatched: true,
      },
      { sortBy: "rating", sortOrder: "DESC" },
      "  matrix  "
    );

    expect(mInvoke).toHaveBeenCalledTimes(1);
    expect(mInvoke).toHaveBeenCalledWith("get_movies_filtered", {
      offset: 0,
      limit: 50,
      searchQuery: "matrix",
      minYear: 1999,
      maxYear: 2003,
      minRating: 7,
      maxRating: 9,
      actors: "Keanu Reeves",
      genres: "Action",
      sortBy: "rating",
      sortOrder: "DESC",
      isWatched: true,
    });
    expect(result).toEqual([makeMovie()]);
  });

  it("trims searchQuery and returns undefined for a whitespace-only query", async () => {
    mInvoke.mockResolvedValue([]);

    await getMoviesFiltered(0, 10, undefined, undefined, "  neo  ");
    expect(lastInvokeArgs().searchQuery).toBe("neo");

    await getMoviesFiltered(0, 10, undefined, undefined, "   ");
    expect(lastInvokeArgs().searchQuery).toBeUndefined();
  });

  it("leaves optional filter/sort keys undefined when not provided", async () => {
    mInvoke.mockResolvedValue([]);

    await getMoviesFiltered(40, 20);
    const args = lastInvokeArgs();

    expect(args.offset).toBe(40);
    expect(args.limit).toBe(20);
    expect(args.searchQuery).toBeUndefined();
    expect(args.minYear).toBeUndefined();
    expect(args.genres).toBeUndefined();
    expect(args.sortBy).toBeUndefined();
    expect(args.sortOrder).toBeUndefined();
    expect(args.isWatched).toBeUndefined();
  });
});

describe("getAndUpdateVideoInfo", () => {
  it("converts the backend tuple into a named object", async () => {
    mInvoke.mockResolvedValueOnce([7200, 1920, 1080]);

    const info = await getAndUpdateVideoInfo(7);

    expect(mInvoke).toHaveBeenCalledWith("get_and_update_video_info", { id: 7 });
    expect(info).toEqual({ duration_seconds: 7200, width: 1920, height: 1080 });
  });

  it("passes null tuple slots through as nulls", async () => {
    mInvoke.mockResolvedValueOnce([null, null, null]);

    const info = await getAndUpdateVideoInfo(8);

    expect(info).toEqual({ duration_seconds: null, width: null, height: null });
  });
});

describe("frontendLog", () => {
  it("invokes frontend_log with the level and message", async () => {
    mInvoke.mockResolvedValueOnce(undefined);

    await frontendLog("info", "hello world");

    expect(mInvoke).toHaveBeenCalledWith("frontend_log", {
      level: "info",
      message: "hello world",
    });
  });

  it("swallows backend failures and reports them via console.error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      mInvoke.mockRejectedValueOnce(new Error("backend down"));

      await expect(frontendLog("info", "hello")).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledWith(
        "Failed to invoke frontend_log:",
        expect.any(Error)
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("logger", () => {
  it("keeps string args as-is", async () => {
    mInvoke.mockResolvedValue(undefined);

    await logger.info("plain message");

    expect(mInvoke).toHaveBeenCalledWith("frontend_log", {
      level: "info",
      message: "plain message",
    });
  });

  it("JSON.stringify-s non-string args (numbers, objects, null) and joins with spaces", async () => {
    mInvoke.mockResolvedValue(undefined);

    await logger.info("count", 42, { a: 1 }, null);

    expect(mInvoke).toHaveBeenCalledWith("frontend_log", {
      level: "info",
      message: 'count 42 {"a":1} null',
    });
  });

  it("maps each logger method to its own level", async () => {
    mInvoke.mockResolvedValue(undefined);

    await logger.error("e");
    await logger.warn("w");
    await logger.info("i");
    await logger.debug("d");
    await logger.trace("t");

    const levels = mInvoke.mock.calls.map((call) => (call[1] as { level: string }).level);
    expect(levels).toEqual(["error", "warn", "info", "debug", "trace"]);
  });
});
