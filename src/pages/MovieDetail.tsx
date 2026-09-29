import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft, Play, Film, FolderOpen, Eye, EyeOff, AlertCircle } from "lucide-react";
import { Movie, PlayHistory, getMovieDetail, playMovie, showInFileManager, setMovieRating, getAndUpdateVideoInfo, setWatchedStatus, logger } from "../services/tauri";
import { formatBytes, formatDuration } from "../lib/utils";
import { acquireThumbnail, releaseThumbnail } from "../lib/thumbnailCache";
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
  // Blob URLs this page renders; pinned while mounted so LRU eviction cannot
  // revoke them, and released on unmount.
  const pinnedImagesRef = useRef<string[]>([]);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      pinnedImagesRef.current.forEach((path) => releaseThumbnail(path));
      pinnedImagesRef.current = [];
    };
  }, []);

  const loadPinned = (path: string, apply: (url: string) => void) => {
    acquireThumbnail(path, true).then((url) => {
      if (!url) return;
      if (!isMountedRef.current) {
        releaseThumbnail(path);
        return;
      }
      pinnedImagesRef.current.push(path);
      apply(url);
    });
  };

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
          loadPinned(posterPath, setPosterSrc);
        }
        if (fanartPath) {
          loadPinned(fanartPath, setFanartSrc);
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
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="mx-auto mb-4 h-6 w-6 animate-spin rounded-full border-2 border-white/15 border-t-foreground" />
          <p className="text-sm text-muted-foreground">Loading feature details</p>
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
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="w-full max-w-md rounded-2xl border border-white/[0.06] bg-card p-8 text-center">
          <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-destructive/15 text-destructive">
            <AlertCircle className="h-5 w-5" />
          </div>
          <p className="text-sm font-medium text-foreground">{message}</p>
          {loadError && <p className="mt-2 break-all text-xs text-muted-foreground">{loadError}</p>}
          <button
            onClick={() => navigate(backTarget)}
            className="mt-6 inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-white/[0.16] hover:bg-white/[0.08]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            返回上一页
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <DetailBackground fanartSrc={fanartSrc} />

      <div className="relative z-10">
        <button
          onClick={() => navigate(getBackTarget(location.state, "/"))}
          className="fixed left-5 top-5 z-50 inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-background/80 px-3 py-1.5 text-sm font-medium text-foreground backdrop-blur-xl transition-colors hover:border-white/[0.16] hover:bg-white/[0.04] md:left-6 md:top-6"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>

        <div className="mx-auto max-w-7xl px-6 pb-12 pt-20">
          <div className="flex flex-col gap-10 lg:flex-row">
            <div className="mx-auto flex-shrink-0 lg:mx-0">
              <div className="aspect-[2/3] w-72 overflow-hidden rounded-2xl border border-white/[0.06] bg-card">
                {posterSrc ? (
                  <img src={posterSrc} alt={movie.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <Film className="h-16 w-16 text-white/15" />
                  </div>
                )}
              </div>
            </div>

            <div className="flex-1 space-y-6">
              <div>
                <h1 className="mb-2 text-4xl font-semibold tracking-tight text-foreground lg:text-5xl">
                  {movie.title}
                </h1>
                {movie.year && <p className="text-base text-muted-foreground">{movie.year}</p>}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handlePlay}
                  className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
                >
                  <Play className="h-4 w-4" fill="currentColor" />
                  Play
                </button>

                <button
                  onClick={handleToggleWatched}
                  className={`inline-flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-medium transition-colors ${
                    movie.is_watched === 1
                      ? "border-white/[0.16] bg-white/[0.08] text-foreground"
                      : "border-white/[0.08] bg-transparent text-muted-foreground hover:border-white/[0.16] hover:bg-white/[0.04] hover:text-foreground"
                  }`}
                >
                  {movie.is_watched === 1 ? (
                    <>
                      <Eye className="h-4 w-4" />
                      Watched
                    </>
                  ) : (
                    <>
                      <EyeOff className="h-4 w-4" />
                      Mark as Watched
                    </>
                  )}
                </button>
              </div>

              <InteractiveRating rating={movie.rating} isRating={isRating} onRate={handleRating} />

              <MetadataChips title="Genres" items={movie.genres} />

              {movie.plot && (
                <div>
                  <h3 className="mb-2 text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                    Plot
                  </h3>
                  <p className="text-base leading-relaxed text-foreground/90">{movie.plot}</p>
                </div>
              )}

              {movie.director && (
                <div>
                  <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                    Director
                  </h3>
                  <p className="text-sm text-foreground">{movie.director}</p>
                </div>
              )}

              <CastList actors={movie.actors} />

              <div className="border-t border-white/[0.06] pt-6">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                    File Info
                  </h3>
                  <button
                    onClick={handleShowInFileManager}
                    className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-transparent px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-white/[0.16] hover:bg-white/[0.04] hover:text-foreground"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    Show in File Manager
                  </button>
                </div>
                <div className="space-y-2.5 rounded-xl border border-white/[0.06] bg-black/40 p-4 text-sm">
                  <InfoRow label="Path" value={movie.file_path} mono />
                  {movie.file_size && <InfoRow label="Size" value={formatBytes(movie.file_size)} />}
                  {movie.duration_seconds && (
                    <InfoRow label="Duration" value={formatDuration(movie.duration_seconds)} />
                  )}
                  {movie.width && movie.height && (
                    <InfoRow label="Resolution" value={`${movie.width}×${movie.height}`} />
                  )}
                  <InfoRow label="Added" value={formatDate(movie.added_at)} />
                  {movie.last_accessed && (
                    <InfoRow label="Last Accessed" value={formatDate(movie.last_accessed)} />
                  )}
                  {history && history.play_count > 0 && (
                    <InfoRow label="Played" value={`${history.play_count} times`} />
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

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <span className="min-w-[80px] text-xs text-muted-foreground">{label}</span>
      <span className={`text-foreground/90 ${mono ? "break-all font-mono text-xs" : "text-sm"}`}>
        {value}
      </span>
    </div>
  );
}
