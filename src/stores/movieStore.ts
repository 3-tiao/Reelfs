import { create } from "zustand";
import { Movie, getMovies, searchMovies, playMovie } from "../services/tauri";
import { createLogger } from "../lib/logger";

const logger = createLogger('MovieStore');

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
    logger.debug('开始获取电影列表，offset:', offset);
    set({ isLoading: true, error: null });
    try {
      const movies = await getMovies(offset, 200);
      logger.info('获取电影数据成功:', movies.length, '个电影');
      logger.debug('前3个电影:', movies.slice(0, 3).map(m => ({
        id: m.id,
        title: m.title,
        thumbnail_path: m.thumbnail_path,
        poster_path: m.poster_path
      })));
      set({ movies, isLoading: false });
    } catch (error) {
      logger.error('获取电影失败:', error);
      set({ error: String(error), isLoading: false });
    }
  },

  searchMovies: async (query: string) => {
    logger.info('开始搜索电影:', query);
    set({ isLoading: true, error: null });
    try {
      const movies = await searchMovies(query);
      logger.info('搜索完成，找到', movies.length, '个结果');
      if (movies.length > 0) {
        logger.debug('前3个搜索结果:', movies.slice(0, 3).map(m => ({
          id: m.id,
          title: m.title,
          file_path: m.file_path
        })));
      }
      set({ movies, isLoading: false });
    } catch (error) {
      logger.error('搜索失败:', error);
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
