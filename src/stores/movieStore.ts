import { create } from "zustand";
import { Movie, getMovies, searchMovies, playMovie, Filters, SortOptions, getMoviesFiltered, getUniqueGenres, getUniqueActors } from "../services/tauri";

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
  scrollPosition: number;

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
  setScrollPosition: (position: number) => void;
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
  scrollPosition: 0,

  fetchMovies: async (offset: number) => {
    set({ isLoading: true, error: null });
    try {
      const movies = await getMovies(offset, 200);
      console.log('[MovieStore] 获取电影数据:', movies.length, '个电影');
      console.log('[MovieStore] 前3个电影:', movies.slice(0, 3).map(m => ({
        id: m.id,
        title: m.title,
        thumbnail_path: m.thumbnail_path
      })));
      set({ 
        movies, 
        isLoading: false, 
        hasMore: movies.length === 200,
        currentPage: Math.floor(offset / 200)
      });
    } catch (error) {
      console.error('[MovieStore] 获取电影失败:', error);
      set({ error: String(error), isLoading: false });
    }
  },

  loadMore: async () => {
    const state = get();
    if (state.isLoadingMore || !state.hasMore) return;
    
    set({ isLoadingMore: true });
    try {
      const offset = (state.currentPage + 1) * 200;
      const newMovies = await getMovies(offset, 200);
      console.log('[MovieStore] 加载更多电影:', newMovies.length, '个电影');
      
      set({ 
        movies: [...state.movies, ...newMovies],
        isLoadingMore: false,
        hasMore: newMovies.length === 200,
        currentPage: state.currentPage + 1
      });
    } catch (error) {
      console.error('[MovieStore] 加载更多电影失败:', error);
      set({ isLoadingMore: false });
    }
  },

  searchMovies: async (query: string) => {
    set({ isLoading: true, error: null });
    try {
      const movies = await searchMovies(query);
      set({ movies, isLoading: false });
    } catch (error) {
      set({ error: String(error), isLoading: false });
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
    set({ movies: [], currentPage: 0, totalCount: 0, isLoading: false, error: null });
  },

  setFilters: (filters: Filters) => {
    set({ filters, isUsingFilters: true });
  },

  setSortOptions: (sortOptions: SortOptions) => {
    set({ sortOptions });
  },

  fetchMoviesFiltered: async (offset: number, limit: number) => {
    const state = useMovieStore.getState();
    set({ isLoading: true, error: null });
    try {
      const movies = await getMoviesFiltered(offset, limit, state.filters, state.sortOptions);
      console.log('[MovieStore] 获取筛选电影数据:', movies.length, '个电影');
      set({ movies, isLoading: false });
    } catch (error) {
      console.error('[MovieStore] 获取筛选电影失败:', error);
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
      console.error('[MovieStore] 获取类型列表失败:', error);
    }
  },

  fetchAvailableActors: async () => {
    try {
      const actors = await getUniqueActors();
      set({ availableActors: actors });
    } catch (error) {
      console.error('[MovieStore] 获取演员列表失败:', error);
    }
  },

  setScrollPosition: (position: number) => {
    set({ scrollPosition: position });
  },
}));
