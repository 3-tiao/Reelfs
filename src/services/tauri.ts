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
  poster_path?: string;
  fanart_path?: string;
  thumbnail_path?: string;
  file_size?: number;
  duration_seconds?: number;
  added_at: string;
  updated_at: string;
  last_accessed?: string;
}

export interface PlayHistory {
  id: number;
  movie_id: number;
  last_position: number;
  last_played: string;
  play_count: number;
}

export interface ScanStatus {
  is_scanning: boolean;
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

export const getMovies = async (offset: number, limit: number): Promise<Movie[]> => {
  return await invoke("get_movies", { offset, limit });
};

export const getMovieDetail = async (id: number): Promise<[Movie, PlayHistory | null]> => {
  return await invoke("get_movie_detail", { id });
};

export const searchMovies = async (query: string): Promise<Movie[]> => {
  return await invoke("search_movies", { query });
};

export const startInitialScan = async (): Promise<string> => {
  return await invoke("start_initial_scan");
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
