import { useCallback, useMemo, useRef, forwardRef, useImperativeHandle } from "react";
import { FixedSizeGrid as Grid } from "react-window";
import ActorCard from "./ActorCard";
import { ActorInfo } from "../services/tauri";
import { useViewportSize } from "../hooks/useViewportSize";

interface ActorGridProps {
  actors: ActorInfo[];
  onScroll?: () => void;
}

export interface ActorGridRef {
  scrollToPercentage: (percentage: number) => void;
  getScrollPosition: () => number;
  scrollToPosition: (scrollTop: number) => void;
  getScrollPercentage: () => number;
}

export default forwardRef<ActorGridRef, ActorGridProps>(function ActorGrid({ actors, onScroll }, ref) {
  const gridRef = useRef<Grid>(null);
  const currentScrollTopRef = useRef(0);
  const dimensions = useViewportSize();

  const cardWidth = 200;
  const cardHeight = 350;
  const gap = 16;

  const columnCount = useMemo(() => {
    return Math.floor((dimensions.width - gap) / (cardWidth + gap));
  }, [dimensions.width, gap]);

  const rowCount = useMemo(() => {
    return Math.ceil(actors.length / columnCount);
  }, [actors.length, columnCount]);

  useImperativeHandle(ref, () => ({
    scrollToPercentage: (percentage: number) => {
      if (gridRef.current) {
        const totalHeight = rowCount * (cardHeight + gap);
        const clientHeight = dimensions.height;
        const scrollHeight = totalHeight - clientHeight;
        const targetScrollTop = scrollHeight * (percentage / 100);
        currentScrollTopRef.current = targetScrollTop;
        gridRef.current.scrollTo({ scrollLeft: 0, scrollTop: targetScrollTop });
      }
    },
    getScrollPosition: () => {
      return currentScrollTopRef.current;
    },
    scrollToPosition: (scrollTop: number) => {
      if (gridRef.current) {
        currentScrollTopRef.current = scrollTop;
        gridRef.current.scrollTo({ scrollLeft: 0, scrollTop });
      }
    },
    getScrollPercentage: () => {
      const totalHeight = rowCount * (cardHeight + gap);
      const clientHeight = dimensions.height;
      const scrollHeight = totalHeight - clientHeight;
      if (scrollHeight <= 0) return 0;
      return Math.min(100, (currentScrollTopRef.current / scrollHeight) * 100);
    },
  }));

  const handleScroll = useCallback(
    ({ scrollTop }: any) => {
      currentScrollTopRef.current = scrollTop;
      if (onScroll) {
        onScroll();
      }
    },
    [onScroll]
  );

  const Cell = useCallback(
    ({ columnIndex, rowIndex, style }: any) => {
      const index = rowIndex * columnCount + columnIndex;
      const actor = actors[index];

      if (!actor) return null;

      return (
        <div style={{ ...style, padding: `${gap / 2}px` }}>
          <ActorCard actor={actor} />
        </div>
      );
    },
    [actors, columnCount, gap]
  );

  if (actors.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">No actors found</p>
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
