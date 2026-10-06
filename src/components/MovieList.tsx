import { useRef, useState, useCallback, forwardRef, useImperativeHandle, useEffect, memo, useMemo } from "react";
import { FixedSizeList as List, VariableSizeList as VList, ListChildComponentProps } from "react-window";
import { useLocation, useNavigate } from "react-router-dom";
import { Movie } from "../services/tauri";
import { Film, Eye, Calendar, Star, Play } from "lucide-react";
import { useNsfwStore } from "../stores/nsfwStore";
import { useMovieStore } from "../stores/movieStore";
import { thumbnailUrl } from "../lib/thumbnailCache";
import { enqueueThumbnailGen } from "../lib/thumbnailGenQueue";
import { getRouteState } from "../lib/navigation";
import { getSearchSecondaryText } from "../lib/search";
import { buildSections, sectionConfigFor, SectionKey, SortBy } from "../lib/sections";
import { useViewportSize } from "../hooks/useViewportSize";
import HighlightedText from "./HighlightedText";

interface MovieListProps {
  movies: Movie[];
  onScroll?: () => void;
  onLoadMore?: () => void;
  groupBy?: SortBy | null;
}

type ListRowItem =
  | { kind: "header"; key: SectionKey; label: string; count: number }
  | { kind: "movie"; movie: Movie; displayIndex: number };

const HEADER_HEIGHT = 56;
const ROW_HEIGHT = 72;

// Module scope so its identity is stable across renders — passing a
// fresh per-render closure to memoized rows would defeat `memo`.
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function ListSectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs font-medium tracking-wide text-foreground">
        {label}
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
      <div className="ml-2 h-px flex-1 bg-white/[0.06]" />
    </div>
  );
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
  navigate: (path: string, options?: { state?: { from?: string } }) => void;
  routeState: { from?: string };
}

const MovieListItem = memo(function MovieListItem({ movie, index, showThumbnails, formatDuration, navigate, routeState }: MovieListItemProps) {
  const itemRef = useRef<HTMLDivElement>(null);
  const [generatedSrc, setGeneratedSrc] = useState<string | null>(null);
  const searchQuery = useMovieStore((state) => state.searchQuery);
  const secondaryText = searchQuery
    ? getSearchSecondaryText(movie, searchQuery) ?? movie.actors?.split(",")[0]?.trim() ?? movie.director
    : movie.actors?.split(",")[0]?.trim();

  // Asset URL built straight from the DB row; `updated_at` (bumped by the
  // backend whenever the thumbnail file is rewritten) doubles as the ?v=
  // cache-busting token.
  const dbSrc = showThumbnails && movie.thumbnail_path
    ? thumbnailUrl(movie.thumbnail_path, movie.updated_at)
    : null;
  // Asset URL of a thumbnail generated on demand this session — nonce-busted
  // because the store row (and its updated_at) predates the rewrite.
  const imageSrc = showThumbnails ? generatedSrc ?? dbSrc : null;
  // The src whose load already triggered one generation request — guards the
  // onError self-heal against looping when the file never becomes loadable.
  const generationRequestedForRef = useRef<string | null>(null);

  // Virtualized lists reuse this row instance for another movie; drop the
  // generated URL so the previous movie's poster is never flashed.
  useEffect(() => {
    setGeneratedSrc(null);
    generationRequestedForRef.current = null;
  }, [movie.id]);

  const requestGeneration = useCallback(() => {
    enqueueThumbnailGen(movie.id, (url) => setGeneratedSrc(url));
  }, [movie.id]);

  // Only the on-demand generation needs visibility gating: when the DB row has
  // no thumbnail yet, enqueue Rust generation once the row scrolls near the
  // viewport. Asset URLs for existing thumbnails load natively.
  useEffect(() => {
    if (!showThumbnails || movie.thumbnail_path) {
      return;
    }

    let isMounted = true;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          observer.disconnect();
          if (isMounted) {
            requestGeneration();
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
  }, [movie.id, movie.thumbnail_path, showThumbnails, requestGeneration]);

  // The DB row claims a thumbnail that failed to load (deleted cache file, …);
  // one generation attempt per src keeps a broken file from looping invokes.
  const handleImageError = () => {
    if (dbSrc && generationRequestedForRef.current !== dbSrc) {
      generationRequestedForRef.current = dbSrc;
      requestGeneration();
    }
  };

  return (
    <div
      ref={itemRef}
      onClick={() =>
        movie.group_id
          ? navigate(`/video-group/${movie.group_id}`, { state: routeState })
          : navigate(`/movie/${movie.id}`, { state: routeState })
      }
      className="group flex cursor-pointer items-center gap-4 border-b border-white/[0.04] px-4 py-3 transition-colors hover:bg-white/[0.03]"
      style={{ height: "72px" }}
    >
      <div className="w-8 flex-shrink-0 text-center text-xs text-muted-foreground tabular-nums">
        {index + 1}
      </div>

      <div className="h-16 w-12 flex-shrink-0 overflow-hidden rounded border border-white/[0.06] bg-card">
        {imageSrc ? (
          <img
            src={imageSrc}
            alt={movie.title}
            className="h-full w-full object-cover"
            onError={dbSrc ? handleImageError : undefined}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Film className="h-5 w-5 text-white/15" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            <HighlightedText text={movie.title} query={searchQuery} />
          </span>
          {movie.is_watched === 1 && <Eye className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />}
        </div>
        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
          {secondaryText && (
            <span className="max-w-[240px] truncate">
              <HighlightedText
                text={secondaryText}
                query={searchQuery}
                highlightClassName="bg-white/10 text-foreground rounded px-0.5"
              />
            </span>
          )}
          {movie.year && (
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {movie.year}
            </span>
          )}
          {movie.duration_seconds && <span>{formatDuration(movie.duration_seconds)}</span>}
        </div>
      </div>

      <div className="flex flex-shrink-0 items-center gap-4 pr-4">
        {movie.rating && (
          <div className="flex items-center gap-1 text-foreground">
            <Star className="h-3.5 w-3.5" fill="currentColor" />
            <span className="text-xs tabular-nums">{movie.rating.toFixed(1)}</span>
          </div>
        )}

        <button
          onClick={(e) => {
            e.stopPropagation();
            movie.group_id
              ? navigate(`/video-group/${movie.group_id}`, { state: routeState })
              : navigate(`/movie/${movie.id}`, { state: routeState });
          }}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-black opacity-0 transition-opacity group-hover:opacity-100"
        >
          <Play className="ml-0.5 h-3 w-3" fill="currentColor" />
        </button>
      </div>
    </div>
  );
});

export default forwardRef<MovieListRef, MovieListProps>(function MovieList({ movies, onScroll, onLoadMore, groupBy = null }, ref) {
  const sectionConfig = useMemo(() => sectionConfigFor(groupBy), [groupBy]);
  const useSections = sectionConfig !== null;
  const navigate = useNavigate();
  const location = useLocation();
  const { showThumbnails } = useNsfwStore();
  // Memoized: `getRouteState(location)` returns a fresh object per render, and
  // passing it straight down would defeat `memo` on every row.
  const routeState = useMemo(
    () => getRouteState(location),
    [location.pathname, location.search]
  );
  const listRef = useRef<List>(null);
  const vListRef = useRef<VList>(null);
  const currentScrollTopRef = useRef(0);
  const dimensions = useViewportSize();
  // Store-level in-flight flag: loadMore flips it synchronously and no-ops
  // duplicate calls, so no ref/timer throttle is needed on top of it.
  const isLoadingMore = useMovieStore((state) => state.isLoadingMore);

  const items = useMemo<ListRowItem[]>(() => {
    if (!sectionConfig) return [];
    const sections = buildSections(movies, sectionConfig);
    const result: ListRowItem[] = [];
    let displayIndex = 0;
    for (const section of sections) {
      result.push({ kind: "header", key: section.key, label: section.label, count: section.movies.length });
      for (const movie of section.movies) {
        result.push({ kind: "movie", movie, displayIndex });
        displayIndex += 1;
      }
    }
    return result;
  }, [sectionConfig, movies]);

  const getItemSize = useCallback(
    (index: number) => {
      const item = items[index];
      if (!item) return 0;
      return item.kind === "header" ? HEADER_HEIGHT : ROW_HEIGHT;
    },
    [items]
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
    if (useSections && vListRef.current) {
      vListRef.current.resetAfterIndex(0, false);
    }
  }, [useSections, items]);

  useImperativeHandle(ref, () => ({
    scrollToPercentage: (percentage: number) => {
      const clientHeight = dimensions.height;
      const totalHeight = useSections ? totalSectionHeight : movies.length * ROW_HEIGHT;
      const scrollHeight = Math.max(0, totalHeight - clientHeight);
      const targetScrollTop = scrollHeight * (percentage / 100);
      currentScrollTopRef.current = targetScrollTop;
      if (useSections && vListRef.current) {
        vListRef.current.scrollTo(targetScrollTop);
      } else if (listRef.current) {
        listRef.current.scrollTo(targetScrollTop);
      }
    },
    getScrollPosition: () => {
      return currentScrollTopRef.current;
    },
    scrollToPosition: (scrollTop: number) => {
      currentScrollTopRef.current = scrollTop;
      if (useSections && vListRef.current) {
        vListRef.current.scrollTo(scrollTop);
      } else if (listRef.current) {
        listRef.current.scrollTo(scrollTop);
      }
    },
    getScrollPercentage: () => {
      const totalHeight = useSections ? totalSectionHeight : movies.length * ROW_HEIGHT;
      const clientHeight = dimensions.height;
      const scrollHeight = totalHeight - clientHeight;
      if (scrollHeight <= 0) return 0;
      return Math.min(100, (currentScrollTopRef.current / scrollHeight) * 100);
    },
  }));

  const handleScroll = useCallback(({ scrollOffset }: any) => {
    currentScrollTopRef.current = scrollOffset;

    if (onScroll) {
      onScroll();
    }

    if (onLoadMore && !isLoadingMore) {
      const totalHeight = useSections ? totalSectionHeight : movies.length * ROW_HEIGHT;
      const clientHeight = dimensions.height;
      const scrollHeight = totalHeight - clientHeight;

      if (scrollHeight > 0 && scrollOffset >= scrollHeight * 0.8) {
        onLoadMore();
      }
    }
  }, [onScroll, onLoadMore, isLoadingMore, movies.length, useSections, totalSectionHeight, dimensions.height]);

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
          routeState={routeState}
        />
      </div>
    );
  }, [movies, showThumbnails, formatDuration, navigate, routeState]);

  const SectionedRow = useCallback(({ index, style }: ListChildComponentProps) => {
    const item = items[index];
    if (!item) return null;

    if (item.kind === "header") {
      return (
        <div style={style}>
          <ListSectionHeader label={item.label} count={item.count} />
        </div>
      );
    }

    return (
      <div style={style}>
        <MovieListItem
          movie={item.movie}
          index={item.displayIndex}
          showThumbnails={showThumbnails}
          formatDuration={formatDuration}
          navigate={navigate}
          routeState={routeState}
        />
      </div>
    );
  }, [items, showThumbnails, formatDuration, navigate, routeState]);

  if (useSections) {
    return (
      <VList
        ref={vListRef}
        width={dimensions.width}
        height={dimensions.height}
        itemCount={items.length}
        itemSize={getItemSize}
        estimatedItemSize={ROW_HEIGHT}
        onScroll={handleScroll}
        overscanCount={6}
      >
        {SectionedRow}
      </VList>
    );
  }

  return (
    <List
      ref={listRef}
      width={dimensions.width}
      height={dimensions.height}
      itemCount={movies.length}
      itemSize={ROW_HEIGHT}
      onScroll={handleScroll}
    >
      {Row}
    </List>
  );
});
