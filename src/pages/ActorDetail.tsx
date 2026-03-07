import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Film, User } from "lucide-react";
import { Movie, getMoviesFiltered } from "../services/tauri";
import { readBinaryFile, exists } from "@tauri-apps/api/fs";

export default function ActorDetail() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [movies, setMovies] = useState<Movie[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [posterCache, setPosterCache] = useState<Map<number, string>>(new Map());

  useEffect(() => {
    if (name) {
      loadActorMovies(decodeURIComponent(name));
    }
  }, [name]);

  const loadActorMovies = async (actorName: string) => {
    try {
      setIsLoading(true);
      const actorMovies = await getMoviesFiltered(0, 1000, { actors: actorName });
      setMovies(actorMovies);
      setIsLoading(false);
    } catch (error) {
      console.error("Failed to load actor movies:", error);
      setIsLoading(false);
    }
  };

  const getPosterPath = async (videoPath: string): Promise<string | null> => {
    const dir = videoPath.substring(0, videoPath.lastIndexOf('/'));
    const posterNames = ['poster.jpg', 'poster.png', 'folder.jpg', 'cover.jpg'];
    
    for (const name of posterNames) {
      const posterPath = `${dir}/${name}`;
      if (await exists(posterPath)) {
        return posterPath;
      }
    }
    
    return null;
  };

  const loadPoster = async (movieId: number, videoPath: string) => {
    if (posterCache.has(movieId)) return;
    
    const posterPath = await getPosterPath(videoPath);
    if (posterPath) {
      try {
        const data = await readBinaryFile(posterPath);
        const blob = new Blob([data as BlobPart], { type: 'image/jpeg' });
        const url = URL.createObjectURL(blob);
        setPosterCache(prev => new Map(prev).set(movieId, url));
      } catch (error) {
        console.error("Failed to load poster:", posterPath, error);
      }
    }
  };

  const handleMovieClick = (movieId: number) => {
    navigate(`/movie/${movieId}`);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-950 to-zinc-900 text-white">
      <button
        onClick={() => navigate("/")}
        className="fixed top-6 left-6 flex items-center gap-2 px-4 py-2 bg-zinc-800/80 hover:bg-zinc-700/90 backdrop-blur-md rounded-xl transition-all duration-200 border border-zinc-700/50 shadow-lg z-50"
      >
        <ArrowLeft className="w-5 h-5" />
        Back
      </button>

      <div className="max-w-7xl mx-auto px-6 pt-20 pb-8">
        <div className="mb-8">
          <div className="flex items-center gap-4 mb-2">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-teal-500 to-teal-600 flex items-center justify-center shadow-lg">
              <User className="w-8 h-8 text-white" />
            </div>
            <div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-zinc-100 to-zinc-300 bg-clip-text text-transparent">
                {name ? decodeURIComponent(name) : "Actor"}
              </h1>
              <p className="text-zinc-400 text-lg mt-1">
                {movies.length} {movies.length === 1 ? "movie" : "movies"}
              </p>
            </div>
          </div>
        </div>

        {movies.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-96 text-center">
            <Film className="w-16 h-16 text-zinc-600 mb-4" />
            <p className="text-zinc-400 text-lg">No movies found for this actor</p>
          </div>
        ) : (
          <div className="space-y-3">
            {movies.map((movie) => {
              if (!posterCache.has(movie.id)) {
                loadPoster(movie.id, movie.file_path);
              }
              
              return (
                <div
                  key={movie.id}
                  onClick={() => handleMovieClick(movie.id)}
                  className="flex gap-4 bg-zinc-800/40 hover:bg-zinc-800/60 rounded-xl overflow-hidden cursor-pointer transition-all duration-200 border border-zinc-700/30 hover:border-zinc-700/50 backdrop-blur-sm"
                >
                  <div className="w-24 h-36 flex-shrink-0 bg-zinc-800">
                    {posterCache.get(movie.id) ? (
                      <img
                        src={posterCache.get(movie.id)}
                        alt={movie.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900">
                        <Film className="w-8 h-8 text-zinc-600" />
                      </div>
                    )}
                  </div>
                  
                  <div className="flex-1 py-3 pr-4 flex flex-col justify-center">
                    <h3 className="text-lg font-semibold text-zinc-100 mb-1 line-clamp-1">
                      {movie.title}
                    </h3>
                    <div className="flex items-center gap-3 text-sm text-zinc-400">
                      {movie.year && (
                        <span>{movie.year}</span>
                      )}
                      {movie.rating && (
                        <div className="flex items-center gap-1">
                          <span className="text-teal-400">★</span>
                          <span>{movie.rating.toFixed(1)}</span>
                        </div>
                      )}
                      {movie.duration_seconds && (
                        <span>
                          {Math.floor(movie.duration_seconds / 60)} min
                        </span>
                      )}
                    </div>
                    {movie.plot && (
                      <p className="text-sm text-zinc-400 mt-2 line-clamp-2">
                        {movie.plot}
                      </p>
                    )}
                    {movie.genres && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {movie.genres.split(",").slice(0, 3).map((genre, index) => (
                          <span
                            key={index}
                            className="px-2 py-0.5 bg-zinc-700/50 rounded text-xs text-zinc-300"
                          >
                            {genre.trim()}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
