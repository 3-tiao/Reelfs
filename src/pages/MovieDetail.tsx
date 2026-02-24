import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Play, Film, FolderOpen, Star } from "lucide-react";
import { Movie, PlayHistory, getMovieDetail, playMovie, showInFileManager, setMovieRating } from "../services/tauri";
import { readBinaryFile } from "@tauri-apps/api/fs";

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

      if (movieData.poster_path) {
        await loadImage(movieData.poster_path, setPosterSrc);
      }
      if (movieData.fanart_path) {
        await loadImage(movieData.fanart_path, setFanartSrc);
      }
    } catch (error) {
      console.error("Failed to load movie details:", error);
    } finally {
      setIsLoading(false);
    }
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

  const handlePlay = async () => {
    if (movie) {
      try {
        await playMovie(movie.id);
      } catch (error) {
        console.error("Failed to play movie:", error);
      }
    }
  };

  const handleShowInFileManager = async () => {
    if (movie) {
      try {
        await showInFileManager(movie.file_path);
      } catch (error) {
        console.error("Failed to show in file manager:", error);
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
      console.error("Failed to set rating:", error);
    } finally {
      setIsRating(false);
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
    <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-950 to-gray-950 text-white">
      {/* Background */}
      {fanartSrc && (
        <div className="absolute inset-0 z-0 overflow-hidden">
          <img
            src={fanartSrc}
            alt=""
            className="w-full h-full object-cover opacity-30 scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-gray-900/60 via-gray-950/85 to-gray-950"></div>
        </div>
      )}

      {/* Content */}
      <div className="relative z-10">
        <button
          onClick={() => navigate("/")}
          className="fixed top-6 left-6 flex items-center gap-2 px-4 py-2 bg-gray-800/80 hover:bg-gray-700/90 backdrop-blur-md rounded-xl transition-all duration-200 border border-gray-700/50 shadow-lg z-50"
        >
          <ArrowLeft className="w-5 h-5" />
          Back
        </button>

        <div className="max-w-7xl mx-auto px-6 pt-20 pb-8">
          <div className="flex flex-col lg:flex-row gap-10">
            {/* Poster */}
            <div className="flex-shrink-0 mx-auto lg:mx-0">
              <div className="w-72 aspect-[2/3] bg-gray-800/50 rounded-2xl overflow-hidden shadow-2xl border border-gray-700/50 backdrop-blur-sm">
                {posterSrc ? (
                  <img
                    src={posterSrc}
                    alt={movie.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-800 to-gray-900">
                    <Film className="w-20 h-20 text-gray-600" />
                  </div>
                )}
              </div>
            </div>

            {/* Info */}
            <div className="flex-1 space-y-6">
              <div>
                <h1 className="text-4xl lg:text-5xl font-bold mb-3 bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                  {movie.title}
                </h1>
                {movie.year && (
                  <p className="text-gray-400 text-lg">{movie.year}</p>
                )}
              </div>

              {movie.rating === undefined || movie.rating === null ? (
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((value) => (
                      <button
                        key={value}
                        onClick={() => handleRating(value)}
                        disabled={isRating}
                        className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all duration-200 ${
                          isRating
                            ? 'bg-gray-700 cursor-not-allowed'
                            : 'bg-gray-800 hover:bg-yellow-600 hover:scale-110'
                        }`}
                      >
                        <Star
                          className={`w-5 h-5 ${
                            isRating ? 'text-gray-500' : 'text-gray-400'
                          }`}
                          fill={isRating ? 'none' : 'currentColor'}
                        />
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => handleRating(null)}
                    disabled={isRating}
                    className={`px-3 py-1.5 text-sm rounded-lg transition-all duration-200 ${
                      isRating
                        ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                        : 'bg-gray-800 text-gray-400 hover:bg-red-600 hover:text-white'
                    }`}
                  >
                    清除
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((value) => (
                      <button
                        key={value}
                        onClick={() => handleRating(value)}
                        disabled={isRating}
                        className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all duration-200 ${
                          isRating
                            ? 'bg-gray-700 cursor-not-allowed'
                            : value <= Math.round(movie.rating!)
                            ? 'bg-yellow-600 hover:bg-yellow-500 hover:scale-110'
                            : 'bg-gray-800 hover:bg-yellow-600 hover:scale-110'
                        }`}
                      >
                        <Star
                          className={`w-5 h-5 ${
                            isRating ? 'text-gray-500' : value <= Math.round(movie.rating!) ? 'text-white' : 'text-gray-400'
                          }`}
                          fill={isRating ? 'none' : value <= Math.round(movie.rating!) ? 'currentColor' : 'none'}
                        />
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => handleRating(null)}
                    disabled={isRating}
                    className={`px-3 py-1.5 text-sm rounded-lg transition-all duration-200 ${
                      isRating
                        ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                        : 'bg-gray-800 text-gray-400 hover:bg-red-600 hover:text-white'
                    }`}
                  >
                    清除
                  </button>
                </div>
              )}

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handlePlay}
                  className="flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 rounded-xl font-semibold text-lg transition-all duration-200 shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40"
                >
                  <Play className="w-6 h-6" fill="currentColor" />
                  {history && history.last_position > 0
                    ? `Continue Playing (${Math.floor(history.last_position / 60)}m)`
                    : "Play"}
                </button>
              </div>

              {movie.genres && (
                <div>
                  <h3 className="text-gray-400 text-sm uppercase tracking-wider mb-3 font-medium">Genres</h3>
                  <div className="flex flex-wrap gap-2">
                    {movie.genres.split(",").map((genre, index) => (
                      <span
                        key={index}
                        className="px-4 py-1.5 bg-gray-800/60 border border-gray-700/50 rounded-lg text-sm text-gray-200"
                      >
                        {genre.trim()}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {movie.plot && (
                <div>
                  <h3 className="text-gray-400 text-sm uppercase tracking-wider mb-3 font-medium">Plot</h3>
                  <p className="text-gray-200 leading-relaxed text-lg">{movie.plot}</p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {movie.director && (
                  <div>
                    <h3 className="text-gray-400 text-sm uppercase tracking-wider mb-2 font-medium">Director</h3>
                    <p className="text-white text-lg">{movie.director}</p>
                  </div>
                )}

                {movie.actors && (
                  <div>
                    <h3 className="text-gray-400 text-sm uppercase tracking-wider mb-2 font-medium">Cast</h3>
                    <p className="text-white text-lg">{movie.actors}</p>
                  </div>
                )}
              </div>

              <div className="pt-6 border-t border-gray-800/50">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-gray-400 text-sm uppercase tracking-wider font-medium">File Info</h3>
                  <button
                    onClick={handleShowInFileManager}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-800/60 hover:bg-gray-700/80 backdrop-blur-sm rounded-lg font-medium text-sm transition-all duration-200 border border-gray-700/50"
                  >
                    <FolderOpen className="w-4 h-4" />
                    Show in File Manager
                  </button>
                </div>
                <div className="space-y-3 text-sm bg-gray-800/30 rounded-xl p-4 border border-gray-700/30">
                  <div className="flex items-start gap-3">
                    <span className="text-gray-500 min-w-[60px]">Path:</span>
                    <span className="text-gray-300 font-mono text-xs break-all">{movie.file_path}</span>
                  </div>
                  {movie.file_size && (
                    <div className="flex items-center gap-3">
                      <span className="text-gray-500 min-w-[60px]">Size:</span>
                      <span className="text-gray-300 font-medium">
                        {(movie.file_size / 1024 / 1024 / 1024).toFixed(2)} GB
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
