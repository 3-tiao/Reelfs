import { useEffect, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft, Play, Film, FolderOpen, Eye, EyeOff, AlertCircle } from "lucide-react";
import { Movie, PlayHistory, getMovieDetail, playMovie, showInFileManager, setMovieRating, getAndUpdateVideoInfo, setWatchedStatus, logger } from "../services/tauri";
import { formatBytes, formatDuration } from "../lib/utils";
import { getCachedThumbnail } from "../lib/thumbnailCache";
import { findPosterAndFanart } from "../lib/imageUtils";
import DetailBackground from "../components/DetailBackground";
import MetadataChips from "../components/MetadataChips";
import CastList from "../components/CastList";
import InteractiveRating from "../components/InteractiveRating";
import { getBackTarget } from "../lib/navigation";
import { useMovieStore } from "../stores/movieStore";

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
  const location = useLocation();
  const [movie, setMovie] = useState<Movie | null>(null);
  const [history, setHistory] = useState<PlayHistory | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
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
      setLoadError(null);
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
      setLoadError(String(error));
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
      const nextRating = rating ?? undefined;
      setMovie({ ...movie, rating: nextRating });
      useMovieStore.getState().patchMovie(movie.id, { rating: nextRating });
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
      const nextWatched = newStatus ? 1 : 0;
      setMovie({ ...movie, is_watched: nextWatched });
      useMovieStore.getState().patchMovie(movie.id, { is_watched: nextWatched });
    } catch (error) {
      logger.error("Failed to toggle watched status:", error);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top_left,rgba(20,184,166,0.12),transparent_18%),linear-gradient(180deg,#09090b,#0a0f10)]">
        <div className="text-center">
          <div className="mx-auto mb-5 h-14 w-14 animate-spin rounded-full border-2 border-teal-300/20 border-t-teal-300"></div>
          <p className="text-base font-medium text-zinc-200">Loading feature details</p>
        </div>
      </div>
    );
  }

  if (!movie) {
    const backTarget = getBackTarget(location.state, "/");
    const message = loadError
      ? "影片信息加载失败，可能已经被删除或从扫描中移除。"
      : "找不到这部影片。";
    return (
      <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top_left,rgba(239,68,68,0.08),transparent_22%),linear-gradient(180deg,#09090b,#0a0f10)] px-6">
        <div className="max-w-md w-full rounded-[26px] border border-white/8 bg-white/[0.03] p-8 text-center backdrop-blur-xl">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-rose-400/20 bg-rose-500/10 text-rose-300">
            <AlertCircle className="w-6 h-6" />
          </div>
          <p className="text-base font-medium text-zinc-100">{message}</p>
          {loadError && (
            <p className="mt-2 text-xs text-zinc-500 break-all">{loadError}</p>
          )}
          <button
            onClick={() => navigate(backTarget)}
            className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-4 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/[0.09]"
          >
            <ArrowLeft className="w-4 h-4" />
            返回上一页
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-900 via-zinc-950 to-zinc-950 text-white">
      <DetailBackground fanartSrc={fanartSrc} />

      <div className="relative z-10">
        <button
          onClick={() => navigate(getBackTarget(location.state, "/"))}
          className="fixed left-5 top-5 z-50 flex items-center gap-2 rounded-full border border-white/10 bg-zinc-950/55 px-4 py-2.5 text-sm font-medium text-zinc-200 backdrop-blur-xl transition-colors duration-200 hover:bg-zinc-900/80 hover:text-white md:left-6 md:top-6"
        >
          <ArrowLeft className="w-5 h-5" />
          Back
        </button>

        <div className="max-w-7xl mx-auto px-6 pt-20 pb-8">
          <div className="flex flex-col lg:flex-row gap-10">
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
                  className="flex items-center gap-3 rounded-2xl bg-gradient-to-r from-teal-400 to-emerald-400 px-6 py-4 font-semibold text-zinc-950 shadow-[0_18px_42px_rgba(20,184,166,0.28)] transition-transform duration-200 hover:-translate-y-0.5"
                >
                  <Play className="w-6 h-6" fill="currentColor" />
                  {history && history.last_position > 0
                    ? `Continue Playing (${Math.floor(history.last_position / 60)}m)`
                    : "Play"}
                </button>

                <button
                  onClick={handleToggleWatched}
                  className={`flex items-center gap-2 rounded-2xl border px-5 py-4 font-medium transition-colors ${
                    movie.is_watched === 1
                      ? "border-teal-400/20 bg-teal-400/12 text-teal-100 hover:bg-teal-400/16"
                      : "border-white/10 bg-white/[0.04] text-zinc-200 hover:bg-white/[0.08]"
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
                    className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/[0.08]"
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
                        {movie.width}x{movie.height}
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
