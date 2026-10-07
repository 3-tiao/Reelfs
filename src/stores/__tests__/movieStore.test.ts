// Unit tests for src/stores/movieStore.ts.
// The Tauri service layer (src/services/tauri.ts) is fully mocked; the store
// logic itself (pagination, requestId races, guards, in-memory re-sort) runs
// for real via the actual zustand store instance.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../services/tauri", () => ({
  getMovies: vi.fn(),
  getMoviesFiltered: vi.fn(),
  playMovie: vi.fn(),
  getUniqueGenres: vi.fn(),
  getUniqueActors: vi.fn(),
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}));

import { PAGE_SIZE, useMovieStore } from "../movieStore";
import {
  getMovies,
  getMoviesFiltered,
  getUniqueActors,
  getUniqueGenres,
  logger,
  playMovie,
  type Movie,
} from "../../services/tauri";

const mGetMovies = vi.mocked(getMovies);
const mGetMoviesFiltered = vi.mocked(getMoviesFiltered);
const mPlayMovie = vi.mocked(playMovie);
const mGetUniqueGenres = vi.mocked(getUniqueGenres);
const mGetUniqueActors = vi.mocked(getUniqueActors);
const mLoggerInfo = vi.mocked(logger.info);
const mLoggerError = vi.mocked(logger.error);

const makeMovie = (overrides: Partial<Movie> = {}): Movie => ({
  id: 1,
  file_path: "/nas/movies/Movie 1.mkv",
  title: "Movie 1",
  added_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
  play_count: 0,
  ...overrides,
});

const fullPage = (): Movie[] =>
  Array.from({ length: 200 }, (_, i) => makeMovie({ id: i + 1, title: `Movie ${i + 1}` }));

const initialState = useMovieStore.getState();
const state = () => useMovieStore.getState();

beforeEach(() => {
  vi.resetAllMocks();
  useMovieStore.setState(initialState, true);
});

describe("fetchMovies", () => {
  it("flips isLoading on synchronously and back off after resolve", async () => {
    let resolve!: (movies: Movie[]) => void;
    mGetMovies.mockImplementationOnce(
      () => new Promise<Movie[]>((res) => { resolve = res; })
    );

    const inFlight = state().fetchMovies(0);
    expect(state().isLoading).toBe(true);
    expect(state().error).toBeNull();
    expect(state().searchQuery).toBe("");

    resolve([makeMovie()]);
    await inFlight;
    expect(state().isLoading).toBe(false);
  });

  it("pages with limit=200 and derives hasMore/currentPage from the response size", async () => {
    mGetMovies.mockResolvedValueOnce(fullPage());
    await state().fetchMovies(0);
    expect(mGetMovies).toHaveBeenCalledWith(0, 200);
    expect(state().movies).toHaveLength(200);
    expect(state().hasMore).toBe(true);
    expect(state().currentPage).toBe(0);

    mGetMovies.mockResolvedValueOnce(fullPage().slice(0, 199));
    await state().fetchMovies(200);
    expect(mGetMovies).toHaveBeenLastCalledWith(200, 200);
    expect(state().hasMore).toBe(false);
    expect(state().currentPage).toBe(1);
  });

  it("routes through getMoviesFiltered when the sort is not the default", async () => {
    useMovieStore.setState({ sortOptions: { sortBy: "rating", sortOrder: "ASC" } });
    mGetMoviesFiltered.mockResolvedValueOnce([]);
    await state().fetchMovies(0);

    expect(mGetMoviesFiltered).toHaveBeenCalledWith(
      0,
      200,
      undefined,
      { sortBy: "rating", sortOrder: "ASC" },
      undefined
    );
    expect(mGetMovies).not.toHaveBeenCalled();
  });

  it("passes the filters only while isUsingFilters is active", async () => {
    useMovieStore.setState({
      isUsingFilters: true,
      filters: { genres: "Action", minYear: 2000 },
    });
    mGetMoviesFiltered.mockResolvedValueOnce([]);
    await state().fetchMovies(0);

    expect(mGetMoviesFiltered).toHaveBeenCalledWith(
      0,
      200,
      { genres: "Action", minYear: 2000 },
      { sortBy: "added_at", sortOrder: "DESC" },
      undefined
    );
  });

  it("records the failure in error and clears isLoading", async () => {
    mGetMovies.mockRejectedValueOnce(new Error("backend boom"));
    await state().fetchMovies(0);

    expect(state().error).toBe("Error: backend boom");
    expect(state().isLoading).toBe(false);
    expect(state().movies).toEqual([]);
  });

  it("discards a stale success once a newer request bumped requestId", async () => {
    let resolveFirst!: (movies: Movie[]) => void;
    mGetMovies.mockImplementationOnce(
      () => new Promise<Movie[]>((res) => { resolveFirst = res; })
    );
    mGetMovies.mockResolvedValueOnce([makeMovie({ id: 2 })]);

    const first = state().fetchMovies(0);
    const second = state().fetchMovies(0);
    await second;

    expect(state().movies.map((m) => m.id)).toEqual([2]);
    expect(state().lastRequestId).toBe(2);

    resolveFirst([makeMovie({ id: 99, title: "Stale" })]);
    await first;

    expect(state().movies.map((m) => m.id)).toEqual([2]);
    expect(state().isLoading).toBe(false);
    expect(mLoggerInfo).toHaveBeenCalledWith(
      expect.stringContaining("ignored: stale requestId=1")
    );
  });

  it("discards a stale error once a newer request bumped requestId", async () => {
    let rejectFirst!: (error: unknown) => void;
    mGetMovies.mockImplementationOnce(
      () => new Promise<Movie[]>((_, reject) => { rejectFirst = reject; })
    );
    mGetMovies.mockResolvedValueOnce([makeMovie({ id: 2 })]);

    const first = state().fetchMovies(0);
    const second = state().fetchMovies(0);
    await second;

    rejectFirst(new Error("stale boom"));
    await first;

    expect(state().error).toBeNull();
    expect(state().movies.map((m) => m.id)).toEqual([2]);
  });
});

describe("loadMore", () => {
  it("is a no-op when hasMore is false or a load is already running", async () => {
    useMovieStore.setState({ hasMore: false });
    await state().loadMore();
    expect(mGetMovies).not.toHaveBeenCalled();
    expect(mGetMoviesFiltered).not.toHaveBeenCalled();

    useMovieStore.setState({ hasMore: true, isLoadingMore: true });
    await state().loadMore();
    expect(mGetMovies).not.toHaveBeenCalled();
    expect(state().isLoadingMore).toBe(true); // guard leaves the flag untouched
  });

  it("fetches the next page and appends it to the existing movies", async () => {
    useMovieStore.setState({
      movies: [makeMovie({ id: 1 }), makeMovie({ id: 2 })],
      currentPage: 0,
      hasMore: true,
    });
    mGetMovies.mockResolvedValueOnce([makeMovie({ id: 3 }), makeMovie({ id: 4 })]);

    await state().loadMore();
    const s = state();

    expect(mGetMovies).toHaveBeenCalledWith(200, 200);
    expect(s.movies.map((m) => m.id)).toEqual([1, 2, 3, 4]);
    expect(s.currentPage).toBe(1);
    expect(s.hasMore).toBe(false); // 2 < 200
    expect(s.isLoadingMore).toBe(false);
  });

  it("drops rows the backend resends across a shifted page boundary", async () => {
    // The backend re-sorts the whole table per page request, so after a
    // rating change a row above the boundary can reappear on the next page.
    // The append must deduplicate by id instead of showing a duplicate card.
    useMovieStore.setState({
      movies: [makeMovie({ id: 1 }), makeMovie({ id: 2 })],
      currentPage: 0,
      hasMore: true,
    });
    mGetMovies.mockResolvedValueOnce([makeMovie({ id: 2 }), makeMovie({ id: 3 })]);

    await state().loadMore();
    const s = state();

    expect(s.movies.map((m) => m.id)).toEqual([1, 2, 3]);
    expect(s.currentPage).toBe(1);
  });

  it("keeps hasMore true when a full page of 200 comes back", async () => {
    useMovieStore.setState({ movies: [], currentPage: 0, hasMore: true });
    mGetMovies.mockResolvedValueOnce(fullPage());

    await state().loadMore();
    const s = state();

    expect(s.currentPage).toBe(1);
    expect(s.hasMore).toBe(true);
    expect(s.movies).toHaveLength(200);
  });

  it("uses the filtered command while a search query or filters are active", async () => {
    useMovieStore.setState({
      searchQuery: "neo",
      isUsingFilters: true,
      filters: { genres: "Sci-Fi" },
      currentPage: 1,
    });
    mGetMoviesFiltered.mockResolvedValueOnce([]);

    await state().loadMore();

    expect(mGetMoviesFiltered).toHaveBeenCalledWith(
      400,
      200,
      { genres: "Sci-Fi" },
      { sortBy: "added_at", sortOrder: "DESC" },
      "neo"
    );
    expect(mGetMovies).not.toHaveBeenCalled();
  });

  it("computes the next page offset from PAGE_SIZE", async () => {
    useMovieStore.setState({ movies: [], currentPage: 2, hasMore: true });
    mGetMovies.mockResolvedValueOnce([]);

    await state().loadMore();

    expect(mGetMovies).toHaveBeenCalledWith(3 * PAGE_SIZE, PAGE_SIZE);
  });

  it("dedupes synchronous duplicate calls while the first load is in flight", async () => {
    // movieStore.loadMore flips isLoadingMore synchronously before its first
    // await, so a second call in the same tick must be a no-op. This is the
    // guarantee the list/grid components rely on after dropping their
    // loadingRef+setTimeout throttle.
    let resolve!: (movies: Movie[]) => void;
    mGetMovies.mockImplementationOnce(
      () => new Promise<Movie[]>((res) => { resolve = res; })
    );

    const first = state().loadMore();
    const duplicate = state().loadMore();
    resolve(fullPage());
    await Promise.all([first, duplicate]);

    expect(mGetMovies).toHaveBeenCalledTimes(1);
    expect(state().movies).toHaveLength(PAGE_SIZE);
    expect(state().isLoadingMore).toBe(false);
  });

  it("releases isLoadingMore when a bumpId request supersedes an in-flight loadMore", async () => {
    // loadMore keeps the requestId while a fetchMovies/searchMovies that starts
    // mid-flight bumps it; the late loadMore completion is then dropped as
    // stale. Its isLoadingMore claim must still be released, or the loadMore
    // guard blocks every future page and infinite scroll dies for the session.
    let resolveLoadMore!: (movies: Movie[]) => void;
    mGetMovies.mockImplementationOnce(
      () => new Promise<Movie[]>((res) => { resolveLoadMore = res; })
    );
    mGetMoviesFiltered.mockResolvedValueOnce([makeMovie({ id: 501 })]);

    const loading = state().loadMore();
    expect(state().isLoadingMore).toBe(true);

    const search = state().searchMovies("neo"); // bumps lastRequestId → loadMore goes stale
    resolveLoadMore(fullPage()); // loadMore finishes late; its result must be dropped
    await Promise.all([search, loading]);

    const s = state();
    expect(s.isLoadingMore).toBe(false);
    expect(s.lastRequestId).toBe(1);
    expect(s.searchQuery).toBe("neo");
    expect(s.movies.map((m) => m.id)).toEqual([501]);
  });

  it("releases isLoadingMore when a superseded loadMore rejects", async () => {
    let rejectLoadMore!: (error: unknown) => void;
    mGetMovies.mockImplementationOnce(
      () => new Promise<Movie[]>((_, reject) => { rejectLoadMore = reject; })
    );
    mGetMoviesFiltered.mockResolvedValueOnce([]);

    const loading = state().loadMore();
    const search = state().searchMovies("neo");
    rejectLoadMore(new Error("late boom"));
    await Promise.all([search, loading]);

    const s = state();
    expect(s.isLoadingMore).toBe(false);
    expect(s.error).toBeNull(); // the stale error must not land either
    expect(s.movies.map((m) => m.id)).toEqual([]);
  });

  it("lets a fresh loadMore run after a stale one released the flag", async () => {
    let resolveLoadMore!: (movies: Movie[]) => void;
    mGetMovies.mockImplementationOnce(
      () => new Promise<Movie[]>((res) => { resolveLoadMore = res; })
    );
    mGetMoviesFiltered.mockResolvedValueOnce([makeMovie({ id: 501 })]);
    mGetMovies.mockResolvedValueOnce([makeMovie({ id: 2 })]);

    useMovieStore.setState({ movies: [makeMovie({ id: 1 })], currentPage: 0 });
    const loading = state().loadMore();
    const search = state().searchMovies("neo");
    resolveLoadMore(fullPage());
    await Promise.all([search, loading]);
    expect(state().isLoadingMore).toBe(false);

    // The guard is no longer tripped: the next page load goes through.
    useMovieStore.setState({ searchQuery: "", movies: [makeMovie({ id: 1 })], hasMore: true });
    await state().loadMore();

    expect(mGetMovies).toHaveBeenLastCalledWith(PAGE_SIZE, PAGE_SIZE);
    expect(state().movies.map((m) => m.id)).toEqual([1, 2]);
    expect(state().currentPage).toBe(1);
  });
});

describe("searchMovies", () => {
  it("clears results without invoking anything for a whitespace-only query", async () => {
    useMovieStore.setState({
      movies: [makeMovie()],
      searchQuery: "old",
      hasMore: true,
      currentPage: 3,
      error: "leftover",
    });

    await state().searchMovies("   ");
    const s = state();

    expect(s.movies).toEqual([]);
    expect(s.searchQuery).toBe("");
    expect(s.hasMore).toBe(false);
    expect(s.currentPage).toBe(0);
    expect(s.isLoading).toBe(false);
    expect(s.error).toBeNull();
    expect(mGetMoviesFiltered).not.toHaveBeenCalled();
  });

  it("queries the filtered command with the trimmed query and applies results", async () => {
    mGetMoviesFiltered.mockResolvedValueOnce([makeMovie({ id: 9 })]);

    await state().searchMovies("  neo  ");
    const s = state();

    expect(mGetMoviesFiltered).toHaveBeenCalledWith(
      0,
      200,
      undefined,
      { sortBy: "added_at", sortOrder: "DESC" },
      "neo"
    );
    expect(s.searchQuery).toBe("neo");
    expect(s.movies.map((m) => m.id)).toEqual([9]);
    expect(s.isLoading).toBe(false);
    expect(s.currentPage).toBe(0);
  });

  it("passes the active filters along with the search", async () => {
    useMovieStore.setState({ isUsingFilters: true, filters: { actors: "Keanu" } });
    mGetMoviesFiltered.mockResolvedValueOnce([]);

    await state().searchMovies("matrix");

    expect(mGetMoviesFiltered).toHaveBeenCalledWith(
      0,
      200,
      { actors: "Keanu" },
      { sortBy: "added_at", sortOrder: "DESC" },
      "matrix"
    );
  });
});

describe("refreshThumbnailTokens", () => {
  it("merges fresh updated_at/thumbnail_path into loaded rows without truncating the list", async () => {
    // Two pages are loaded (currentPage=1); the fresh rows must only refresh
    // the ?v= tokens in place — a fetchMovies(0) here would drop page 1.
    useMovieStore.setState({
      movies: [
        makeMovie({ id: 1, updated_at: "2024-01-01T00:00:00Z", thumbnail_path: "/cache/old-1.jpg" }),
        makeMovie({ id: 201, updated_at: "2024-01-01T00:00:00Z" }),
      ],
      currentPage: 1,
      hasMore: true,
    });
    mGetMovies.mockResolvedValueOnce([
      makeMovie({ id: 1, updated_at: "2025-06-01T00:00:00Z", thumbnail_path: "/cache/new-1.jpg" }),
    ]);
    mGetMovies.mockResolvedValueOnce([
      makeMovie({ id: 201, updated_at: "2025-06-02T00:00:00Z" }),
    ]);

    await state().refreshThumbnailTokens();
    const s = state();

    expect(mGetMovies).toHaveBeenNthCalledWith(1, 0, PAGE_SIZE);
    expect(mGetMovies).toHaveBeenNthCalledWith(2, PAGE_SIZE, PAGE_SIZE);
    expect(s.movies).toHaveLength(2);
    expect(s.currentPage).toBe(1);
    expect(s.hasMore).toBe(true);
    expect(s.isLoading).toBe(false);
    expect(s.isLoadingMore).toBe(false);
    expect(s.movies[0].updated_at).toBe("2025-06-01T00:00:00Z");
    expect(s.movies[0].thumbnail_path).toBe("/cache/new-1.jpg");
    expect(s.movies[1].updated_at).toBe("2025-06-02T00:00:00Z");
  });

  it("routes through the filtered command while a search query is active", async () => {
    useMovieStore.setState({ movies: [makeMovie({ id: 9 })], currentPage: 0, searchQuery: "neo" });
    mGetMoviesFiltered.mockResolvedValueOnce([
      makeMovie({ id: 9, updated_at: "2025-07-01T00:00:00Z" }),
    ]);

    await state().refreshThumbnailTokens();

    expect(mGetMoviesFiltered).toHaveBeenCalledWith(
      0,
      PAGE_SIZE,
      undefined,
      { sortBy: "added_at", sortOrder: "DESC" },
      "neo"
    );
    expect(mGetMovies).not.toHaveBeenCalled();
    expect(state().movies[0].updated_at).toBe("2025-07-01T00:00:00Z");
  });

  it("keeps rows the backend no longer returns and swallows fetch failures", async () => {
    useMovieStore.setState({
      movies: [makeMovie({ id: 1 }), makeMovie({ id: 2 })],
      currentPage: 0,
    });
    mGetMovies.mockResolvedValueOnce([
      makeMovie({ id: 1, updated_at: "2025-06-01T00:00:00Z" }),
    ]); // id 2 pruned from the DB since

    await state().refreshThumbnailTokens();

    expect(state().movies.map((m) => m.id)).toEqual([1, 2]);
    expect(state().movies[0].updated_at).toBe("2025-06-01T00:00:00Z");

    useMovieStore.setState({ movies: [makeMovie({ id: 1 })] });
    mGetMovies.mockRejectedValueOnce(new Error("db gone"));
    await state().refreshThumbnailTokens();

    expect(mLoggerError).toHaveBeenCalledWith(expect.stringContaining("刷新缩略图令牌失败"));
    expect(state().movies.map((m) => m.id)).toEqual([1]);
  });

  it("is a no-op when the list is empty", async () => {
    await state().refreshThumbnailTokens();
    expect(mGetMovies).not.toHaveBeenCalled();
    expect(mGetMoviesFiltered).not.toHaveBeenCalled();
  });
});

describe("filters", () => {
  it("setFilters toggles isUsingFilters only when a filter holds a value", () => {
    state().setFilters({});
    expect(state().isUsingFilters).toBe(false);

    state().setFilters({ minYear: undefined, genres: "" });
    expect(state().isUsingFilters).toBe(false);

    state().setFilters({ genres: "Action" });
    expect(state().isUsingFilters).toBe(true);
    expect(state().filters).toEqual({ genres: "Action" });
  });

  it("clearFilters resets filters and isUsingFilters", () => {
    useMovieStore.setState({ filters: { genres: "Action" }, isUsingFilters: true });
    state().clearFilters();
    expect(state().filters).toEqual({});
    expect(state().isUsingFilters).toBe(false);
  });
});

describe("scroll state", () => {
  it("setScrollPosition writes and overwrites per key without dropping others", () => {
    state().setScrollPosition("/grid", 120);
    state().setScrollPosition("/actors", 40);
    expect(state().scrollPositions).toEqual({ "/grid": 120, "/actors": 40 });

    state().setScrollPosition("/grid", 999);
    expect(state().scrollPositions).toEqual({ "/grid": 999, "/actors": 40 });
  });

  it("setScrollProgress writes per key", () => {
    state().setScrollProgress("/grid", 0.25);
    state().setScrollProgress("/actors", 0.9);
    expect(state().scrollProgresses).toEqual({ "/grid": 0.25, "/actors": 0.9 });
  });
});

describe("patchMovie", () => {
  it("merges the partial and re-sorts in memory under rating DESC (missing rating last)", () => {
    useMovieStore.setState({
      sortOptions: { sortBy: "rating", sortOrder: "DESC" },
      movies: [
        makeMovie({ id: 1, rating: 5, added_at: "2024-01-01T00:00:00Z" }),
        makeMovie({ id: 2, rating: 8, added_at: "2024-01-02T00:00:00Z" }),
        makeMovie({ id: 3, added_at: "2024-01-03T00:00:00Z" }), // no rating
      ],
    });

    state().patchMovie(1, { rating: 10 });
    const movies = state().movies;

    expect(movies.map((m) => m.id)).toEqual([1, 2, 3]);
    expect(movies[0].rating).toBe(10);
    expect(movies[0].title).toBe("Movie 1"); // unrelated fields preserved
  });

  it("breaks rating ties by id DESC, matching SQLite DESC order", () => {
    useMovieStore.setState({
      sortOptions: { sortBy: "rating", sortOrder: "DESC" },
      movies: [
        makeMovie({ id: 1, rating: 7 }),
        makeMovie({ id: 5, rating: 7 }),
        makeMovie({ id: 3 }), // unrated → last for DESC
      ],
    });

    state().patchMovie(1, { rating: 7 });
    expect(state().movies.map((m) => m.id)).toEqual([5, 1, 3]);
  });

  it("re-sorts alphabetically under title ASC", () => {
    useMovieStore.setState({
      sortOptions: { sortBy: "title", sortOrder: "ASC" },
      movies: [makeMovie({ id: 1, title: "Zebra" }), makeMovie({ id: 2, title: "Alpha" })],
    });

    state().patchMovie(1, { title: "Beta" });
    expect(state().movies.map((m) => m.title)).toEqual(["Alpha", "Beta"]);
  });

  it("re-sorts by added_at under the default added_at DESC", () => {
    useMovieStore.setState({
      movies: [
        makeMovie({ id: 1, added_at: "2024-03-01T00:00:00Z" }),
        makeMovie({ id: 2, added_at: "2024-01-01T00:00:00Z" }),
      ],
    });

    state().patchMovie(2, { added_at: "2025-01-01T00:00:00Z" });
    expect(state().movies.map((m) => m.id)).toEqual([2, 1]);
  });

  it("leaves the movies array untouched (same reference) when no row matches", () => {
    const before = state().movies;
    state().patchMovie(999, { title: "nobody" });
    expect(state().movies).toBe(before);
  });
});

describe("misc actions", () => {
  it("playMovie forwards the id and stores a stringified error on failure", async () => {
    mPlayMovie.mockResolvedValueOnce(undefined);
    await state().playMovie(5);
    expect(mPlayMovie).toHaveBeenCalledWith(5);
    expect(state().error).toBeNull();

    mPlayMovie.mockRejectedValueOnce(new Error("no player"));
    await state().playMovie(5);
    expect(state().error).toBe("Error: no player");
  });

  it("fetchAvailableGenres stores the list and swallows failures", async () => {
    mGetUniqueGenres.mockResolvedValueOnce(["Action", "Sci-Fi"]);
    await state().fetchAvailableGenres();
    expect(state().availableGenres).toEqual(["Action", "Sci-Fi"]);

    useMovieStore.setState({ availableGenres: ["Keep"] });
    mGetUniqueGenres.mockRejectedValueOnce(new Error("db gone"));
    await state().fetchAvailableGenres();
    expect(state().availableGenres).toEqual(["Keep"]);
  });

  it("fetchAvailableActors stores the actor list", async () => {
    mGetUniqueActors.mockResolvedValueOnce(["Keanu Reeves"]);
    await state().fetchAvailableActors();
    expect(state().availableActors).toEqual(["Keanu Reeves"]);
  });

  it("reset clears list state but keeps sort/filters", () => {
    useMovieStore.setState({
      movies: [makeMovie()],
      currentPage: 3,
      totalCount: 9,
      isLoading: true,
      error: "boom",
      searchQuery: "q",
      sortOptions: { sortBy: "title", sortOrder: "ASC" },
    });

    state().reset();
    const s = state();

    expect(s.movies).toEqual([]);
    expect(s.currentPage).toBe(0);
    expect(s.totalCount).toBe(0);
    expect(s.isLoading).toBe(false);
    expect(s.error).toBeNull();
    expect(s.searchQuery).toBe("");
    expect(s.sortOptions).toEqual({ sortBy: "title", sortOrder: "ASC" });
  });
});

describe("persistence (scroll state survives a restart)", () => {
  const STORAGE_KEY = "movie-storage";

  it("persists only scrollPositions/scrollProgresses under movie-storage", () => {
    state().setScrollPosition("home:grid", 4321);
    state().setScrollProgress("home:grid", 0.42);
    // Everything else must stay out of the payload.
    useMovieStore.setState({ movies: [makeMovie()], searchQuery: "neo" });

    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) as string);
    expect(parsed.version).toBe(0);
    expect(parsed.state).toEqual({
      scrollPositions: { "home:grid": 4321 },
      scrollProgresses: { "home:grid": 0.42 },
    });
  });

  it("rehydrates scroll state from storage via persist.rehydrate()", async () => {
    // In-memory state drifts from what a previous session stored, then the
    // persisted payload wins on rehydrate — like resuming after a restart.
    state().setScrollPosition("home:list", 1);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: { scrollPositions: { "home:list": 777 }, scrollProgresses: { "home:list": 0.6 } },
        version: 0,
      })
    );

    await useMovieStore.persist.rehydrate();
    expect(state().scrollPositions["home:list"]).toBe(777);
    expect(state().scrollProgresses["home:list"]).toBe(0.6);
  });

  it("round-trips scroll state into a fresh store instance, without the movie list", async () => {
    state().setScrollPosition("home:actors", 55);

    // Simulate an app restart: new module registry → brand-new store that
    // hydrates synchronously from localStorage at creation.
    vi.resetModules();
    const { useMovieStore: freshStore } = await import("../movieStore");

    expect(freshStore.getState().scrollPositions["home:actors"]).toBe(55);
    // List/filters/request bookkeeping is never persisted.
    expect(freshStore.getState().movies).toEqual([]);
    expect(freshStore.getState().isLoading).toBe(false);
    expect(freshStore.getState().searchQuery).toBe("");
  });
});
