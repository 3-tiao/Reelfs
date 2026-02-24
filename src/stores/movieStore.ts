import { create } from "zustand";
import { Movie, getMovies, searchMovies, playMovie } from "../services/tauri";

interface MovieStore {
  movies: Movie[];
  currentPage: number;
  totalCount: number;
  isLoading: boolean;
  error: string | null;

  fetchMovies: (offset: number) => Promise<void>;
  searchMovies: (query: string) => Promise<void>;
  playMovie: (id: number) => Promise<void>;
  reset: () => void;
}

export const useMovieStore = create<MovieStore>((set) => ({
  movies: [],
  currentPage: 0,
  totalCount: 0,
  isLoading: false,
  error: null,

  fetchMovies: async (offset: number) => {
    set({ isLoading: true, error: null });
    try {
      const movies = await getMovies(offset, 200);
      console.log('[MovieStore] 获取电影数据:', movies.length, '个电影');
      console.log('[MovieStore] 前3个电影:', movies.slice(0, 3).map(m => ({
        id: m.id,
        title: m.title,
        thumbnail_path: m.thumbnail_path,
        poster_path: m.poster_path
      })));
      set({ movies, isLoading: false });
    } catch (error) {
      console.error('[MovieStore] 获取电影失败:', error);
      set({ error: String(error), isLoading: false });
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
}));
