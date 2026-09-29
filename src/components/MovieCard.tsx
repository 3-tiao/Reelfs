import { memo, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Movie } from "../services/tauri";
import { Film, Eye, Layers, Play } from "lucide-react";
import { useNsfwStore } from "../stores/nsfwStore";
import { useMovieStore } from "../stores/movieStore";
import { acquireThumbnail, releaseThumbnail } from "../lib/thumbnailCache";
import { enqueueThumbnailGen } from "../lib/thumbnailGenQueue";
import { getRouteState } from "../lib/navigation";
import { getSearchSecondaryText } from "../lib/search";
import HighlightedText from "./HighlightedText";

interface MovieCardProps {
  movie: Movie;
}

function MovieCard({ movie }: MovieCardProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { showThumbnails } = useNsfwStore();
  const searchQuery = useMovieStore((state) => state.searchQuery);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const searchSecondaryText = searchQuery ? getSearchSecondaryText(movie, searchQuery) : null;
  const routeState = getRouteState(location);

  useEffect(() => {
    if (!showThumbnails) {
      setImageSrc(null);
      return;
    }

    let isMounted = true;
    // Path whose Blob URL this card is currently rendering; the pin is released
    // on unmount so the LRU is free to evict it.
    let pinnedPath: string | null = null;

    const pin = (path: string) => {
      if (isMounted) {
        pinnedPath = path;
      } else {
        releaseThumbnail(path);
      }
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          loadThumbnail(() => isMounted, pin);
          observer.disconnect();
        }
      },
      { rootMargin: "100px" }
    );

    if (cardRef.current) {
      observer.observe(cardRef.current);
    }

    return () => {
      isMounted = false;
      observer.disconnect();
      if (pinnedPath) {
        releaseThumbnail(pinnedPath);
      }
    };
  }, [movie, showThumbnails]);

  const loadThumbnail = async (checkMounted: () => boolean, pin: (path: string) => void) => {
    if (movie.thumbnail_path) {
      const path = movie.thumbnail_path;
      const url = await acquireThumbnail(path);
      if (url) {
        pin(path);
        if (checkMounted()) {
          setImageSrc(url);
        }
        return;
      }

      if (!checkMounted()) {
        return;
      }

      enqueueThumbnailGen(movie.id, (generatedUrl, generatedPath) => {
        pin(generatedPath);
        if (checkMounted()) {
          setImageSrc(generatedUrl);
        }
      });
    } else {
      enqueueThumbnailGen(movie.id, (url, generatedPath) => {
        pin(generatedPath);
        if (checkMounted()) {
          setImageSrc(url);
        }
      });
    }
  };

  return (
    <div
      ref={cardRef}
      onClick={() => movie.group_id ? navigate(`/video-group/${movie.group_id}`, { state: routeState }) : navigate(`/movie/${movie.id}`, { state: routeState })}
      className="group cursor-pointer"
    >
      <div className="relative aspect-[2/3] overflow-hidden rounded-xl border border-white/[0.06] bg-card transition-colors duration-200 group-hover:border-white/[0.14]">
        {imageSrc ? (
          <img
            src={imageSrc}
            alt={movie.title}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Film className="h-12 w-12 text-white/15" />
          </div>
        )}

        <div className="pointer-events-none absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/95 via-black/40 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <div className="p-4">
            {movie.rating && (
              <div className="mb-1.5 flex items-center gap-1 text-sm font-medium text-white">
                <span className="text-foreground">★</span>
                <span>{movie.rating.toFixed(1)}</span>
              </div>
            )}
            {movie.plot && (
              <p className="mb-3 line-clamp-3 text-xs leading-relaxed text-white/80">
                <HighlightedText
                  text={movie.plot}
                  query={searchQuery}
                  highlightClassName="bg-white/15 text-white rounded px-0.5"
                />
              </p>
            )}
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-black">
                <Play className="ml-0.5 h-3.5 w-3.5" fill="currentColor" />
              </div>
              Play
            </div>
          </div>
        </div>

        {movie.is_watched === 1 && (
          <div className="absolute right-2 top-2 rounded-full bg-black/60 p-1 ring-1 ring-white/[0.1] backdrop-blur-sm">
            <Eye className="h-3.5 w-3.5 text-white" />
          </div>
        )}

        {movie.group_id && (
          <div
            className="absolute left-2 top-2 cursor-pointer rounded-full bg-black/60 p-1 ring-1 ring-white/[0.1] backdrop-blur-sm"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/video-group/${movie.group_id}`, { state: routeState });
            }}
          >
            <Layers className="h-3.5 w-3.5 text-white" />
          </div>
        )}
      </div>

      <div className="mt-2 px-1">
        <h3 className="truncate text-sm font-medium text-foreground">
          <HighlightedText text={movie.title} query={searchQuery} />
        </h3>
        {searchSecondaryText ? (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            <HighlightedText
              text={searchSecondaryText}
              query={searchQuery}
              highlightClassName="bg-white/10 text-foreground rounded px-0.5"
            />
          </p>
        ) : movie.year && (
          <p className="text-xs text-muted-foreground">{movie.year}</p>
        )}
      </div>
    </div>
  );
}

export default memo(MovieCard);
