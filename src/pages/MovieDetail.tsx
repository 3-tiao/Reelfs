import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Play, Film, FolderOpen, Eye, EyeOff } from "lucide-react";
import { Movie, PlayHistory, getMovieDetail, playMovie, showInFileManager, setMovieRating, getAndUpdateVideoInfo, setWatchedStatus, logger } from "../services/tauri";
import { formatBytes, formatDuration } from "../lib/utils";
import { getCachedThumbnail } from "../lib/thumbnailCache";
import { findPosterAndFanart } from "../lib/imageUtils";
import DetailBackground from "../components/DetailBackground";
import MetadataChips from "../components/MetadataChips";
import CastList from "../components/CastList";
import InteractiveRating from "../components/InteractiveRating";

const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) {
    return "Today";
  } else if (diffDays === 1) {
    return "Yesterday";
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  } else if (diffDays < 30) {
    return `${Math.floor(diffDays / 7)} weeks ago`;
  } else {
    return date.toLocaleDateString();
  }
};

export default function MovieDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [movie, setMovie] = useState<Movie | null>(null);
  const [history, setHistory] = useState<PlayHistory | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [posterSrc, setPosterSrc] = useState<string | null>(null);
  const [fanartSrc, setFanartSrc] = useState<string | null>(null);
  const [isRating, setIsRating] = useState(false);

  useEffect(() => {
    if (id) {
      loadMovieDetail(parseInt(id));
    }
  }, [id]);

  const loadMovieDetail = async (movieId: number) => {
    try {
      const [movieData, historyData] = await getMovieDetail(movieId);
      setMovie(movieData);
      setHistory(historyData);
      setIsLoading(false);

      // 并行查找 poster 和 fanart，与主数据渲染完全解耦
      findPosterAndFanart(movieData.file_path).then(({ posterPath, fanartPath }) => {
        if (posterPath) {
          getCachedThumbnail(posterPath, true).then((url) => url && setPosterSrc(url));
        }
        if (fanartPath) {
          getCachedThumbnail(fanartPath, true).then((url) => url && setFanartSrc(url));
        }
      });

      if (!movieData.duration_seconds && !movieData.width && !movieData.height) {
        logger.info("[MovieDetail] 视频信息不存在，异步获取中...");
        getAndUpdateVideoInfo(movieId)
          .then((info) => {
            if (info.duration_seconds || info.width || info.height) {
              setMovie((prev) =>
                prev
                  ? {
                      ...prev,
                      duration_seconds: info.duration_seconds ?? undefined,
                      width: info.width ?? undefined,
                      height: info.height ?? undefined,
                    }
                  : null
              );
              logger.info("[MovieDetail] 视频信息更新成功:", info);
            }
          })
          .catch((err) => {
            logger.error("[MovieDetail] 获取视频信息失败:", err);
          });
      }
    } catch (error) {
      logger.error("Failed to load movie details:", error);
      setIsLoading(false);
    }
  };

  const handlePlay = async () => {
    if (movie) {
      try {
        await playMovie(movie.id);
      } catch (error) {
        logger.error("Failed to play movie:", error);
      }
    }
  };

  const handleShowInFileManager = async () => {
    if (movie) {
      try {
        await showInFileManager(movie.file_path);
      } catch (error) {
        logger.error("Failed to show in file manager:", error);
      }
    }
  };

  const handleRating = async (rating: number | null) => {
    if (!movie) return;
    
    setIsRating(true);
    try {
      await setMovieRating(movie.id, rating);
      setMovie({ ...movie, rating: rating ?? undefined });
    } catch (error) {
      logger.error("Failed to set rating:", error);
    } finally {
      setIsRating(false);
    }
  };

  const handleToggleWatched = async () => {
    if (!movie) return;
    
    try {
      const newStatus = movie.is_watched !== 1;
      await setWatchedStatus(movie.id, newStatus);
      setMovie({ ...movie, is_watched: newStatus ? 1 : 0 });
    } catch (error) {
      logger.error("Failed to toggle watched status:", error);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!movie) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-400">Movie not found</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-900 via-zinc-950 to-zinc-950 text-white">
      {/* Background */}
      <DetailBackground fanartSrc={fanartSrc} />

      {/* Content */}
      <div className="relative z-10">
        <button
          onClick={() => navigate(-1)}
          className="fixed top-6 left-6 flex items-center gap-2 px-4 py-2 bg-zinc-800/80 hover:bg-zinc-700/90 backdrop-blur-md rounded-xl transition-all duration-200 border border-zinc-700/50 shadow-lg z-50"
        >
          <ArrowLeft className="w-5 h-5" />
          Back
        </button>

        <div className="max-w-7xl mx-auto px-6 pt-20 pb-8">
          <div className="flex flex-col lg:flex-row gap-10">
            {/* Poster */}
            <div className="flex-shrink-0 mx-auto lg:mx-0">
              <div className="w-72 aspect-[2/3] bg-zinc-800/50 rounded-2xl overflow-hidden shadow-2xl border border-zinc-700/50 backdrop-blur-sm">
                {posterSrc ? (
                  <img
                    src={posterSrc}
                    alt={movie.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900">
                    <Film className="w-20 h-20 text-zinc-600" />
                  </div>
                )}
              </div>
            </div>

            {/* Info */}
            <div className="flex-1 space-y-6">
              <div>
                <h1 className="text-4xl lg:text-5xl font-bold mb-3 bg-gradient-to-r from-zinc-100 to-zinc-300 bg-clip-text text-transparent">
                  {movie.title}
                </h1>
                {movie.year && (
                  <p className="text-zinc-400 text-lg">{movie.year}</p>
                )}
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handlePlay}
                  className="flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-400 hover:to-teal-500 rounded-xl font-semibold text-lg transition-all duration-200 shadow-lg shadow-teal-500/25 hover:shadow-teal-500/40"
                >
                  <Play className="w-6 h-6" fill="currentColor" />
                  {history && history.last_position > 0
                    ? `Continue Playing (${Math.floor(history.last_position / 60)}m)`
                    : "Play"}
                </button>
                
                <button
                  onClick={handleToggleWatched}
                  className={`flex items-center gap-2 px-6 py-4 rounded-xl font-semibold transition-all duration-200 border ${
                    movie.is_watched === 1
                      ? "bg-teal-600/20 text-teal-400 hover:bg-teal-600/30 border-teal-500/30"
                      : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border-zinc-700"
                  }`}
                >
                  {movie.is_watched === 1 ? (
                    <>
                      <Eye className="w-5 h-5" />
                      Watched
                    </>
                  ) : (
                    <>
                      <EyeOff className="w-5 h-5" />
                      Mark as Watched
                    </>
                  )}
                </button>
              </div>
              
              <InteractiveRating 
                rating={movie.rating} 
                isRating={isRating} 
                onRate={handleRating} 
              />

              <MetadataChips title="Genres" items={movie.genres} />

              {movie.plot && (
                <div>
                  <h3 className="text-zinc-400 text-sm uppercase tracking-wider mb-3 font-medium">Plot</h3>
                  <p className="text-zinc-200 leading-relaxed text-lg">{movie.plot}</p>
                </div>
              )}

              {movie.director && (
                <div>
                  <h3 className="text-zinc-400 text-sm uppercase tracking-wider mb-2 font-medium">Director</h3>
                  <p className="text-zinc-100 text-lg">{movie.director}</p>
                </div>
              )}

              <CastList actors={movie.actors} />

              <div className="pt-6 border-t border-zinc-800/50">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-zinc-400 text-sm uppercase tracking-wider font-medium">File Info</h3>
                  <button
                    onClick={handleShowInFileManager}
                    className="flex items-center gap-2 px-4 py-2 bg-zinc-800/60 hover:bg-zinc-700/80 backdrop-blur-sm rounded-lg font-medium text-sm transition-all duration-200 border border-zinc-700/50"
                  >
                    <FolderOpen className="w-4 h-4" />
                    Show in File Manager
                  </button>
                </div>
                <div className="space-y-3 text-sm bg-zinc-800/30 rounded-xl p-4 border border-zinc-700/30">
                  <div className="flex items-start gap-3">
                    <span className="text-zinc-500 min-w-[60px]">Path:</span>
                    <span className="text-zinc-300 font-mono text-xs break-all">{movie.file_path}</span>
                  </div>
                  {movie.file_size && (
                    <div className="flex items-center gap-3">
                      <span className="text-zinc-500 min-w-[60px]">Size:</span>
                      <span className="text-zinc-300 font-medium">
                        {formatBytes(movie.file_size)}
                      </span>
                    </div>
                  )}
                  {movie.duration_seconds && (
                    <div className="flex items-center gap-3">
                      <span className="text-zinc-500 min-w-[60px]">Duration:</span>
                      <span className="text-zinc-300 font-medium">
                        {formatDuration(movie.duration_seconds)}
                      </span>
                    </div>
                  )}
                  {movie.width && movie.height && (
                    <div className="flex items-center gap-3">
                      <span className="text-zinc-500 min-w-[60px]">Resolution:</span>
                      <span className="text-zinc-300 font-medium">
                        {movie.width}×{movie.height}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    <span className="text-zinc-500 min-w-[60px]">Added:</span>
                    <span className="text-zinc-300 font-medium">
                      {formatDate(movie.added_at)}
                    </span>
                  </div>
                  {movie.last_accessed && (
                    <div className="flex items-center gap-3">
                      <span className="text-zinc-500 min-w-[60px]">Last Accessed:</span>
                      <span className="text-zinc-300 font-medium">
                        {formatDate(movie.last_accessed)}
                      </span>
                    </div>
                  )}
                  {history && history.play_count > 0 && (
                    <div className="flex items-center gap-3">
                      <span className="text-gray-500 min-w-[60px]">Played:</span>
                      <span className="text-gray-300 font-medium">{history.play_count} times</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
