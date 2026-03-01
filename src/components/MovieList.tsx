import { useRef, useCallback, forwardRef, useImperativeHandle, useState, useEffect, memo } from "react";
import { FixedSizeList as List, ListChildComponentProps } from "react-window";
import { useNavigate } from "react-router-dom";
import { Movie } from "../services/tauri";
import { Film, Eye, Calendar, Star, Play, RefreshCw } from "lucide-react";
import { useNsfwStore } from "../stores/nsfwStore";
import { generateThumbnail } from "../services/thumbnail";
import { exists, readBinaryFile } from "@tauri-apps/api/fs";

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
  const [isLoading, setIsLoading] = useState(false);
  const hasLoadedRef = useRef(false);

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

  const loadLocalImage = async (path: string) => {
    try {
      console.log('[MovieListItem] 开始加载图片:', path);
      
      const data = await readBinaryFile(path);
      console.log('[MovieListItem] 文件读取成功，大小:', data.length, 'bytes');
      
      const blob = new Blob([data as BlobPart], { type: 'image/jpeg' });
      const url = URL.createObjectURL(blob);
      console.log('[MovieListItem] Blob URL 创建成功:', url);
      
      setImageSrc(url);
      console.log('[MovieListItem] 图片加载完成');
    } catch (error) {
      console.error('[MovieListItem] 加载图片失败:', path, error);
    }
  };

  const generateAndLoadThumbnail = async () => {
    const posterPath = await getPosterPath(movie.file_path);
    
    if (!posterPath) {
      console.error('[MovieListItem] 没有海报路径，无法生成缩略图');
      return;
    }
    
    try {
      setIsLoading(true);
      console.log('[MovieListItem] 开始生成缩略图:', { id: movie.id, title: movie.title });
      
      const thumbnailPath = `/Users/user/.reelfs/cache/thumbnails/${movie.id}.jpg`;
      await generateThumbnail(posterPath, thumbnailPath, movie.id);
      
      await loadLocalImage(thumbnailPath);
    } catch (error) {
      console.error('[MovieListItem] 生成缩略图失败:', error);
      await loadLocalImage(posterPath);
    } finally {
      setIsLoading(false);
    }
  };

  const loadOrGenerateThumbnail = async () => {
    if (hasLoadedRef.current || !showThumbnails) {
      return;
    }

    hasLoadedRef.current = true;

    if (movie.thumbnail_path) {
      await loadLocalImage(movie.thumbnail_path);
      return;
    }

    await generateAndLoadThumbnail();
  };

  useEffect(() => {
    if (!showThumbnails) {
      setImageSrc(null);
      hasLoadedRef.current = false;
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          loadOrGenerateThumbnail();
          observer.disconnect();
        }
      },
      { rootMargin: "100px" }
    );

    if (itemRef.current) {
      observer.observe(itemRef.current);
    }

    return () => observer.disconnect();
  }, [showThumbnails]);

  return (
    <div
      ref={itemRef}
      onClick={() => navigate(`/movie/${movie.id}`)}
      className="flex items-center gap-4 px-4 py-3 hover:bg-gray-800/50 cursor-pointer transition-colors border-b border-gray-800/50 group"
      style={{ height: '72px' }}
    >
      <div className="flex-shrink-0 w-8 text-center text-gray-500 text-sm">
        {index + 1}
      </div>
      
      <div className="flex-shrink-0 w-12 h-16 bg-gray-800 rounded overflow-hidden">
        {showThumbnails ? (
          isLoading ? (
            <div className="w-full h-full flex items-center justify-center">
              <RefreshCw className="w-6 h-6 text-blue-500 animate-spin" />
            </div>
          ) : imageSrc ? (
            <img
              src={imageSrc}
              alt={movie.title}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Film className="w-6 h-6 text-gray-600" />
            </div>
          )
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
  );
});

export default forwardRef<MovieListRef, MovieListProps>(function MovieList({ movies, onScroll, onLoadMore }, ref) {
  const navigate = useNavigate();
  const { showThumbnails } = useNsfwStore();
  const listRef = useRef<any>(null);
  const currentScrollTopRef = useRef(0);
  const loadingRef = useRef(false);

  useImperativeHandle(ref, () => ({
    scrollToPercentage: (percentage: number) => {
      if (listRef.current) {
        listRef.current.scrollTo(percentage);
      }
    },
    getScrollPosition: () => {
      return currentScrollTopRef.current;
    },
    scrollToPosition: (scrollTop: number) => {
      if (listRef.current) {
        listRef.current.scrollTo(scrollTop);
      }
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
      const clientHeight = window.innerHeight - 80;
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
      width={window.innerWidth}
      height={window.innerHeight - 80}
      itemCount={movies.length}
      itemSize={72}
      onScroll={handleScroll}
    >
      {Row}
    </List>
  );
});
