import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Movie } from "../services/tauri";
import { Film, Eye, Layers } from "lucide-react";
import { useNsfwStore } from "../stores/nsfwStore";
import { useMovieStore } from "../stores/movieStore";
import { getCachedThumbnail } from "../lib/thumbnailCache";
import { enqueueThumbnailGen } from "../lib/thumbnailGenQueue";
import { getRouteState } from "../lib/navigation";
import { getSearchSecondaryText } from "../lib/search";
import HighlightedText from "./HighlightedText";

interface MovieCardProps {
  movie: Movie;
}

export default function MovieCard({ movie }: MovieCardProps) {
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

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          loadThumbnail(() => isMounted);
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
    };
  }, [movie, showThumbnails]);

  const loadThumbnail = async (checkMounted: () => boolean) => {
    if (movie.thumbnail_path) {
      // Thumbnail file already exists — load from cache or read from disk
      const url = await getCachedThumbnail(movie.thumbnail_path);
      if (url) {
        if (checkMounted()) {
          setImageSrc(url);
        }
        return;
      }

      if (!checkMounted()) {
        return;
      }

      enqueueThumbnailGen(movie.id, (generatedUrl) => {
        if (checkMounted()) {
          setImageSrc(generatedUrl);
        }
      });
    } else {
      // No thumbnail yet — enqueue background generation via Rust
      enqueueThumbnailGen(movie.id, (url) => {
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
      className="group cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:-translate-y-1"
    >
      <div className="relative aspect-[2/3] bg-zinc-800/80 backdrop-blur-sm rounded-xl overflow-hidden shadow-lg hover:shadow-2xl hover:shadow-teal-500/10 border border-zinc-700/50 group-hover:border-teal-500/30 transition-all duration-300">
        {imageSrc ? (
          <img
            src={imageSrc}
            alt={movie.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Film className="w-16 h-16 text-zinc-600" />
          </div>
        )}
        
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/90 via-zinc-900/40 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300 flex flex-col justify-end">
          <div className="p-4 transform translate-y-4 group-hover:translate-y-0 transition-transform duration-300">
            {movie.rating && (
              <div className="text-teal-400 text-sm font-semibold mb-1.5 flex items-center gap-1">
                ⭐ {movie.rating.toFixed(1)}
              </div>
            )}
            {movie.plot && (
              <p className="text-zinc-300 text-xs leading-relaxed line-clamp-3 mb-2">
                <HighlightedText
                  text={movie.plot}
                  query={searchQuery}
                  highlightClassName="bg-teal-500/25 text-teal-100 rounded px-0.5"
                />
              </p>
            )}
            <div className="flex items-center gap-2 mt-2 text-white font-medium text-sm">
              <div className="w-8 h-8 rounded-full bg-teal-500 flex items-center justify-center">
                <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
              </div>
              Play
            </div>
          </div>
        </div>
        
        {movie.is_watched === 1 && (
          <div className="absolute top-2 right-2 bg-teal-500/80 rounded-full p-1 backdrop-blur-sm">
            <Eye className="w-4 h-4 text-white" />
          </div>
        )}
        
        {movie.group_id && (
          <div 
            className="absolute top-2 left-2 bg-purple-500/80 rounded-full p-1 backdrop-blur-sm cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/video-group/${movie.group_id}`, { state: routeState });
            }}
          >
            <Layers className="w-4 h-4 text-white" />
          </div>
        )}
      </div>
      
      <div className="mt-2 px-1">
        <h3 className="text-zinc-100 font-medium text-sm truncate">
          <HighlightedText text={movie.title} query={searchQuery} />
        </h3>
        {searchSecondaryText ? (
          <p className="text-teal-200/80 text-xs truncate mt-0.5">
            <HighlightedText
              text={searchSecondaryText}
              query={searchQuery}
              highlightClassName="bg-teal-500/20 text-teal-100 rounded px-0.5"
            />
          </p>
        ) : movie.year && (
          <p className="text-zinc-400 text-xs">{movie.year}</p>
        )}
      </div>
    </div>
  );
}
