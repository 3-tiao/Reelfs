import { useEffect, useState, useCallback, useMemo, useRef, forwardRef, useImperativeHandle } from "react";
import { FixedSizeGrid as Grid } from "react-window";
import MovieCard from "./MovieCard";
import { Movie } from "../services/tauri";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import "overlayscrollbars/overlayscrollbars.css";

interface MovieGridProps {
  movies: Movie[];
  onLoadMore?: () => void;
}

export interface MovieGridRef {
  scrollToPercentage: (percentage: number) => void;
}

export default forwardRef<MovieGridRef, MovieGridProps>(function MovieGrid({ movies, onLoadMore }, ref) {
  const gridRef = useRef<any>(null);
  const scrollRef = useRef<any>(null);
  const [dimensions, setDimensions] = useState({
    width: window.innerWidth,
    height: window.innerHeight - 80,
  });

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
      if (onLoadMore) {
        const totalHeight = rowCount * (cardHeight + gap);
        const clientHeight = dimensions.height;
        const scrollHeight = totalHeight - clientHeight;
        
        if (scrollHeight > 0 && scrollTop >= scrollHeight * 0.8) {
          onLoadMore();
        }
      }
    },
    [rowCount, cardHeight, gap, dimensions.height, onLoadMore]
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
    <OverlayScrollbarsComponent
      ref={scrollRef}
      style={{ width: dimensions.width, height: dimensions.height }}
      options={{
        scrollbars: {
          theme: 'os-theme-dark',
          autoHide: 'move',
          autoHideDelay: 500,
          dragScroll: true,
          clickScroll: true,
        },
      }}
    >
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
        style={{ overflow: 'visible' }}
      >
        {Cell}
      </Grid>
    </OverlayScrollbarsComponent>
  );
});
