import { useEffect, useCallback, useMemo, useRef, forwardRef, useImperativeHandle } from "react";
import { FixedSizeGrid as Grid, VariableSizeList as VList } from "react-window";
import MovieCard from "./MovieCard";
import { Movie } from "../services/tauri";
import { useMovieStore } from "../stores/movieStore";
import { buildSections, sectionConfigFor, SectionKey, SortBy } from "../lib/sections";
import { useViewportSize } from "../hooks/useViewportSize";

interface MovieGridProps {
  movies: Movie[];
  onScroll?: () => void;
  onLoadMore?: () => void;
  groupBy?: SortBy | null;
}

export interface MovieGridRef {
  scrollToPercentage: (percentage: number) => void;
  getScrollPosition: () => number;
  scrollToPosition: (scrollTop: number) => void;
  getScrollPercentage: () => number;
}

type SectionItem =
  | { kind: "header"; key: SectionKey; label: string; count: number }
  | { kind: "row"; movies: Movie[] };

const HEADER_HEIGHT = 56;

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-3 px-1 pt-3 pb-2">
      <div className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs font-medium tracking-wide text-foreground">
        {label}
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
      <div className="ml-2 h-px flex-1 bg-white/[0.06]" />
    </div>
  );
}

export default forwardRef<MovieGridRef, MovieGridProps>(function MovieGrid({ movies, onScroll, onLoadMore, groupBy = null }, ref) {
  const sectionConfig = useMemo(() => sectionConfigFor(groupBy), [groupBy]);
  const useSections = sectionConfig !== null;
  const gridRef = useRef<Grid>(null);
  const listRef = useRef<VList>(null);
  const currentScrollTopRef = useRef(0);
  const dimensions = useViewportSize();
  // Store-level in-flight flag: loadMore flips it synchronously and no-ops
  // duplicate calls, so no ref/timer throttle is needed on top of it.
  const isLoadingMore = useMovieStore((state) => state.isLoadingMore);

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
    if (!sectionConfig) return [];
    const sections = buildSections(movies, sectionConfig);
    const result: SectionItem[] = [];
    for (const section of sections) {
      result.push({ kind: "header", key: section.key, label: section.label, count: section.movies.length });
      for (let i = 0; i < section.movies.length; i += columnCount) {
        result.push({ kind: "row", movies: section.movies.slice(i, i + columnCount) });
      }
    }
    return result;
  }, [sectionConfig, movies, columnCount]);

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
    if (!useSections) return 0;
    let total = 0;
    for (let i = 0; i < items.length; i++) {
      total += getItemSize(i);
    }
    return total;
  }, [useSections, items, getItemSize]);

  useEffect(() => {
    if (useSections && listRef.current) {
      listRef.current.resetAfterIndex(0, false);
    }
  }, [useSections, items]);

  useImperativeHandle(ref, () => ({
    scrollToPercentage: (percentage: number) => {
      const clientHeight = dimensions.height;
      if (useSections) {
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
      if (useSections && listRef.current) {
        listRef.current.scrollTo(scrollTop);
      } else if (gridRef.current) {
        gridRef.current.scrollTo({ scrollLeft: 0, scrollTop });
      }
    },
    getScrollPercentage: () => {
      const clientHeight = dimensions.height;
      const totalHeight = useSections ? totalSectionHeight : rowCount * rowSize;
      const scrollHeight = totalHeight - clientHeight;
      if (scrollHeight <= 0) return 0;
      return Math.min(100, (currentScrollTopRef.current / scrollHeight) * 100);
    },
  }));

  const triggerLoadMore = useCallback(
    (scrollTop: number, totalHeight: number) => {
      if (!onLoadMore || isLoadingMore) return;
      const scrollHeight = totalHeight - dimensions.height;
      if (scrollHeight > 0 && scrollTop >= scrollHeight * 0.8) {
        onLoadMore();
      }
    },
    [onLoadMore, isLoadingMore, dimensions.height]
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
            <SectionHeader label={item.label} count={item.count} />
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
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">No movies found</p>
      </div>
    );
  }

  if (useSections) {
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
