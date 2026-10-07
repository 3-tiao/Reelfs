import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { AlertCircle, ArrowLeft, Film, User } from "lucide-react";
import { Movie, getMoviesFiltered, logger } from "../services/tauri";
import { findFirstExisting } from "../lib/imageUtils";
import { thumbnailUrl } from "../lib/thumbnailCache";
import { useScrollRestoration } from "../hooks/useScrollRestoration";
import { getBackTarget, getRouteState } from "../lib/navigation";

export default function ActorDetail() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [movies, setMovies] = useState<Movie[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Distinguishes "this actor has no movies" from "the query failed" —
  // swallowing the error used to render an empty state for both.
  const [loadError, setLoadError] = useState<string | null>(null);
  // movie.id → asset:// URL of the folder poster, rendered by this page.
  const [posterUrls, setPosterUrls] = useState<Map<number, string>>(new Map());
  // Guards against re-triggering a poster load while one is in flight.
  const loadingIdsRef = useRef<Set<number>>(new Set());
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      loadingIdsRef.current.clear();
    };
  }, []);

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
    setIsLoading(true);
    setLoadError(null);
    try {
      const actorMovies = await getMoviesFiltered(0, 1000, { actors: actorName });
      setMovies(actorMovies);
      setIsLoading(false);
    } catch (error) {
      logger.error("Failed to load actor movies:", error);
      setMovies([]);
      setLoadError(String(error));
      setIsLoading(false);
    }
  };

  const loadPoster = (movieId: number, videoPath: string) => {
    if (posterUrls.has(movieId) || loadingIdsRef.current.has(movieId)) return;

    loadingIdsRef.current.add(movieId);
    const dir = videoPath.substring(0, videoPath.lastIndexOf('/'));
    const posterNames = ['poster.jpg', 'poster.png', 'folder.jpg', 'cover.jpg', 'fanart.jpg', 'fanart.png'];

    findFirstExisting(posterNames.map((name) => `${dir}/${name}`))
      .then((posterPath) => {
        // findFirstExisting verified the file exists; hand out its asset URL
        // directly instead of routing it through the old Blob cache.
        if (!posterPath || !isMountedRef.current) return;
        setPosterUrls((prev) => new Map(prev).set(movieId, thumbnailUrl(posterPath)));
      })
      .catch((error) => {
        logger.error("Failed to load poster:", videoPath, error);
      })
      .finally(() => {
        loadingIdsRef.current.delete(movieId);
      });
  };

  // Kick off poster lookups from an effect, not from the render body —
  // loadPoster ends in a setState, so calling it per row during render was a
  // render-phase side effect.
  useEffect(() => {
    for (const movie of movies) {
      loadPoster(movie.id, movie.file_path);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movies]);

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

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="w-full max-w-md rounded-2xl border border-white/[0.06] bg-card p-8 text-center">
          <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-destructive/15 text-destructive">
            <AlertCircle className="h-5 w-5" />
          </div>
          <p className="text-sm font-medium text-foreground">
            该演员的影片列表加载失败。
          </p>
          <p className="mt-2 break-all text-xs text-muted-foreground">{loadError}</p>
          <div className="mt-6 flex items-center justify-center gap-2">
            <button
              onClick={() => name && loadActorMovies(decodeURIComponent(name))}
              className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-white/[0.16] hover:bg-white/[0.08]"
            >
              重试
            </button>
            <button
              onClick={() => navigate(getBackTarget(location.state, "/"))}
              className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-white/[0.16] hover:bg-white/[0.08]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              返回上一页
            </button>
          </div>
        </div>
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
            {movies.map((movie) => (
              <div
                key={movie.id}
                onClick={() => handleMovieClick(movie.id)}
                className="group flex cursor-pointer gap-4 overflow-hidden rounded-xl border border-white/[0.06] bg-card transition-colors hover:border-white/[0.12]"
              >
                  <div className="h-36 w-24 flex-shrink-0 bg-black/40">
                    {posterUrls.get(movie.id) ? (
                      <img
                        src={posterUrls.get(movie.id)}
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
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
