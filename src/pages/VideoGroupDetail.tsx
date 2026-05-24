import { useEffect, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { getVideoGroupDetail, VideoGroupWithParts, playMovie, showInFileManager, logger } from "../services/tauri";
import { Play, ArrowLeft, Film, FolderOpen, AlertCircle } from "lucide-react";
import { useNsfwStore } from "../stores/nsfwStore";
import { formatBytes, formatDuration } from "../lib/utils";
import { getCachedThumbnail } from "../lib/thumbnailCache";
import { findPosterAndFanart } from "../lib/imageUtils";
import DetailBackground from "../components/DetailBackground";
import MetadataChips from "../components/MetadataChips";
import CastList from "../components/CastList";
import InteractiveRating from "../components/InteractiveRating";
import { getBackTarget } from "../lib/navigation";

export default function VideoGroupDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { showThumbnails } = useNsfwStore();
  const [groupData, setGroupData] = useState<VideoGroupWithParts | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [posterSrc, setPosterSrc] = useState<string | null>(null);
  const [fanartSrc, setFanartSrc] = useState<string | null>(null);

  useEffect(() => {
    if (id) {
      loadGroupData();
    }
  }, [id]);

  useEffect(() => {
    if (groupData?.parts && groupData.parts.length > 0) {
      loadImagesFromFirstPart(groupData.parts[0].movie.file_path);
    }
  }, [groupData]);

  const loadGroupData = async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const data = await getVideoGroupDetail(parseInt(id!));
      setGroupData(data);
    } catch (error) {
      logger.error("Failed to load video group:", error);
      setLoadError(String(error));
    } finally {
      setLoading(false);
    }
  };

  const loadImagesFromFirstPart = async (firstPartFilePath: string) => {
    const { posterPath, fanartPath } = await findPosterAndFanart(firstPartFilePath);
    if (posterPath) {
      getCachedThumbnail(posterPath, true).then((url) => url && setPosterSrc(url));
    }
    if (fanartPath) {
      getCachedThumbnail(fanartPath, true).then((url) => url && setFanartSrc(url));
    }
  };

  const handlePlay = async (movieId?: number) => {
    if (!groupData) return;
    try {
      const targetId = movieId || groupData.parts[0].movie.id;
      await playMovie(targetId);
    } catch (error) {
      logger.error("Failed to play movie:", error);
    }
  };

  const handleShowInFileManager = async (filePath: string) => {
    try {
      await showInFileManager(filePath);
    } catch (error) {
      logger.error("Failed to show in file manager:", error);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="mx-auto mb-4 h-6 w-6 animate-spin rounded-full border-2 border-white/15 border-t-foreground" />
          <p className="text-sm text-muted-foreground">Loading grouped feature</p>
        </div>
      </div>
    );
  }

  if (!groupData) {
    const backTarget = getBackTarget(location.state, "/");
    const message = loadError
      ? "影片组合信息加载失败，可能已经被删除或从扫描中移除。"
      : "找不到这个影片组合。";
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

  const { group, parts } = groupData;
  const firstPartMovie = parts[0]?.movie;

  // Fallbacks correctly cascade missing group information to the first part's movie metadata
  const displayTitle = group.title;
  const displayYear = group.year || firstPartMovie?.year;
  const displayRating = group.rating !== undefined && group.rating !== null ? group.rating : firstPartMovie?.rating;
  const displayGenres = group.genres || firstPartMovie?.genres;
  const displayPlot = group.plot || firstPartMovie?.plot;
  const displayDirector = group.director || firstPartMovie?.director;
  const displayActors = group.actors || firstPartMovie?.actors;
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
                {showThumbnails && posterSrc ? (
                  <img src={posterSrc} alt={group.title} className="h-full w-full object-cover" />
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
                  {displayTitle}
                </h1>
                {displayYear && <p className="text-base text-muted-foreground">{displayYear}</p>}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => handlePlay()}
                  className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
                >
                  <Play className="h-4 w-4" fill="currentColor" />
                  Play (Part 1)
                </button>
              </div>

              <InteractiveRating rating={displayRating} />

              <MetadataChips title="Genres" items={displayGenres} />

              {displayPlot && (
                <div>
                  <h3 className="mb-2 text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                    Plot
                  </h3>
                  <p className="text-base leading-relaxed text-foreground/90">{displayPlot}</p>
                </div>
              )}

              {displayDirector && (
                <div>
                  <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                    Director
                  </h3>
                  <p className="text-sm text-foreground">{displayDirector}</p>
                </div>
              )}

              <CastList actors={displayActors} />

              <div className="border-t border-white/[0.06] pt-6">
                <h3 className="mb-4 text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                  Parts ({group.part_count})
                </h3>

                <div className="space-y-3">
                  {parts.map((p) => (
                    <div
                      key={p.part.id}
                      className="flex flex-col gap-3 rounded-xl border border-white/[0.06] bg-card p-4"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="rounded border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-xs font-medium text-muted-foreground">
                            Part {p.part.part_number}
                          </span>
                          <span className="text-sm font-medium text-foreground">
                            {p.part.part_title || `Segment ${p.part.part_number}`}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleShowInFileManager(p.movie.file_path)}
                            className="flex h-8 w-8 items-center justify-center rounded-md border border-white/[0.08] bg-transparent text-muted-foreground transition-colors hover:border-white/[0.16] hover:bg-white/[0.04] hover:text-foreground"
                            title="Show in File Manager"
                          >
                            <FolderOpen className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handlePlay(p.movie.id)}
                            className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90"
                          >
                            <Play className="h-3 w-3" fill="currentColor" />
                            Play
                          </button>
                        </div>
                      </div>

                      <div className="flex items-start gap-3">
                        <span className="min-w-[60px] text-xs text-muted-foreground">Path</span>
                        <span className="flex-1 break-all rounded border border-white/[0.06] bg-black/40 p-2 font-mono text-xs text-muted-foreground">
                          {p.movie.file_path}
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
                        {p.movie.file_size && (
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">Size</span>
                            <span className="text-foreground">{formatBytes(p.movie.file_size)}</span>
                          </div>
                        )}
                        {p.movie.duration_seconds && (
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">Duration</span>
                            <span className="text-foreground">
                              {formatDuration(p.movie.duration_seconds)}
                            </span>
                          </div>
                        )}
                        {p.movie.width && p.movie.height && (
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">Resolution</span>
                            <span className="text-foreground">
                              {p.movie.width}×{p.movie.height}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
