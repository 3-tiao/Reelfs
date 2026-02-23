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
      set({ movies, isLoading: false });
    } catch (error) {
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
