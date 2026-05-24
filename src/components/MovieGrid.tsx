import { useEffect, useState, useCallback, useMemo, useRef, forwardRef, useImperativeHandle } from "react";
import { FixedSizeGrid as Grid, VariableSizeList as VList } from "react-window";
import MovieCard from "./MovieCard";
import { Movie } from "../services/tauri";
import { buildRatingSections, ratingSectionLabel, RatingKey } from "../lib/ratingSections";
import { Star } from "lucide-react";

interface MovieGridProps {
  movies: Movie[];
  onScroll?: () => void;
  onLoadMore?: () => void;
  groupByRating?: boolean;
}

export interface MovieGridRef {
  scrollToPercentage: (percentage: number) => void;
  getScrollPosition: () => number;
  scrollToPosition: (scrollTop: number) => void;
  getScrollPercentage: () => number;
}

type SectionItem =
  | { kind: "header"; key: RatingKey; count: number }
  | { kind: "row"; movies: Movie[] };

const HEADER_HEIGHT = 56;

function SectionHeader({ rating, count }: { rating: RatingKey; count: number }) {
  const stars = rating ?? 0;
  return (
    <div className="flex items-center gap-3 px-1 pt-3 pb-2">
      <div className="flex items-center gap-1.5 rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1.5 text-amber-200">
        {rating !== null ? (
          <>
            {Array.from({ length: stars }).map((_, i) => (
              <Star key={i} className="w-3.5 h-3.5" fill="currentColor" />
            ))}
            <span className="ml-1 text-sm font-semibold tracking-wide">{ratingSectionLabel(rating)}</span>
          </>
        ) : (
          <span className="text-sm font-semibold tracking-wide text-zinc-300">{ratingSectionLabel(rating)}</span>
        )}
      </div>
      <span className="text-xs text-zinc-500">{count}</span>
      <div className="ml-2 h-px flex-1 bg-gradient-to-r from-zinc-700/60 to-transparent" />
    </div>
  );
}

export default forwardRef<MovieGridRef, MovieGridProps>(function MovieGrid({ movies, onScroll, onLoadMore, groupByRating = false }, ref) {
  const gridRef = useRef<any>(null);
  const listRef = useRef<any>(null);
  const currentScrollTopRef = useRef(0);
  const [dimensions, setDimensions] = useState({
    width: window.innerWidth,
    height: window.innerHeight - 80,
  });
  const loadingRef = useRef(false);

  const cardWidth = 200;
  const cardHeight = 350;
  const gap = 16;

  const columnCount = useMemo(() => {
    return Math.max(1, Math.floor((dimensions.width - gap) / (cardWidth + gap)));
  }, [dimensions.width, gap]);

  const rowCount = useMemo(() => {
    return Math.ceil(movies.length / columnCount);
  }, [movies.length, columnCount]);

  const items = useMemo<SectionItem[]>(() => {
    if (!groupByRating) return [];
    const sections = buildRatingSections(movies);
    const result: SectionItem[] = [];
    for (const section of sections) {
      result.push({ kind: "header", key: section.key, count: section.movies.length });
      for (let i = 0; i < section.movies.length; i += columnCount) {
        result.push({ kind: "row", movies: section.movies.slice(i, i + columnCount) });
      }
    }
    return result;
  }, [groupByRating, movies, columnCount]);

  const rowSize = cardHeight + gap;
  const getItemSize = useCallback(
    (index: number) => {
      const item = items[index];
      if (!item) return 0;
      return item.kind === "header" ? HEADER_HEIGHT : rowSize;
    },
    [items, rowSize]
  );

  const totalSectionHeight = useMemo(() => {
    if (!groupByRating) return 0;
    let total = 0;
    for (let i = 0; i < items.length; i++) {
      total += getItemSize(i);
    }
    return total;
  }, [groupByRating, items, getItemSize]);

  useEffect(() => {
    if (groupByRating && listRef.current) {
      listRef.current.resetAfterIndex(0, false);
    }
  }, [groupByRating, items]);

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
      const clientHeight = dimensions.height;
      if (groupByRating) {
        if (!listRef.current) return;
        const scrollHeight = Math.max(0, totalSectionHeight - clientHeight);
        const targetScrollTop = scrollHeight * (percentage / 100);
        currentScrollTopRef.current = targetScrollTop;
        listRef.current.scrollTo(targetScrollTop);
      } else if (gridRef.current) {
        const totalHeight = rowCount * rowSize;
        const scrollHeight = totalHeight - clientHeight;
        const targetScrollTop = scrollHeight * (percentage / 100);
        currentScrollTopRef.current = targetScrollTop;
        gridRef.current.scrollTo({ scrollLeft: 0, scrollTop: targetScrollTop });
      }
    },
    getScrollPosition: () => currentScrollTopRef.current,
    scrollToPosition: (scrollTop: number) => {
      currentScrollTopRef.current = scrollTop;
      if (groupByRating && listRef.current) {
        listRef.current.scrollTo(scrollTop);
      } else if (gridRef.current) {
        gridRef.current.scrollTo({ scrollLeft: 0, scrollTop });
      }
    },
    getScrollPercentage: () => {
      const clientHeight = dimensions.height;
      const totalHeight = groupByRating ? totalSectionHeight : rowCount * rowSize;
      const scrollHeight = totalHeight - clientHeight;
      if (scrollHeight <= 0) return 0;
      return Math.min(100, (currentScrollTopRef.current / scrollHeight) * 100);
    },
  }));

  const triggerLoadMore = useCallback(
    (scrollTop: number, totalHeight: number) => {
      if (!onLoadMore || loadingRef.current) return;
      const scrollHeight = totalHeight - dimensions.height;
      if (scrollHeight > 0 && scrollTop >= scrollHeight * 0.8) {
        loadingRef.current = true;
        onLoadMore();
        setTimeout(() => {
          loadingRef.current = false;
        }, 500);
      }
    },
    [onLoadMore, dimensions.height]
  );

  const handleGridScroll = useCallback(
    ({ scrollTop }: any) => {
      currentScrollTopRef.current = scrollTop;
      if (onScroll) onScroll();
      triggerLoadMore(scrollTop, rowCount * rowSize);
    },
    [onScroll, triggerLoadMore, rowCount, rowSize]
  );

  const handleListScroll = useCallback(
    ({ scrollOffset }: any) => {
      currentScrollTopRef.current = scrollOffset;
      if (onScroll) onScroll();
      triggerLoadMore(scrollOffset, totalSectionHeight);
    },
    [onScroll, triggerLoadMore, totalSectionHeight]
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

  const Row = useCallback(
    ({ index, style }: { index: number; style: React.CSSProperties }) => {
      const item = items[index];
      if (!item) return null;

      if (item.kind === "header") {
        return (
          <div style={style} className="px-2">
            <SectionHeader rating={item.key} count={item.count} />
          </div>
        );
      }

      return (
        <div style={style}>
          <div
            className="flex"
            style={{ paddingTop: gap / 2, paddingBottom: gap / 2 }}
          >
            {item.movies.map((movie) => (
              <div
                key={movie.id}
                style={{
                  width: cardWidth,
                  marginLeft: gap / 2,
                  marginRight: gap / 2,
                }}
              >
                <MovieCard movie={movie} />
              </div>
            ))}
          </div>
        </div>
      );
    },
    [items, cardWidth, gap]
  );

  if (movies.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-400 text-lg">No movies found</p>
      </div>
    );
  }

  if (groupByRating) {
    return (
      <VList
        ref={listRef}
        width={dimensions.width}
        height={dimensions.height}
        itemCount={items.length}
        itemSize={getItemSize}
        estimatedItemSize={rowSize}
        onScroll={handleListScroll}
        overscanCount={4}
      >
        {Row}
      </VList>
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
      onScroll={handleGridScroll}
    >
      {Cell}
    </Grid>
  );
});
