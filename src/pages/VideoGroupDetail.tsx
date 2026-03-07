import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getVideoGroupDetail, VideoGroupWithParts, playMovie, showInFileManager } from "../services/tauri";
import { Play, ArrowLeft, Star, Film, FolderOpen } from "lucide-react";
import { useNsfwStore } from "../stores/nsfwStore";
import { readBinaryFile, exists } from "@tauri-apps/api/fs";

const formatDuration = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else {
    return `${minutes}m`;
  }
};

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

export default function VideoGroupDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showThumbnails } = useNsfwStore();
  const [groupData, setGroupData] = useState<VideoGroupWithParts | null>(null);
  const [loading, setLoading] = useState(true);
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
      const data = await getVideoGroupDetail(parseInt(id!));
      setGroupData(data);
    } catch (error) {
      console.error("Failed to load video group:", error);
    } finally {
      setLoading(false);
    }
  };

  const getPosterPath = async (videoPath: string): Promise<string | null> => {
    const dir = videoPath.substring(0, videoPath.lastIndexOf('/'));
    const posterNames = ['poster.jpg', 'poster.png', 'folder.jpg', 'cover.jpg', 'fanart.jpg', 'fanart.png'];
    for (const name of posterNames) {
      const posterPath = `${dir}/${name}`;
      if (await exists(posterPath)) {
        return posterPath;
      }
    }
    return null;
  };

  const getFanartPath = async (videoPath: string): Promise<string | null> => {
    const dir = videoPath.substring(0, videoPath.lastIndexOf('/'));
    const fanartNames = ['fanart.jpg', 'fanart.png', 'backdrop.jpg', 'background.jpg'];
    for (const name of fanartNames) {
      const fanartPath = `${dir}/${name}`;
      if (await exists(fanartPath)) {
        return fanartPath;
      }
    }
    return null;
  };

  const loadImage = async (path: string, setter: (src: string | null) => void) => {
    try {
      const data = await readBinaryFile(path);
      const blob = new Blob([data as BlobPart], { type: 'image/jpeg' });
      const url = URL.createObjectURL(blob);
      setter(url);
    } catch (error) {
      console.error("Failed to load image:", path, error);
      setter(null);
    }
  };

  const loadImagesFromFirstPart = async (firstPartFilePath: string) => {
    const posterPath = await getPosterPath(firstPartFilePath);
    if (posterPath) {
      loadImage(posterPath, setPosterSrc);
    }
    const fanartPath = await getFanartPath(firstPartFilePath);
    if (fanartPath) {
      loadImage(fanartPath, setFanartSrc);
    }
  };

  const handlePlay = async (movieId?: number) => {
    if (!groupData) return;
    try {
      const targetId = movieId || groupData.parts[0].movie.id;
      await playMovie(targetId);
    } catch (error) {
      console.error("Failed to play movie:", error);
    }
  };

  const handleShowInFileManager = async (filePath: string) => {
    try {
      await showInFileManager(filePath);
    } catch (error) {
      console.error("Failed to show in file manager:", error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!groupData) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-400">Video group not found</p>
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
      {/* Background */}
      {fanartSrc && (
        <div className="absolute inset-0 z-0 overflow-hidden">
          <img
            src={fanartSrc}
            alt=""
            className="w-full h-full object-cover opacity-30 scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-zinc-900/60 via-zinc-950/85 to-zinc-950"></div>
        </div>
      )}

      {/* Content */}
      <div className="relative z-10">
        <button
          onClick={() => navigate("/")}
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

            {/* Info */}
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
                  className="flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-400 hover:to-teal-500 rounded-xl font-semibold text-lg transition-all duration-200 shadow-lg shadow-teal-500/25 hover:shadow-teal-500/40"
                >
                  <Play className="w-6 h-6" fill="currentColor" />
                  Play (Part 1)
                </button>
              </div>

              {displayRating !== undefined && displayRating !== null && (
                <div>
                  <h3 className="text-zinc-400 text-sm uppercase tracking-wider mb-3 font-medium">Rating</h3>
                  <div className="flex items-center gap-1">
                    <div className="flex items-center gap-1 text-teal-400">
                      <Star className="w-5 h-5" fill="currentColor" />
                      <span className="font-medium text-lg ml-1">{displayRating.toFixed(1)}</span>
                    </div>
                  </div>
                </div>
              )}

              {displayGenres && (
                <div>
                  <h3 className="text-zinc-400 text-sm uppercase tracking-wider mb-3 font-medium">Genres</h3>
                  <div className="flex flex-wrap gap-2">
                    {displayGenres.split(",").map((genre, i) => (
                      <span
                        key={i}
                        className="px-4 py-1.5 bg-zinc-800/60 border border-zinc-700/50 rounded-lg text-sm text-zinc-200"
                      >
                        {genre.trim()}
                      </span>
                    ))}
                  </div>
                </div>
              )}

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

              {displayActors && (
                <div>
                  <h3 className="text-zinc-400 text-sm uppercase tracking-wider mb-2 font-medium">Cast</h3>
                  <div className="flex flex-wrap gap-2">
                    {displayActors.split(",").map((actor, i) => (
                      <button
                        key={i}
                        onClick={() => navigate(`/actor/${encodeURIComponent(actor.trim())}`)}
                        className="px-3 py-1 bg-zinc-800/60 hover:bg-teal-600/30 border border-zinc-700/50 hover:border-teal-500/50 rounded-lg text-sm text-zinc-200 hover:text-teal-300 transition-all duration-200"
                      >
                        {actor.trim()}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Parts Information */}
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
                            className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-700/80 rounded-lg transition-colors"
                            title="Show in File Manager"
                          >
                            <FolderOpen className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handlePlay(p.movie.id)}
                            className="flex items-center gap-2 px-4 py-2 bg-zinc-700/80 hover:bg-teal-600/80 text-white rounded-lg transition-colors text-sm font-medium"
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
