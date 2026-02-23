import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Play, Film } from "lucide-react";
import { Movie, PlayHistory, getMovieDetail, playMovie } from "../services/tauri";
import { convertFileSrc } from "@tauri-apps/api/tauri";

export default function MovieDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [movie, setMovie] = useState<Movie | null>(null);
  const [history, setHistory] = useState<PlayHistory | null>(null);
  const [isLoading, setIsLoading] = useState(true);

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
    } catch (error) {
      console.error("Failed to load movie details:", error);
    } finally {
      setIsLoading(false);
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

  const posterSrc = movie.poster_path ? convertFileSrc(movie.poster_path) : null;
  const fanartSrc = movie.fanart_path ? convertFileSrc(movie.fanart_path) : null;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Background */}
      {fanartSrc && (
        <div className="absolute inset-0 z-0">
          <img
            src={fanartSrc}
            alt=""
            className="w-full h-full object-cover opacity-20 blur-2xl"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-gray-950/50 via-gray-950/80 to-gray-950"></div>
        </div>
      )}

      {/* Content */}
      <div className="relative z-10">
        <button
          onClick={() => navigate("/")}
          className="m-6 flex items-center gap-2 px-4 py-2 bg-gray-800/80 hover:bg-gray-700 rounded-lg transition-colors backdrop-blur-sm"
        >
          <ArrowLeft className="w-5 h-5" />
          Back
        </button>

        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex flex-col md:flex-row gap-8">
            {/* Poster */}
            <div className="flex-shrink-0">
              <div className="w-80 aspect-[2/3] bg-gray-800 rounded-lg overflow-hidden shadow-2xl">
                {posterSrc ? (
                  <img
                    src={posterSrc}
                    alt={movie.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Film className="w-24 h-24 text-gray-600" />
                  </div>
                )}
              </div>
            </div>

            {/* Info */}
            <div className="flex-1">
              <h1 className="text-4xl font-bold mb-2">{movie.title}</h1>
              {movie.year && (
                <p className="text-gray-400 text-lg mb-4">{movie.year}</p>
              )}

              {movie.rating && (
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-yellow-400 text-2xl">⭐</span>
                  <span className="text-2xl font-semibold">{movie.rating.toFixed(1)}</span>
                </div>
              )}

              <button
                onClick={handlePlay}
                className="flex items-center gap-3 px-8 py-4 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold text-lg transition-colors mb-6"
              >
                <Play className="w-6 h-6" fill="currentColor" />
                {history && history.last_position > 0
                  ? `Continue Playing (${Math.floor(history.last_position / 60)}m)`
                  : "Play"}
              </button>

              {movie.genres && (
                <div className="mb-6">
                  <h3 className="text-gray-400 text-sm uppercase tracking-wide mb-2">Genres</h3>
                  <div className="flex flex-wrap gap-2">
                    {movie.genres.split(",").map((genre, index) => (
                      <span
                        key={index}
                        className="px-3 py-1 bg-gray-800 rounded-full text-sm"
                      >
                        {genre.trim()}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {movie.plot && (
                <div className="mb-6">
                  <h3 className="text-gray-400 text-sm uppercase tracking-wide mb-2">Plot</h3>
                  <p className="text-gray-200 leading-relaxed">{movie.plot}</p>
                </div>
              )}

              {movie.director && (
                <div className="mb-4">
                  <h3 className="text-gray-400 text-sm uppercase tracking-wide mb-1">Director</h3>
                  <p className="text-white">{movie.director}</p>
                </div>
              )}

              {movie.actors && (
                <div className="mb-4">
                  <h3 className="text-gray-400 text-sm uppercase tracking-wide mb-1">Cast</h3>
                  <p className="text-white">{movie.actors}</p>
                </div>
              )}

              <div className="mt-8 pt-6 border-t border-gray-800">
                <h3 className="text-gray-400 text-sm uppercase tracking-wide mb-3">File Info</h3>
                <div className="space-y-2 text-sm">
                  <p className="text-gray-400">
                    <span className="text-gray-500">Path:</span> {movie.file_path}
                  </p>
                  {movie.file_size && (
                    <p className="text-gray-400">
                      <span className="text-gray-500">Size:</span>{" "}
                      {(movie.file_size / 1024 / 1024 / 1024).toFixed(2)} GB
                    </p>
                  )}
                  {history && history.play_count > 0 && (
                    <p className="text-gray-400">
                      <span className="text-gray-500">Played:</span> {history.play_count} times
                    </p>
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
