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
  is_watched?: number;
  group_id?: number;
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

export interface ScanResult {
  new_movies: number;
  deleted_movies: number;
  total_movies: number;
}

export interface ScanCompletion {
  status: "success" | "error" | "cancelled";
  result?: ScanResult;
  message?: string;
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
  isWatched?: boolean;
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

export const searchMovies = async (query: string, offset: number, limit: number): Promise<Movie[]> => {
  return await invoke("search_movies", { query, offset, limit });
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

export const setWatchedStatus = async (id: number, isWatched: boolean): Promise<void> => {
  return await invoke("set_watched_status", { id, isWatched });
};

export interface VideoGroup {
  id: number;
  title: string;
  year?: number;
  plot?: string;
  rating?: number;
  genres?: string;
  director?: string;
  actors?: string;
  poster_path?: string;
  total_duration?: number;
  part_count: number;
  created_at: string;
  updated_at: string;
}

export interface VideoPart {
  id: number;
  group_id: number;
  movie_id: number;
  part_number: number;
  part_title?: string;
  duration_seconds?: number;
}

export interface VideoPartWithMovie {
  part: VideoPart;
  movie: Movie;
}

export interface VideoGroupWithParts {
  group: VideoGroup;
  parts: VideoPartWithMovie[];
}

export interface MovieWithPart {
  movie: Movie;
  part_number: number;
  part_title: string;
}

export interface VideoGroupCandidate {
  title: string;
  movies: MovieWithPart[];
}

export const getVideoGroups = async (offset: number, limit: number): Promise<VideoGroup[]> => {
  return await invoke<VideoGroup[]>("get_video_groups", { offset, limit });
};

export const getVideoGroupDetail = async (id: number): Promise<VideoGroupWithParts> => {
  return await invoke<VideoGroupWithParts>("get_video_group_detail", { id });
};

export const createVideoGroup = async (
  title: string,
  year?: number,
  plot?: string,
  rating?: number,
  genres?: string,
  director?: string,
  actors?: string,
  poster_path?: string
): Promise<number> => {
  return await invoke<number>("create_video_group", {
    title,
    year,
    plot,
    rating,
    genres,
    director,
    actors,
    poster_path,
  });
};

export const addVideoPart = async (
  groupId: number,
  movieId: number,
  partNumber: number,
  partTitle?: string
): Promise<number> => {
  return await invoke<number>("add_video_part", {
    groupId,
    movieId,
    partNumber,
    partTitle,
  });
};

export const deleteVideoGroup = async (id: number): Promise<void> => {
  return await invoke("delete_video_group", { id });
};

export const autoDetectVideoGroups = async (): Promise<VideoGroupCandidate[]> => {
  return await invoke<VideoGroupCandidate[]>("auto_detect_video_groups");
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

export const clearCache = async (): Promise<void> => {
  return await invoke("clear_cache");
};

export const onScanProgress = (callback: (status: ScanStatus) => void) => {
  return listen<ScanStatus>("scan-progress", (event) => {
    callback(event.payload);
  });
};

export const onScanComplete = (callback: (payload: ScanCompletion) => void) => {
  return listen<ScanCompletion>("scan-complete", (event) => {
    callback(event.payload);
  });
};

export const showInFileManager = async (filePath: string): Promise<void> => {
  return await invoke("show_in_file_manager", { filePath });
};

export const setMovieRating = async (movieId: number, rating: number | null): Promise<void> => {
  return await invoke("set_movie_rating", { movieId, rating });
};

export const getMoviesFiltered = async (
  offset: number,
  limit: number,
  filters?: Filters,
  sortOptions?: SortOptions,
  searchQuery?: string
): Promise<Movie[]> => {
  return await invoke("get_movies_filtered", {
    offset,
    limit,
    searchQuery: searchQuery?.trim() || undefined,
    minYear: filters?.minYear,
    maxYear: filters?.maxYear,
    minRating: filters?.minRating,
    maxRating: filters?.maxRating,
    actors: filters?.actors,
    genres: filters?.genres,
    sortBy: sortOptions?.sortBy,
    sortOrder: sortOptions?.sortOrder,
    isWatched: filters?.isWatched,
  });
};

export const getUniqueGenres = async (): Promise<string[]> => {
  return await invoke("get_unique_genres");
};

export const getUniqueActors = async (): Promise<string[]> => {
  return await invoke("get_unique_actors");
};

export interface ActorInfo {
  name: string;
  movie_count: number;
  representative_thumbnail: string | null;
}

export const getActorsWithCounts = async (): Promise<ActorInfo[]> => {
  return await invoke("get_actors_with_counts");
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

export const frontendLog = async (level: string, message: string): Promise<void> => {
  try {
    await invoke("frontend_log", { level, message });
  } catch (e) {
    console.error("Failed to invoke frontend_log:", e);
  }
};

export const logger = {
  error: (...args: any[]) => frontendLog("error", args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")),
  warn: (...args: any[]) => frontendLog("warn", args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")),
  info: (...args: any[]) => frontendLog("info", args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")),
  debug: (...args: any[]) => frontendLog("debug", args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")),
  trace: (...args: any[]) => frontendLog("trace", args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")),
};
