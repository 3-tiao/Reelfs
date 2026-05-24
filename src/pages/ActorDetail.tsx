import { useEffect, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft, Film, User } from "lucide-react";
import { Movie, getMoviesFiltered, logger } from "../services/tauri";
import { readBinaryFile, exists } from "@tauri-apps/api/fs";
import { useScrollRestoration } from "../hooks/useScrollRestoration";
import { getBackTarget, getRouteState } from "../lib/navigation";

export default function ActorDetail() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [movies, setMovies] = useState<Movie[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [posterCache, setPosterCache] = useState<Map<number, string>>(new Map());

  const { handleScroll } = useScrollRestoration({
    storageKey: name ? `actor:${name}` : "actor:unknown",
    itemCount: movies.length,
    getController: () => {
      if (typeof window === "undefined") {
        return null;
      }

      return {
        getScrollPosition: () => window.scrollY,
        getScrollPercentage: () => {
          const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
          if (scrollHeight <= 0) {
            return 0;
          }

          return Math.min(100, (window.scrollY / scrollHeight) * 100);
        },
        scrollToPosition: (scrollTop: number) => {
          window.scrollTo(0, scrollTop);
        },
        scrollToPercentage: (percentage: number) => {
          const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
          const targetScrollTop = scrollHeight * (percentage / 100);
          window.scrollTo(0, targetScrollTop);
        },
      };
    },
  });

  // 保存滚动位置
  useEffect(() => {
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

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
      logger.error("Failed to load actor movies:", error);
      setIsLoading(false);
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
        logger.error("Failed to load poster:", posterPath, error);
      }
    }
  };

  const handleMovieClick = (movieId: number) => {
    navigate(`/movie/${movieId}`, { state: getRouteState(location) });
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/15 border-t-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <button
        onClick={() => navigate(getBackTarget(location.state, "/"))}
        className="fixed left-6 top-6 z-50 inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-background/80 px-3 py-1.5 text-sm font-medium text-foreground backdrop-blur-xl transition-colors hover:border-white/[0.16] hover:bg-white/[0.04]"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <div className="mx-auto max-w-7xl px-6 pb-12 pt-20">
        <div className="mb-8 flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/[0.08] bg-card">
            <User className="h-7 w-7 text-foreground" />
          </div>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              {name ? decodeURIComponent(name) : "Actor"}
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {movies.length} {movies.length === 1 ? "movie" : "movies"}
            </p>
          </div>
        </div>

        {movies.length === 0 ? (
          <div className="flex h-96 flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] text-center">
            <Film className="mb-3 h-10 w-10 text-white/15" />
            <p className="text-sm text-muted-foreground">No movies found for this actor</p>
          </div>
        ) : (
          <div className="space-y-2">
            {movies.map((movie) => {
              if (!posterCache.has(movie.id)) {
                loadPoster(movie.id, movie.file_path);
              }

              return (
                <div
                  key={movie.id}
                  onClick={() => handleMovieClick(movie.id)}
                  className="group flex cursor-pointer gap-4 overflow-hidden rounded-xl border border-white/[0.06] bg-card transition-colors hover:border-white/[0.12]"
                >
                  <div className="h-36 w-24 flex-shrink-0 bg-black/40">
                    {posterCache.get(movie.id) ? (
                      <img
                        src={posterCache.get(movie.id)}
                        alt={movie.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <Film className="h-7 w-7 text-white/15" />
                      </div>
                    )}
                  </div>

                  <div className="flex flex-1 flex-col justify-center py-3 pr-4">
                    <h3 className="line-clamp-1 text-base font-medium text-foreground">
                      {movie.title}
                    </h3>
                    <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                      {movie.year && <span>{movie.year}</span>}
                      {movie.rating && (
                        <div className="flex items-center gap-1 text-foreground">
                          <span>★</span>
                          <span className="tabular-nums">{movie.rating.toFixed(1)}</span>
                        </div>
                      )}
                      {movie.duration_seconds && (
                        <span>{Math.floor(movie.duration_seconds / 60)} min</span>
                      )}
                    </div>
                    {movie.plot && (
                      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                        {movie.plot}
                      </p>
                    )}
                    {movie.genres && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {movie.genres.split(",").slice(0, 3).map((genre, index) => (
                          <span
                            key={index}
                            className="rounded border border-white/[0.06] bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-muted-foreground"
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
