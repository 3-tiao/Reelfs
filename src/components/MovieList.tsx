import { useRef, useCallback, forwardRef, useImperativeHandle, useState, useEffect, memo } from "react";
import { FixedSizeList as List, ListChildComponentProps } from "react-window";
import { useNavigate } from "react-router-dom";
import { Movie } from "../services/tauri";
import { Film, Eye, Calendar, Star, Play } from "lucide-react";
import { useNsfwStore } from "../stores/nsfwStore";
import { useMovieStore } from "../stores/movieStore";
import { getCachedThumbnail } from "../lib/thumbnailCache";
import { enqueueThumbnailGen } from "../lib/thumbnailGenQueue";
import { getSearchSecondaryText } from "../lib/search";
import HighlightedText from "./HighlightedText";

interface MovieListProps {
  movies: Movie[];
  onScroll?: () => void;
  onLoadMore?: () => void;
}

export interface MovieListRef {
  scrollToPercentage: (percentage: number) => void;
  getScrollPosition: () => number;
  scrollToPosition: (scrollTop: number) => void;
  getScrollPercentage: () => number;
}

interface MovieListItemProps {
  movie: Movie;
  index: number;
  showThumbnails: boolean;
  formatDuration: (seconds: number) => string;
  navigate: (path: string) => void;
}

const MovieListItem = memo(function MovieListItem({ movie, index, showThumbnails, formatDuration, navigate }: MovieListItemProps) {
  const itemRef = useRef<HTMLDivElement>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const searchQuery = useMovieStore((state) => state.searchQuery);
  const secondaryText = searchQuery
    ? getSearchSecondaryText(movie, searchQuery) ?? movie.actors?.split(",")[0]?.trim() ?? movie.director
    : movie.actors?.split(",")[0]?.trim();

  useEffect(() => {
    if (!showThumbnails) {
      setImageSrc(null);
      return;
    }

    let isMounted = true;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          observer.disconnect();
          if (movie.thumbnail_path) {
            // Thumbnail already exists — load from global cache
            getCachedThumbnail(movie.thumbnail_path).then((url) => {
              if (url) {
                if (isMounted) setImageSrc(url);
                return;
              }

              if (isMounted) {
                enqueueThumbnailGen(movie.id, (generatedUrl) => {
                  if (isMounted) setImageSrc(generatedUrl);
                });
              }
            });
          } else {
            // No thumbnail — enqueue Rust generation
            enqueueThumbnailGen(movie.id, (url) => {
              if (isMounted) setImageSrc(url);
            });
          }
        }
      },
      { rootMargin: "100px" }
    );

    if (itemRef.current) {
      observer.observe(itemRef.current);
    }

    return () => {
      isMounted = false;
      observer.disconnect();
    };
  }, [movie.id, movie.thumbnail_path, showThumbnails]);

  return (
    <div
      ref={itemRef}
      onClick={() => movie.group_id ? navigate(`/video-group/${movie.group_id}`) : navigate(`/movie/${movie.id}`)}
      className="flex items-center gap-4 px-4 py-3 hover:bg-zinc-800/50 cursor-pointer transition-colors border-b border-zinc-800/50 group"
      style={{ height: '72px' }}
    >
      <div className="flex-shrink-0 w-8 text-center text-zinc-500 text-sm">
        {index + 1}
      </div>
      
      <div className="flex-shrink-0 w-12 h-16 bg-zinc-800/80 backdrop-blur-sm rounded overflow-hidden">
        {showThumbnails && imageSrc ? (
          <img
            src={imageSrc}
            alt={movie.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Film className="w-6 h-6 text-zinc-600" />
          </div>
        )}
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-zinc-100 truncate font-medium">
            <HighlightedText text={movie.title} query={searchQuery} />
          </span>
          {movie.is_watched === 1 && (
            <Eye className="w-4 h-4 text-teal-500 flex-shrink-0" />
          )}
        </div>
        <div className="flex items-center gap-4 text-sm text-zinc-400 mt-1">
          {secondaryText && (
            <span className="truncate max-w-[240px]">
              <HighlightedText
                text={secondaryText}
                query={searchQuery}
                highlightClassName="bg-teal-500/20 text-teal-100 rounded px-0.5"
              />
            </span>
          )}
          {movie.year && (
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {movie.year}
            </span>
          )}
          {movie.duration_seconds && (
            <span>{formatDuration(movie.duration_seconds)}</span>
          )}
        </div>
      </div>
      
      <div className="flex items-center gap-4 flex-shrink-0 pr-4">
        {movie.rating && (
          <div className="flex items-center gap-1 text-teal-400">
            <Star className="w-4 h-4" fill="currentColor" />
            <span className="text-sm">{movie.rating.toFixed(1)}</span>
          </div>
        )}
        
        <button
          onClick={(e) => {
            e.stopPropagation();
            movie.group_id ? navigate(`/video-group/${movie.group_id}`) : navigate(`/movie/${movie.id}`);
          }}
          className="opacity-0 group-hover:opacity-100 p-2 bg-gradient-to-r from-teal-500 to-teal-600 rounded-lg hover:from-teal-400 hover:to-teal-500 transition-all"
        >
          <Play className="w-4 h-4 text-white" fill="currentColor" />
        </button>
      </div>
    </div>
  );
});

export default forwardRef<MovieListRef, MovieListProps>(function MovieList({ movies, onScroll, onLoadMore }, ref) {
  const navigate = useNavigate();
  const { showThumbnails } = useNsfwStore();
  const listRef = useRef<any>(null);
  const currentScrollTopRef = useRef(0);
  const loadingRef = useRef(false);
  const [dimensions, setDimensions] = useState({
    width: window.innerWidth,
    height: window.innerHeight - 80,
  });

  useEffect(() => {
    const handleResize = () => {
      setDimensions({
        width: window.innerWidth,
        height: window.innerHeight - 80,
      });
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useImperativeHandle(ref, () => ({
    scrollToPercentage: (percentage: number) => {
      if (listRef.current) {
        const totalHeight = movies.length * 72;
        const clientHeight = dimensions.height;
        const scrollHeight = totalHeight - clientHeight;
        const targetScrollTop = scrollHeight * (percentage / 100);
        currentScrollTopRef.current = targetScrollTop;
        listRef.current.scrollTo(targetScrollTop);
      }
    },
    getScrollPosition: () => {
      return currentScrollTopRef.current;
    },
    scrollToPosition: (scrollTop: number) => {
      if (listRef.current) {
        currentScrollTopRef.current = scrollTop;
        listRef.current.scrollTo(scrollTop);
      }
    },
    getScrollPercentage: () => {
      const totalHeight = movies.length * 72;
      const clientHeight = dimensions.height;
      const scrollHeight = totalHeight - clientHeight;
      if (scrollHeight <= 0) return 0;
      return Math.min(100, (currentScrollTopRef.current / scrollHeight) * 100);
    },
  }));

  const handleScroll = useCallback(({ scrollOffset }: any) => {
    if (!listRef.current) return;
    
    currentScrollTopRef.current = scrollOffset;
    
    if (onScroll) {
      onScroll();
    }
    
    if (onLoadMore && !loadingRef.current) {
      const totalHeight = movies.length * 72;
      const clientHeight = dimensions.height;
      const scrollHeight = totalHeight - clientHeight;
      
      if (scrollHeight > 0 && scrollOffset >= scrollHeight * 0.8) {
        loadingRef.current = true;
        onLoadMore();
        setTimeout(() => {
          loadingRef.current = false;
        }, 500);
      }
    }
  }, [onScroll, onLoadMore, movies.length]);

  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  const Row = useCallback(({ index, style }: ListChildComponentProps) => {
    const movie = movies[index];
    if (!movie) return null;

    return (
      <div style={style}>
        <MovieListItem
          movie={movie}
          index={index}
          showThumbnails={showThumbnails}
          formatDuration={formatDuration}
          navigate={navigate}
        />
      </div>
    );
  }, [movies, showThumbnails, formatDuration, navigate]);

  return (
    <List
      ref={listRef}
      width={dimensions.width}
      height={dimensions.height}
      itemCount={movies.length}
      itemSize={72}
      onScroll={handleScroll}
    >
      {Row}
    </List>
  );
});
