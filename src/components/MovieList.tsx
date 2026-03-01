import { useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import { useNavigate } from "react-router-dom";
import { Movie } from "../services/tauri";
import { Film, Eye, Calendar, Star, Play } from "lucide-react";
import { useNsfwStore } from "../stores/nsfwStore";

interface MovieListProps {
  movies: Movie[];
  onScroll?: () => void;
  onLoadMore?: () => void;
}

export interface MovieListRef {
  scrollToPercentage: (percentage: number) => void;
  getScrollPosition: () => number;
  scrollToPosition: (scrollTop: number) => void;
}

export default forwardRef<MovieListRef, MovieListProps>(function MovieList({ movies, onScroll, onLoadMore }, ref) {
  const navigate = useNavigate();
  const { showThumbnails } = useNsfwStore();
  const listRef = useRef<HTMLDivElement>(null);
  const currentScrollTopRef = useRef(0);
  const loadingRef = useRef(false);

  useImperativeHandle(ref, () => ({
    scrollToPercentage: (percentage: number) => {
      if (listRef.current) {
        const totalHeight = listRef.current.scrollHeight;
        const clientHeight = listRef.current.clientHeight;
        const scrollHeight = totalHeight - clientHeight;
        const targetScrollTop = scrollHeight * (percentage / 100);
        listRef.current.scrollTop = targetScrollTop;
      }
    },
    getScrollPosition: () => {
      return currentScrollTopRef.current;
    },
    scrollToPosition: (scrollTop: number) => {
      if (listRef.current) {
        listRef.current.scrollTop = scrollTop;
      }
    },
  }));

  const handleScroll = useCallback(() => {
    if (!listRef.current) return;
    
    const scrollTop = listRef.current.scrollTop;
    currentScrollTopRef.current = scrollTop;
    
    // 调用 onScroll 回调
    if (onScroll) {
      onScroll();
    }
    
    if (onLoadMore && !loadingRef.current) {
      const totalHeight = listRef.current.scrollHeight;
      const clientHeight = listRef.current.clientHeight;
      const scrollHeight = totalHeight - clientHeight;
      
      if (scrollHeight > 0 && scrollTop >= scrollHeight * 0.8) {
        loadingRef.current = true;
        onLoadMore();
        setTimeout(() => {
          loadingRef.current = false;
        }, 500);
      }
    }
  }, [onScroll, onLoadMore]);

  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  return (
    <div 
      ref={listRef}
      className="overflow-y-auto h-full"
      onScroll={handleScroll}
    >
      {movies.map((movie, index) => (
        <div
          key={movie.id}
          onClick={() => navigate(`/movie/${movie.id}`)}
          className="flex items-center gap-4 px-4 py-3 hover:bg-gray-800/50 cursor-pointer transition-colors border-b border-gray-800/50 group"
          style={{ height: '72px' }}
        >
          <div className="flex-shrink-0 w-8 text-center text-gray-500 text-sm">
            {index + 1}
          </div>
          
          <div className="flex-shrink-0 w-12 h-16 bg-gray-800 rounded overflow-hidden">
            {showThumbnails && movie.thumbnail_path ? (
              <img
                src={`file://${movie.thumbnail_path}`}
                alt={movie.title}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Film className="w-6 h-6 text-gray-600" />
              </div>
            )}
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-white truncate font-medium">{movie.title}</span>
              {movie.is_watched === 1 && (
                <Eye className="w-4 h-4 text-green-500 flex-shrink-0" />
              )}
            </div>
            <div className="flex items-center gap-4 text-sm text-gray-400 mt-1">
              {movie.actors && (
                <span className="truncate max-w-[200px]">{movie.actors.split(',')[0]}</span>
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
          
          <div className="flex items-center gap-4 flex-shrink-0">
            {movie.rating && (
              <div className="flex items-center gap-1 text-yellow-400">
                <Star className="w-4 h-4" fill="currentColor" />
                <span className="text-sm">{movie.rating.toFixed(1)}</span>
              </div>
            )}
            
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/movie/${movie.id}`);
              }}
              className="opacity-0 group-hover:opacity-100 p-2 bg-blue-600 rounded-lg hover:bg-blue-500 transition-all"
            >
              <Play className="w-4 h-4 text-white" fill="currentColor" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
});
