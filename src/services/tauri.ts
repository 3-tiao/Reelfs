import { invoke } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";

export interface Movie {
  id: number;
  file_path: string;
  title: string;
  year?: number;
  plot?: string;
  rating?: number;
  genres?: string;
  director?: string;
  actors?: string;
  thumbnail_path?: string;
  file_size?: number;
  duration_seconds?: number;
  width?: number;
  height?: number;
  added_at: string;
  updated_at: string;
  last_accessed?: string;
  last_checked_at?: string;
  scan_state?: string;
}

export interface PlayHistory {
  id: number;
  movie_id: number;
  last_position: number;
  last_played: string;
  play_count: number;
}

export enum ImportStage {
  Scanning = "Scanning",
  Importing = "Importing",
  GeneratingThumbnails = "GeneratingThumbnails",
}

export interface ScanStatus {
  is_scanning: boolean;
  stage: ImportStage;
  stage_message: string;
  total_files: number;
  scanned_files: number;
  current_file?: string;
}

export interface Stats {
  total_movies: number;
  total_size: number;
  db_size: number;
  cache_size: number;
}

export interface AppConfig {
  nas_paths: string[];
  cache_dir: string;
  db_path: string;
  scan_on_startup: boolean;
  auto_generate_thumbnails: boolean;
  theme: string;
  default_player: string;
}

export interface Filters {
  minYear?: number;
  maxYear?: number;
  minRating?: number;
  maxRating?: number;
  actors?: string;
  genres?: string;
}

export interface SortOptions {
  sortBy: 'title' | 'year' | 'rating' | 'added_at' | 'last_accessed';
  sortOrder: 'ASC' | 'DESC';
}

export const getMovies = async (offset: number, limit: number): Promise<Movie[]> => {
  return await invoke("get_movies", { offset, limit });
};

export const getMovieDetail = async (id: number): Promise<[Movie, PlayHistory | null]> => {
  return await invoke("get_movie_detail", { id });
};

export const searchMovies = async (query: string): Promise<Movie[]> => {
  return await invoke("search_movies", { query });
};

export const startInitialScan = async (scanMode: "incremental" | "full" = "incremental", deleteInvalid: boolean = false): Promise<string> => {
  return await invoke("start_initial_scan", { scanMode, deleteInvalid });
};

export const getScanStatus = async (): Promise<ScanStatus> => {
  return await invoke("get_scan_status");
};

export const playMovie = async (id: number): Promise<void> => {
  return await invoke("play_movie", { id });
};

export const updatePlayProgress = async (id: number, position: number): Promise<void> => {
  return await invoke("update_play_progress", { id, position });
};

export const getStats = async (): Promise<Stats> => {
  return await invoke("get_stats");
};

export const getConfig = async (): Promise<AppConfig> => {
  return await invoke("get_config");
};

export const updateConfig = async (config: AppConfig): Promise<void> => {
  return await invoke("update_config", { config });
};

export const generateThumbnail = async (movieId: number): Promise<string> => {
  return await invoke("generate_thumbnail", { movieId });
};

export const regenerateAllThumbnails = async (): Promise<string> => {
  return await invoke("regenerate_all_thumbnails");
};

export const batchGenerateThumbnails = async (movieIds: number[]): Promise<void> => {
  return await invoke("batch_generate_thumbnails", { movieIds });
};

export const clearCache = async (): Promise<void> => {
  return await invoke("clear_cache");
};

export const onScanProgress = (callback: (status: ScanStatus) => void) => {
  return listen<ScanStatus>("scan-progress", (event) => {
    callback(event.payload);
  });
};

export const onScanComplete = (callback: () => void) => {
  return listen("scan-complete", () => {
    callback();
  });
};

export const showInFileManager = async (filePath: string): Promise<void> => {
  return await invoke("show_in_file_manager", { filePath });
};

export const setMovieRating = async (movieId: number, rating: number | null): Promise<void> => {
  return await invoke("set_movie_rating", { movieId, rating });
};

export const clearThumbnails = async (): Promise<void> => {
  return await invoke("clear_thumbnails");
};

export const getMoviesFiltered = async (
  offset: number,
  limit: number,
  filters?: Filters,
  sortOptions?: SortOptions
): Promise<Movie[]> => {
  return await invoke("get_movies_filtered", {
    offset,
    limit,
    minYear: filters?.minYear,
    maxYear: filters?.maxYear,
    minRating: filters?.minRating,
    maxRating: filters?.maxRating,
    actors: filters?.actors,
    genres: filters?.genres,
    sortBy: sortOptions?.sortBy,
    sortOrder: sortOptions?.sortOrder,
  });
};

export const getUniqueGenres = async (): Promise<string[]> => {
  return await invoke("get_unique_genres");
};

export const getUniqueActors = async (): Promise<string[]> => {
  return await invoke("get_unique_actors");
};

export const resetDatabase = async (): Promise<void> => {
  return await invoke("reset_database");
};

export const stopScan = async (): Promise<void> => {
  return await invoke("stop_scan");
};

export const getAndUpdateVideoInfo = async (id: number): Promise<{
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
}> => {
  const result = await invoke<[number | null, number | null, number | null]>("get_and_update_video_info", { id });
  return {
    duration_seconds: result[0],
    width: result[1],
    height: result[2],
  };
};
