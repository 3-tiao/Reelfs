import { create } from "zustand";
import { Movie, getMovies, playMovie, Filters, SortOptions, getMoviesFiltered, getUniqueGenres, getUniqueActors, logger } from "../services/tauri";

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
  setScrollPosition: (key: string, position: number) => void;
  setScrollProgress: (key: string, progress: number) => void;
  lastRequestId: number;
}

export const useMovieStore = create<MovieStore>((set, get) => ({
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
    const requestId = get().lastRequestId + 1;
    set({ isLoading: true, error: null, searchQuery: "", lastRequestId: requestId });
    try {
      const movies = await getMovies(offset, 200);
      if (get().lastRequestId !== requestId) {
        logger.info(`[MovieStore] fetchMovies ignored: stale requestId=${requestId}`);
        return;
      }

      logger.info(`[MovieStore] 获取电影数据: ${movies.length} 个电影`);
      logger.info(`[MovieStore] 前3个电影: ${JSON.stringify(movies.slice(0, 3).map(m => ({
        id: m.id,
        title: m.title,
        thumbnail_path: m.thumbnail_path
      })))}`);
      set({ 
        movies, 
        isLoading: false, 
        hasMore: movies.length === 200,
        currentPage: Math.floor(offset / 200)
      });
    } catch (error) {
      logger.error(`[MovieStore] 获取电影失败: ${error}`);
      set({ error: String(error), isLoading: false });
    }
  },

  loadMore: async () => {
    const state = get();
    if (state.isLoadingMore || !state.hasMore) return;

    const shouldUseFilteredQuery =
      Boolean(state.searchQuery) ||
      state.isUsingFilters ||
      state.sortOptions.sortBy !== "added_at" ||
      state.sortOptions.sortOrder !== "DESC";
    
    const requestId = state.lastRequestId;
    logger.info(`[MovieStore] Trigger loadMore: page=${state.currentPage}, searchQuery='${state.searchQuery}', requestId=${requestId}`);
    set({ isLoadingMore: true });
    try {
      const offset = (state.currentPage + 1) * 200;
      let newMovies: Movie[] = [];
      
      if (shouldUseFilteredQuery) {
        newMovies = await getMoviesFiltered(
          offset,
          200,
          state.isUsingFilters ? state.filters : undefined,
          state.sortOptions,
          state.searchQuery || undefined
        );
      } else {
        newMovies = await getMovies(offset, 200);
      }
      
      if (get().lastRequestId !== requestId) {
        logger.info(`[MovieStore] loadMore ignored: stale requestId=${requestId}`);
        return;
      }

      logger.info(`[MovieStore] loadMore success: fetched=${newMovies.length}, total_before=${state.movies.length}, next_page=${state.currentPage + 1}`);
      
      set({ 
        movies: [...state.movies, ...newMovies],
        isLoadingMore: false,
        hasMore: newMovies.length === 200,
        currentPage: state.currentPage + 1
      });
    } catch (error) {
      if (get().lastRequestId === requestId) {
        logger.error(`[MovieStore] loadMore failed: ${error}`);
        set({ isLoadingMore: false });
      }
    }
  },

  searchMovies: async (query: string) => {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      set({ movies: [], isLoading: false, error: null, searchQuery: "", currentPage: 0, hasMore: false });
      return;
    }

    const requestId = get().lastRequestId + 1;
    logger.info(`[MovieStore] Initial search: query='${normalizedQuery}', requestId=${requestId}`);
    set({ isLoading: true, error: null, searchQuery: normalizedQuery, currentPage: 0, lastRequestId: requestId });
    try {
      const state = get();
      const movies = await getMoviesFiltered(
        0,
        200,
        state.isUsingFilters ? state.filters : undefined,
        state.sortOptions,
        normalizedQuery
      );
      
      if (get().lastRequestId !== requestId) {
        logger.info(`[MovieStore] search ignored: stale requestId=${requestId}`);
        return;
      }

      logger.info(`[MovieStore] Search success: fetched=${movies.length}`);
      set({ 
        movies, 
        isLoading: false,
        hasMore: movies.length === 200,
        currentPage: 0
      });
    } catch (error) {
      if (get().lastRequestId === requestId) {
        logger.error(`[MovieStore] Search failed: ${error}`);
        set({ error: String(error), isLoading: false });
      }
    }
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
    const state = get();
    const requestId = state.lastRequestId + 1;
    set({ isLoading: true, error: null, lastRequestId: requestId });
    try {
      const movies = await getMoviesFiltered(
        offset,
        limit,
        state.isUsingFilters ? state.filters : undefined,
        state.sortOptions,
        state.searchQuery || undefined
      );
      if (get().lastRequestId !== requestId) {
        logger.info(`[MovieStore] filtered fetch ignored: stale requestId=${requestId}`);
        return;
      }

      logger.info(`[MovieStore] 获取筛选电影数据: ${movies.length} 个电影`);
      set({ 
        movies, 
        isLoading: false,
        hasMore: movies.length === limit,
        currentPage: Math.floor(offset / limit)
      });
    } catch (error) {
      logger.error(`[MovieStore] 获取筛选电影失败: ${error}`);
      set({ error: String(error), isLoading: false });
    }
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
}));
