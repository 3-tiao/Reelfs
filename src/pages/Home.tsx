import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Settings as SettingsIcon, Eye, EyeOff, Grid, List, Users, ArrowRight } from "lucide-react";
import { useMovieStore } from "../stores/movieStore";
import { useNsfwStore } from "../stores/nsfwStore";
import { useViewStore } from "../stores/viewStore";
import MovieGrid, { MovieGridRef } from "../components/MovieGrid";
import MovieList, { MovieListRef } from "../components/MovieList";
import ActorGrid, { ActorGridRef } from "../components/ActorGrid";
import SearchBar from "../components/SearchBar";
import FilterSortBar from "../components/FilterSortBar";
import ScrollProgressVertical from "../components/ScrollProgressVertical";
import { useScrollRestoration } from "../hooks/useScrollRestoration";
import { ActorInfo, getActorsWithCounts } from "../services/tauri";

export default function Home() {
  const navigate = useNavigate();
  const {
    movies,
    isLoading,
    isLoadingMore,
    fetchMovies,
    loadMore,
    searchMovies,
    reset,
    isUsingFilters,
    fetchMoviesFiltered,
    clearFilters,
    hasMore,
    searchQuery,
    sortOptions,
  } = useMovieStore();
  const { showThumbnails, toggleShowThumbnails } = useNsfwStore();
  const { viewMode, setViewMode, actorSortBy, actorSortOrder, actorSearchQuery, setActorSearchQuery } = useViewStore();
  const movieGridRef = useRef<MovieGridRef>(null);
  const movieListRef = useRef<MovieListRef>(null);
  const actorGridRef = useRef<ActorGridRef>(null);
  const didRequestInitialMovies = useRef(false);
  const headerRef = useRef<HTMLElement>(null);
  const [actors, setActors] = useState<ActorInfo[]>([]);
  const [isLoadingActors, setIsLoadingActors] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(0);

  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const update = () => setHeaderHeight(el.offsetHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const displayActors = useMemo(() => {
    let result = [...actors];

    if (actorSearchQuery.trim()) {
      const query = actorSearchQuery.trim().toLowerCase();
      result = result.filter((a) => a.name.toLowerCase().includes(query));
    }

    result.sort((a, b) => {
      let cmp = 0;
      if (actorSortBy === "name") {
        cmp = a.name.localeCompare(b.name);
      } else {
        cmp = a.movie_count - b.movie_count;
      }
      return actorSortOrder === "ASC" ? cmp : -cmp;
    });

    return result;
  }, [actors, actorSortBy, actorSortOrder, actorSearchQuery]);

  const activeScrollKey = `home:${viewMode}`;

  const getActiveScrollRef = useCallback(() => {
    if (viewMode === "grid") {
      return movieGridRef.current;
    }

    if (viewMode === "list") {
      return movieListRef.current;
    }

    if (viewMode === "actors") {
      return actorGridRef.current;
    }

    return null;
  }, [viewMode]);

  const getActiveItemCount = useCallback(() => {
    if (viewMode === "actors") {
      return displayActors.length;
    }

    return movies.length;
  }, [viewMode, displayActors.length, movies.length]);

  const { scrollProgress, handleScroll, handleSeek } = useScrollRestoration({
    storageKey: activeScrollKey,
    itemCount: getActiveItemCount(),
    getController: getActiveScrollRef,
  });

  useEffect(() => {
    if (viewMode === "actors" && actors.length === 0) {
      setIsLoadingActors(true);
      getActorsWithCounts()
        .then((data) => {
          setActors(data);
          setIsLoadingActors(false);
        })
        .catch(() => setIsLoadingActors(false));
    }
  }, [viewMode, actors.length]);

  useEffect(() => {
    if (didRequestInitialMovies.current) {
      return;
    }

    if (movies.length > 0) {
      didRequestInitialMovies.current = true;
      return;
    }

    if (!searchQuery && !isUsingFilters) {
      didRequestInitialMovies.current = true;
      fetchMovies(0);
    }
  }, [movies.length, searchQuery, isUsingFilters, fetchMovies]);

  const handleSearch = (query: string) => {
    if (viewMode === "actors") {
      setActorSearchQuery(query);
      return;
    }
    if (query.trim()) {
      searchMovies(query);
    } else {
      clearFilters();
      reset();
      fetchMovies(0);
    }
  };

  const handleFilterChange = () => {
    fetchMoviesFiltered(0, 200);
  };

  const activeCount = viewMode === "actors" ? displayActors.length : movies.length;
  const activeSearchQuery = viewMode === "actors" ? actorSearchQuery : searchQuery;
  return (
    <div className="min-h-screen bg-background">
      <ScrollProgressVertical
        progress={scrollProgress}
        onSeek={handleSeek}
        topOffset={headerHeight + 12}
        bottomOffset={16}
      />

      <header
        ref={headerRef}
        className="sticky top-0 z-40 border-b border-white/[0.06] bg-background/80 backdrop-blur-xl"
      >
        <div className="mx-auto w-full max-w-[1600px] px-5 py-4 md:px-8">
          <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight text-foreground">Reelfs</h1>
              <span className="rounded-full border border-white/[0.06] bg-white/[0.03] px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                NAS Browser
              </span>
              <span className="rounded-full border border-white/[0.06] bg-white/[0.03] px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground tabular-nums">
                {activeCount} items
              </span>
              {activeSearchQuery && (
                <span className="rounded-full border border-white/[0.1] bg-white/[0.06] px-2.5 py-0.5 text-[10px] font-medium text-foreground">
                  "{activeSearchQuery}"
                </span>
              )}
              {isUsingFilters && (
                <span className="rounded-full border border-white/[0.1] bg-white/[0.06] px-2.5 py-0.5 text-[10px] font-medium text-foreground">
                  Filters on
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-0.5 rounded-lg border border-white/[0.06] bg-white/[0.03] p-0.5">
                <button
                  onClick={() => setViewMode("grid")}
                  className={`rounded p-1.5 transition-colors ${
                    viewMode === "grid"
                      ? "bg-white/[0.08] text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  title="Grid View"
                >
                  <Grid className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setViewMode("list")}
                  className={`rounded p-1.5 transition-colors ${
                    viewMode === "list"
                      ? "bg-white/[0.08] text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  title="List View"
                >
                  <List className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setViewMode("actors")}
                  className={`rounded p-1.5 transition-colors ${
                    viewMode === "actors"
                      ? "bg-white/[0.08] text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  title="Actor View"
                >
                  <Users className="h-3.5 w-3.5" />
                </button>
              </div>

              <button
                onClick={toggleShowThumbnails}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/[0.06] bg-transparent px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-white/[0.12] hover:bg-white/[0.04] hover:text-foreground"
                title={showThumbnails ? "Hide thumbnails" : "Show thumbnails"}
              >
                {showThumbnails ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                {showThumbnails ? "Previews on" : "Previews off"}
              </button>

              <button
                onClick={() => navigate("/settings")}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/[0.06] bg-transparent px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-white/[0.12] hover:bg-white/[0.04] hover:text-foreground"
                title="Settings"
              >
                <SettingsIcon className="h-3.5 w-3.5" />
                Settings
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-[280px] flex-1 md:max-w-[560px]">
              <SearchBar
                onSearch={handleSearch}
                initialValue={viewMode === "actors" ? actorSearchQuery : searchQuery}
                placeholder={viewMode === "actors" ? "Search actors..." : "Search movies..."}
              />
            </div>

            <FilterSortBar viewMode={viewMode} onFilterChange={handleFilterChange} />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1600px] px-5 py-6 md:px-8 md:py-8">
        {viewMode === "actors" ? (
          isLoadingActors ? (
            <EmptyState
              loading
              title="Building your actor index"
              description="Curating the people behind your library."
            />
          ) : displayActors.length > 0 ? (
            <ActorGrid ref={actorGridRef} actors={displayActors} onScroll={handleScroll} />
          ) : actors.length > 0 ? (
            <EmptyState
              title="No actors match your search"
              description="Try a different keyword or clear the search."
            />
          ) : (
            <EmptyState
              title="No actors surfaced yet"
              description="Once your library metadata fills in, this view becomes a fast people-first browser."
            />
          )
        ) : isLoading ? (
          <EmptyState
            loading
            title="Loading your cinema shelf"
            description="Warming up posters, metadata, and resume state."
          />
        ) : movies.length > 0 ? (
          <>
            {viewMode === "grid" ? (
              <MovieGrid
                ref={movieGridRef}
                movies={movies}
                onScroll={handleScroll}
                onLoadMore={hasMore ? loadMore : undefined}
                groupBy={sortOptions.sortBy}
              />
            ) : (
              <MovieList
                ref={movieListRef}
                movies={movies}
                onScroll={handleScroll}
                onLoadMore={hasMore ? loadMore : undefined}
                groupBy={sortOptions.sortBy}
              />
            )}
            {isLoadingMore && (
              <div className="mt-5 flex items-center justify-center">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs text-muted-foreground">
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-white/20 border-t-foreground" />
                  Loading more
                </div>
              </div>
            )}
          </>
        ) : (
          <EmptyState
            title="Nothing matches this view"
            description="Try loosening filters, changing the sort, or clearing the current query to return to your full collection."
            action={{
              label: "Reset library view",
              onClick: () => {
                clearFilters();
                reset();
                fetchMovies(0);
              },
            }}
          />
        )}
      </main>
    </div>
  );
}

function EmptyState({
  loading,
  title,
  description,
  action,
}: {
  loading?: boolean;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex h-96 items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] text-center">
      <div className="max-w-md px-6">
        {loading && (
          <div className="mx-auto mb-4 h-6 w-6 animate-spin rounded-full border-2 border-white/15 border-t-foreground" />
        )}
        <p className="text-base font-medium text-foreground">{title}</p>
        <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{description}</p>
        {action && (
          <button
            onClick={action.onClick}
            className="mt-5 inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-white/[0.16] hover:bg-white/[0.08]"
          >
            {action.label}
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
