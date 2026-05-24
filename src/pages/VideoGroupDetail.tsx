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
      <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top_left,rgba(20,184,166,0.12),transparent_18%),linear-gradient(180deg,#09090b,#0a0f10)]">
        <div className="text-center">
          <div className="mx-auto mb-5 h-14 w-14 animate-spin rounded-full border-2 border-teal-300/20 border-t-teal-300"></div>
          <p className="text-base font-medium text-zinc-200">Loading grouped feature</p>
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
                {showThumbnails && posterSrc ? (
                  <img
                    src={posterSrc}
                    alt={group.title}
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
                <h1 className="text-4xl lg:text-5xl font-bold mb-3 bg-gradient-to-r from-zinc-100 to-zinc-300 bg-clip-text text-transparent flex items-center gap-4">
                  {displayTitle}
                </h1>
                {displayYear && (
                  <p className="text-zinc-400 text-lg">{displayYear}</p>
                )}
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => handlePlay()}
                  className="flex items-center gap-3 rounded-2xl bg-gradient-to-r from-teal-400 to-emerald-400 px-6 py-4 font-semibold text-zinc-950 shadow-[0_18px_42px_rgba(20,184,166,0.28)] transition-transform duration-200 hover:-translate-y-0.5"
                >
                  <Play className="w-6 h-6" fill="currentColor" />
                  Play (Part 1)
                </button>
              </div>

              <InteractiveRating rating={displayRating} />

              <MetadataChips title="Genres" items={displayGenres} />

              {displayPlot && (
                <div>
                  <h3 className="text-zinc-400 text-sm uppercase tracking-wider mb-3 font-medium">Plot</h3>
                  <p className="text-zinc-200 leading-relaxed text-lg">{displayPlot}</p>
                </div>
              )}

              {displayDirector && (
                <div>
                  <h3 className="text-zinc-400 text-sm uppercase tracking-wider mb-2 font-medium">Director</h3>
                  <p className="text-zinc-100 text-lg">{displayDirector}</p>
                </div>
              )}

              <CastList actors={displayActors} />

              <div className="pt-6 border-t border-zinc-800/50">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-zinc-400 text-sm uppercase tracking-wider font-medium">Parts ({group.part_count})</h3>
                </div>

                <div className="space-y-4">
                  {parts.map((p) => (
                    <div key={p.part.id} className="bg-zinc-800/30 rounded-xl p-4 border border-zinc-700/30 flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="bg-zinc-700/50 text-zinc-300 px-3 py-1 rounded-lg text-sm font-medium">
                            Part {p.part.part_number}
                          </span>
                          <span className="text-white font-medium">
                            {p.part.part_title || `Segment ${p.part.part_number}`}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleShowInFileManager(p.movie.file_path)}
                            className="rounded-2xl border border-white/10 bg-white/[0.04] p-2.5 text-zinc-400 transition-colors hover:bg-white/[0.08] hover:text-white"
                            title="Show in File Manager"
                          >
                            <FolderOpen className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handlePlay(p.movie.id)}
                            className="flex items-center gap-2 rounded-2xl bg-white text-zinc-950 px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-teal-300"
                          >
                            <Play className="w-4 h-4" fill="currentColor" />
                            Play
                          </button>
                        </div>
                      </div>
                      
                      <div className="flex items-start gap-3 mt-1">
                        <span className="text-zinc-500 min-w-[60px] text-sm">Path:</span>
                        <span className="text-zinc-300 font-mono text-xs break-all bg-zinc-900/50 p-2 rounded flex-1">
                          {p.movie.file_path}
                        </span>
                      </div>
                      
                      <div className="flex flex-wrap gap-6 text-sm mt-1">
                        {p.movie.file_size && (
                          <div className="flex items-center gap-2">
                            <span className="text-zinc-500">Size:</span>
                            <span className="text-zinc-300 font-medium">
                              {formatBytes(p.movie.file_size)}
                            </span>
                          </div>
                        )}
                        {p.movie.duration_seconds && (
                          <div className="flex items-center gap-2">
                            <span className="text-zinc-500">Duration:</span>
                            <span className="text-zinc-300 font-medium">
                              {formatDuration(p.movie.duration_seconds)}
                            </span>
                          </div>
                        )}
                        {p.movie.width && p.movie.height && (
                          <div className="flex items-center gap-2">
                            <span className="text-zinc-500">Resolution:</span>
                            <span className="text-zinc-300 font-medium">
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
