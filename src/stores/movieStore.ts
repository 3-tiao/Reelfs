import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Movie, getMovies, playMovie, Filters, SortOptions, getMoviesFiltered, getUniqueGenres, getUniqueActors, logger } from "../services/tauri";

// Single source of truth for every paged query and the hasMore derivation.
// The Rust backend caps pages at this size, so a response shorter than it
// means there is nothing left to load.
export const PAGE_SIZE = 200;

const hasActiveFilterValues = (filters: Filters) => {
  return Object.values(filters).some((value) => value !== undefined && value !== null && value !== "");
};

interface MovieStore {
  movies: Movie[];
  currentPage: number;
  totalCount: number;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  filters: Filters;
  sortOptions: SortOptions;
  availableGenres: string[];
  availableActors: string[];
  isUsingFilters: boolean;
  scrollPositions: Record<string, number>;
  scrollProgresses: Record<string, number>;
  searchQuery: string;

  fetchMovies: (offset: number) => Promise<void>;
  loadMore: () => Promise<void>;
  searchMovies: (query: string) => Promise<void>;
  playMovie: (id: number) => Promise<void>;
  reset: () => void;
  setFilters: (filters: Filters) => void;
  setSortOptions: (sortOptions: SortOptions) => void;
  fetchMoviesFiltered: (offset: number, limit: number) => Promise<void>;
  clearFilters: () => void;
  fetchAvailableGenres: () => Promise<void>;
  fetchAvailableActors: () => Promise<void>;
  refreshThumbnailTokens: () => Promise<void>;
  setScrollPosition: (key: string, position: number) => void;
  setScrollProgress: (key: string, progress: number) => void;
  patchMovie: (id: number, partial: Partial<Movie>) => void;
  lastRequestId: number;
}

const compareMovies = (a: Movie, b: Movie, sort: SortOptions): number => {
  const dir = sort.sortOrder === "ASC" ? 1 : -1;

  // Treat missing ratings as -Infinity so that — combined with dir — they end up
  // at the start for ASC and at the end for DESC, matching SQLite's default.
  const ratingOf = (m: Movie) =>
    m.rating === undefined || m.rating === null ? Number.NEGATIVE_INFINITY : m.rating;

  const timeOf = (m: Movie) => Date.parse(m.added_at) || 0;

  switch (sort.sortBy) {
    case "rating": {
      const ra = ratingOf(a);
      const rb = ratingOf(b);
      if (ra !== rb) return (ra - rb) * dir;
      const ta = timeOf(a);
      const tb = timeOf(b);
      if (ta !== tb) return (ta - tb) * dir;
      return (b.id - a.id);
    }
    case "year": {
      const ya = a.year ?? -Infinity;
      const yb = b.year ?? -Infinity;
      if (ya !== yb) return (ya - yb) * dir;
      return (b.id - a.id);
    }
    case "title": {
      // Explicit locale so CJK titles sort by fixed collation rules instead of
      // the system-default locale, which varies across machines.
      const cmp = a.title.localeCompare(b.title, "zh-Hans-CN");
      if (cmp !== 0) return cmp * dir;
      return (b.id - a.id);
    }
    case "last_accessed": {
      const la = a.last_accessed ? Date.parse(a.last_accessed) : -Infinity;
      const lb = b.last_accessed ? Date.parse(b.last_accessed) : -Infinity;
      if (la !== lb) return (la - lb) * dir;
      return (b.id - a.id);
    }
    case "added_at":
    default: {
      const ta = timeOf(a);
      const tb = timeOf(b);
      if (ta !== tb) return (ta - tb) * dir;
      return (b.id - a.id);
    }
  }
};

export const useMovieStore = create<MovieStore>()(
  persist((set, get) => {
  const withRequestId = async <T>(
    label: string,
    options: {
      bumpId?: boolean;
      initial?: Partial<MovieStore>;
      work: (requestId: number) => Promise<T>;
      onSuccess: (result: T) => Partial<MovieStore>;
      onError?: (error: unknown) => Partial<MovieStore>;
      // Runs when the completion is stale. loadMore must release isLoadingMore
      // here: it does not bump the id, so any bumpId request racing in front
      // makes its completion stale, and a stranded isLoadingMore=true would
      // trip the guard and kill infinite scroll for the rest of the session.
      onStale?: () => Partial<MovieStore>;
    }
  ) => {
    const bumpId = options.bumpId ?? true;
    const requestId = bumpId ? get().lastRequestId + 1 : get().lastRequestId;
    const initial = options.initial ?? {};
    set({ ...initial, ...(bumpId ? { lastRequestId: requestId } : {}) });

    const settleStale = () => {
      logger.info(`[MovieStore] ${label} ignored: stale requestId=${requestId}`);
      if (options.onStale) set(options.onStale());
    };

    try {
      const result = await options.work(requestId);
      if (get().lastRequestId !== requestId) {
        settleStale();
        return;
      }
      set(options.onSuccess(result));
    } catch (error) {
      if (get().lastRequestId !== requestId) {
        settleStale();
        return;
      }
      logger.error(`[MovieStore] ${label} failed: ${error}`);
      if (options.onError) set(options.onError(error));
    }
  };

  return {
  movies: [],
  currentPage: 0,
  totalCount: 0,
  isLoading: false,
  isLoadingMore: false,
  hasMore: true,
  error: null,
  filters: {},
  sortOptions: { sortBy: 'added_at', sortOrder: 'DESC' },
  availableGenres: [],
  availableActors: [],
  isUsingFilters: false,
  scrollPositions: {},
  scrollProgresses: {},
  searchQuery: "",
  lastRequestId: 0,

  fetchMovies: async (offset: number) => {
    await withRequestId<Movie[]>("fetchMovies", {
      initial: { isLoading: true, error: null, searchQuery: "" },
      work: async () => {
        const state = get();
        const shouldUseFilteredQuery =
          state.isUsingFilters ||
          state.sortOptions.sortBy !== "added_at" ||
          state.sortOptions.sortOrder !== "DESC";

        return shouldUseFilteredQuery
          ? await getMoviesFiltered(
              offset,
              PAGE_SIZE,
              state.isUsingFilters ? state.filters : undefined,
              state.sortOptions,
              undefined
            )
          : await getMovies(offset, PAGE_SIZE);
      },
      onSuccess: (movies) => {
        logger.info(`[MovieStore] 获取电影数据: ${movies.length} 个电影`);
        return {
          movies,
          isLoading: false,
          hasMore: movies.length === PAGE_SIZE,
          currentPage: Math.floor(offset / PAGE_SIZE),
        };
      },
      onError: (error) => ({ error: String(error), isLoading: false }),
    });
  },

  loadMore: async () => {
    const state = get();
    if (state.isLoadingMore || !state.hasMore) return;

    const shouldUseFilteredQuery =
      Boolean(state.searchQuery) ||
      state.isUsingFilters ||
      state.sortOptions.sortBy !== "added_at" ||
      state.sortOptions.sortOrder !== "DESC";

    logger.info(`[MovieStore] Trigger loadMore: page=${state.currentPage}, searchQuery='${state.searchQuery}', requestId=${state.lastRequestId}`);

    await withRequestId<Movie[]>("loadMore", {
      bumpId: false,
      initial: { isLoadingMore: true },
      work: async () => {
        const offset = (state.currentPage + 1) * PAGE_SIZE;
        if (shouldUseFilteredQuery) {
          return await getMoviesFiltered(
            offset,
            PAGE_SIZE,
            state.isUsingFilters ? state.filters : undefined,
            state.sortOptions,
            state.searchQuery || undefined
          );
        }
        return await getMovies(offset, PAGE_SIZE);
      },
      onSuccess: (newMovies) => {
        const current = get();
        logger.info(`[MovieStore] loadMore success: fetched=${newMovies.length}, total_before=${current.movies.length}, next_page=${current.currentPage + 1}`);
        return {
          movies: [...current.movies, ...newMovies],
          isLoadingMore: false,
          hasMore: newMovies.length === PAGE_SIZE,
          currentPage: current.currentPage + 1,
        };
      },
      onError: () => ({ isLoadingMore: false }),
      onStale: () => ({ isLoadingMore: false }),
    });
  },

  searchMovies: async (query: string) => {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      set({ movies: [], isLoading: false, error: null, searchQuery: "", currentPage: 0, hasMore: false });
      return;
    }

    logger.info(`[MovieStore] Initial search: query='${normalizedQuery}'`);

    await withRequestId<Movie[]>("searchMovies", {
      initial: { isLoading: true, error: null, searchQuery: normalizedQuery, currentPage: 0 },
      work: async () => {
        const state = get();
        return await getMoviesFiltered(
          0,
          PAGE_SIZE,
          state.isUsingFilters ? state.filters : undefined,
          state.sortOptions,
          normalizedQuery
        );
      },
      onSuccess: (movies) => {
        logger.info(`[MovieStore] Search success: fetched=${movies.length}`);
        return {
          movies,
          isLoading: false,
          hasMore: movies.length === PAGE_SIZE,
          currentPage: 0,
        };
      },
      onError: (error) => ({ error: String(error), isLoading: false }),
    });
  },

  playMovie: async (id: number) => {
    try {
      await playMovie(id);
    } catch (error) {
      set({ error: String(error) });
    }
  },

  reset: () => {
    set({ movies: [], currentPage: 0, totalCount: 0, isLoading: false, error: null, searchQuery: "" });
  },

  setFilters: (filters: Filters) => {
    set({ filters, isUsingFilters: hasActiveFilterValues(filters) });
  },

  setSortOptions: (sortOptions: SortOptions) => {
    set({ sortOptions });
  },

  fetchMoviesFiltered: async (offset: number, limit: number) => {
    await withRequestId<Movie[]>("fetchMoviesFiltered", {
      initial: { isLoading: true, error: null },
      work: async () => {
        const state = get();
        return await getMoviesFiltered(
          offset,
          limit,
          state.isUsingFilters ? state.filters : undefined,
          state.sortOptions,
          state.searchQuery || undefined
        );
      },
      onSuccess: (movies) => {
        logger.info(`[MovieStore] 获取筛选电影数据: ${movies.length} 个电影`);
        return {
          movies,
          isLoading: false,
          hasMore: movies.length === limit,
          currentPage: Math.floor(offset / limit),
        };
      },
      onError: (error) => ({ error: String(error), isLoading: false }),
    });
  },

  clearFilters: () => {
    set({ filters: {}, isUsingFilters: false });
  },

  fetchAvailableGenres: async () => {
    try {
      const genres = await getUniqueGenres();
      set({ availableGenres: genres });
    } catch (error) {
      logger.error(`[MovieStore] 获取类型列表失败: ${error}`);
    }
  },

  fetchAvailableActors: async () => {
    try {
      const actors = await getUniqueActors();
      set({ availableActors: actors });
    } catch (error) {
      logger.error(`[MovieStore] 获取演员列表失败: ${error}`);
    }
  },

  // Refetch only the pages already in memory and merge each row's fresh
  // `updated_at`/`thumbnail_path` — the ?v= token that busts the webview's
  // image cache after a thumbnail regeneration. Unlike fetchMovies(0) this
  // never replaces the list, so deeply-loaded pages and currentPage survive;
  // pages the user has not reached yet are fetched fresh by loadMore anyway.
  refreshThumbnailTokens: async () => {
    try {
      const state = get();
      if (state.movies.length === 0) return;

      const shouldUseFilteredQuery =
        Boolean(state.searchQuery) ||
        state.isUsingFilters ||
        state.sortOptions.sortBy !== "added_at" ||
        state.sortOptions.sortOrder !== "DESC";

      const fresh: Movie[] = [];
      for (let page = 0; page <= state.currentPage; page++) {
        const offset = page * PAGE_SIZE;
        const rows = shouldUseFilteredQuery
          ? await getMoviesFiltered(
              offset,
              PAGE_SIZE,
              state.isUsingFilters ? state.filters : undefined,
              state.sortOptions,
              state.searchQuery || undefined
            )
          : await getMovies(offset, PAGE_SIZE);
        fresh.push(...rows);
      }

      const freshById = new Map(fresh.map((m) => [m.id, m]));
      set((current) => ({
        movies: current.movies.map((m) => {
          const updated = freshById.get(m.id);
          return updated
            ? { ...m, updated_at: updated.updated_at, thumbnail_path: updated.thumbnail_path }
            : m;
        }),
      }));
    } catch (error) {
      // Token refresh is cosmetic; regeneration already succeeded, so a failure
      // here must not surface as a failed regeneration.
      logger.error(`[MovieStore] 刷新缩略图令牌失败: ${error}`);
    }
  },

  setScrollPosition: (key: string, position: number) => {
    set((state) => ({
      scrollPositions: {
        ...state.scrollPositions,
        [key]: position
      }
    }));
  },

  setScrollProgress: (key: string, progress: number) => {
    set((state) => ({
      scrollProgresses: {
        ...state.scrollProgresses,
        [key]: progress,
      }
    }));
  },

  patchMovie: (id: number, partial: Partial<Movie>) => {
    set((state) => {
      let touched = false;
      const next = state.movies.map((m) => {
        if (m.id !== id) return m;
        touched = true;
        return { ...m, ...partial };
      });
      if (!touched) return state;

      // Re-sort in memory so the patched row falls into the right rating
      // section right away; without this, the card just updates in place.
      next.sort((a, b) => compareMovies(a, b, state.sortOptions));
      return { movies: next };
    });
  },
  };
  },
  {
    name: "movie-storage",
    // Persist only the scroll bookkeeping so a restart can restore the
    // browsing position; movies, filters and request state start fresh.
    partialize: (state) => ({
      scrollPositions: state.scrollPositions,
      scrollProgresses: state.scrollProgresses,
    }),
  })
);
