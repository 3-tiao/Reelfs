import { useEffect, useState, useCallback, useMemo, useRef, forwardRef, useImperativeHandle } from "react";
import { FixedSizeGrid as Grid } from "react-window";
import MovieCard from "./MovieCard";
import { Movie } from "../services/tauri";

interface MovieGridProps {
  movies: Movie[];
  onScroll?: (info: { thumbHeight: number; thumbPosition: number; totalCount: number; currentIndex: number }) => void;
  onLoadMore?: () => void;
}

export interface MovieGridRef {
  scrollToPercentage: (percentage: number) => void;
}

export default forwardRef<MovieGridRef, MovieGridProps>(function MovieGrid({ movies, onScroll, onLoadMore }, ref) {
  const gridRef = useRef<any>(null);
  const [dimensions, setDimensions] = useState({
    width: window.innerWidth,
    height: window.innerHeight - 80,
  });
  const loadingRef = useRef(false);

  const cardWidth = 200;
  const cardHeight = 350;
  const gap = 16;

  const columnCount = useMemo(() => {
    return Math.floor((dimensions.width - gap) / (cardWidth + gap));
  }, [dimensions.width, gap]);

  const rowCount = useMemo(() => {
    return Math.ceil(movies.length / columnCount);
  }, [movies.length, columnCount]);

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
      if (gridRef.current) {
        const totalHeight = rowCount * (cardHeight + gap);
        const clientHeight = dimensions.height;
        const scrollHeight = totalHeight - clientHeight;
        const targetScrollTop = scrollHeight * (percentage / 100);
        gridRef.current.scrollTo({ scrollLeft: 0, scrollTop: targetScrollTop });
      }
    },
  }));

  const handleScroll = useCallback(
    ({ scrollTop }: any) => {
      if (onScroll) {
        const totalHeight = rowCount * (cardHeight + gap);
        const clientHeight = dimensions.height;
        const scrollHeight = totalHeight - clientHeight;
        
        const thumbHeight = (clientHeight / totalHeight) * 100;
        
        const thumbPosition = scrollHeight > 0 
          ? (scrollTop / scrollHeight) * (100 - thumbHeight) 
          : 0;
        
        // 计算当前显示的第一个电影的索引
        const firstVisibleRow = Math.floor(scrollTop / (cardHeight + gap));
        const firstVisibleIndex = firstVisibleRow * columnCount + 1;
        
        onScroll({ 
          thumbHeight, 
          thumbPosition, 
          totalCount: movies.length,
          currentIndex: Math.min(firstVisibleIndex, movies.length)
        });
      }
      
      if (onLoadMore && !loadingRef.current) {
        const totalHeight = rowCount * (cardHeight + gap);
        const clientHeight = dimensions.height;
        const scrollHeight = totalHeight - clientHeight;
        
        if (scrollHeight > 0 && scrollTop >= scrollHeight * 0.8) {
          loadingRef.current = true;
          onLoadMore();
          // 500ms 后重置 loading 状态
          setTimeout(() => {
            loadingRef.current = false;
          }, 500);
        }
      }
    },
    [rowCount, cardHeight, gap, dimensions.height, onScroll, onLoadMore, columnCount, movies.length]
  );

  const Cell = useCallback(
    ({ columnIndex, rowIndex, style }: any) => {
      const index = rowIndex * columnCount + columnIndex;
      const movie = movies[index];

      if (!movie) return null;

      return (
        <div style={{ ...style, padding: `${gap / 2}px` }}>
          <MovieCard movie={movie} />
        </div>
      );
    },
    [movies, columnCount, gap]
  );

  if (movies.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-400 text-lg">No movies found</p>
      </div>
    );
  }

  return (
    <Grid
      ref={gridRef}
      columnCount={columnCount}
      columnWidth={cardWidth + gap}
      height={dimensions.height}
      rowCount={rowCount}
      rowHeight={cardHeight + gap}
      width={dimensions.width}
      overscanRowCount={2}
      overscanColumnsCount={2}
      onScroll={handleScroll}
    >
      {Cell}
    </Grid>
  );
});
