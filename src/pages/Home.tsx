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
  const [actors, setActors] = useState<ActorInfo[]>([]);
  const [isLoadingActors, setIsLoadingActors] = useState(false);

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
    if (movies.length === 0) {
      fetchMovies(0);
    }
  }, [movies.length, fetchMovies]);

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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(45,212,191,0.12),transparent_20%),radial-gradient(circle_at_top_right,rgba(251,191,36,0.1),transparent_18%),linear-gradient(180deg,#09090b_0%,#0a0f10_46%,#09090b_100%)]">
      <ScrollProgressVertical progress={scrollProgress} onSeek={handleSeek} />

      <header className="sticky top-0 z-40 border-b border-zinc-800/70 bg-zinc-950/72 backdrop-blur-2xl shadow-[0_18px_48px_rgba(0,0,0,0.24)] transition-all duration-300">
        <div className="mx-auto w-full max-w-[1600px] px-5 py-4 md:px-8">
          <div className="rounded-[26px] border border-zinc-800/80 bg-[linear-gradient(135deg,rgba(24,24,27,0.82),rgba(13,18,20,0.88))] p-3 shadow-[0_18px_36px_rgba(0,0,0,0.22)] backdrop-blur-2xl">
            <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                  <h1 className="bg-gradient-to-r from-zinc-50 via-white to-zinc-400 bg-clip-text text-2xl font-semibold tracking-tight text-transparent md:text-3xl">Reelfs</h1>
                  <span className="rounded-full border border-zinc-800 bg-zinc-900/80 px-3 py-1 text-[11px] font-medium text-zinc-500">NAS Movie Browser</span>
                  <span className="rounded-full border border-zinc-800 bg-zinc-900/80 px-3 py-1 text-[11px] font-medium text-zinc-300">{activeCount} items</span>
                  {activeSearchQuery && <span className="rounded-full border border-teal-900/60 bg-teal-950/50 px-3 py-1 text-[11px] font-medium text-teal-200/80">{activeSearchQuery}</span>}
                  {isUsingFilters && <span className="rounded-full border border-amber-900/60 bg-amber-950/50 px-3 py-1 text-[11px] font-medium text-amber-200/80">Filters on</span>}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1 rounded-[22px] border border-zinc-800/80 bg-zinc-900/80 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] backdrop-blur-xl">
                  <button
                    onClick={() => setViewMode("grid")}
                    className={`rounded-xl p-2.5 transition-all duration-300 ${
                      viewMode === "grid"
                        ? "bg-teal-950/80 text-teal-200 shadow-[0_10px_20px_rgba(0,0,0,0.18)]"
                        : "text-zinc-500 hover:bg-zinc-800/80 hover:text-zinc-300"
                    }`}
                    title="Grid View"
                  >
                    <Grid className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setViewMode("list")}
                    className={`rounded-xl p-2.5 transition-all duration-300 ${
                      viewMode === "list"
                        ? "bg-teal-950/80 text-teal-200 shadow-[0_10px_20px_rgba(0,0,0,0.18)]"
                        : "text-zinc-500 hover:bg-zinc-800/80 hover:text-zinc-300"
                    }`}
                    title="List View"
                  >
                    <List className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setViewMode("actors")}
                    className={`rounded-xl p-2.5 transition-all duration-300 ${
                      viewMode === "actors"
                        ? "bg-amber-950/80 text-amber-200 shadow-[0_10px_20px_rgba(0,0,0,0.18)]"
                        : "text-zinc-500 hover:bg-zinc-800/80 hover:text-zinc-300"
                    }`}
                    title="Actor View"
                  >
                    <Users className="w-4 h-4" />
                  </button>
                </div>

                <button
                  onClick={toggleShowThumbnails}
                  className={`inline-flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-sm font-medium transition-all duration-300 shadow-[0_16px_32px_rgba(0,0,0,0.18)] ${
                    showThumbnails
                      ? "border-teal-900/70 bg-teal-950/70 text-teal-100 hover:bg-teal-950"
                      : "border-zinc-800/80 bg-zinc-900/80 text-zinc-300 hover:bg-zinc-800"
                  }`}
                  title={showThumbnails ? "Hide NSFW Thumbnails" : "Show NSFW Thumbnails"}
                >
                  {showThumbnails ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  {showThumbnails ? "Previews on" : "Previews off"}
                </button>

                <button
                  onClick={() => navigate("/settings")}
                  className="inline-flex items-center gap-2 rounded-2xl border border-zinc-800/80 bg-zinc-900/80 px-4 py-2.5 text-sm font-medium text-zinc-300 transition-all duration-300 hover:bg-zinc-800 hover:text-white"
                  title="Settings"
                >
                  <SettingsIcon className="w-4 h-4" />
                  Settings
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
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
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1600px] px-5 py-6 md:px-8 md:py-8">
        {viewMode === "actors" ? (
          isLoadingActors ? (
            <div className="flex h-96 items-center justify-center rounded-[34px] border border-white/8 bg-white/[0.03] text-center backdrop-blur-xl">
              <div>
                <div className="mx-auto mb-5 h-14 w-14 animate-spin rounded-full border-2 border-violet-300/20 border-t-violet-300"></div>
                <p className="text-base font-medium text-zinc-200">Building your actor index</p>
                <p className="mt-2 text-sm text-zinc-500">Curating the people behind your library.</p>
              </div>
            </div>
          ) : displayActors.length > 0 ? (
            <ActorGrid ref={actorGridRef} actors={displayActors} onScroll={handleScroll} />
          ) : actors.length > 0 ? (
            <div className="flex h-96 items-center justify-center rounded-[34px] border border-dashed border-white/10 bg-white/[0.02] text-center backdrop-blur-xl">
              <div>
                <p className="text-lg font-medium text-white">No actors match your search</p>
                <p className="mt-2 text-sm text-zinc-500">Try a different keyword or clear the search.</p>
              </div>
            </div>
          ) : (
            <div className="flex h-96 items-center justify-center rounded-[34px] border border-dashed border-white/10 bg-white/[0.02] text-center backdrop-blur-xl">
              <div>
                <p className="text-lg font-medium text-white">No actors surfaced yet</p>
                <p className="mt-2 text-sm text-zinc-500">Once your library metadata fills in, this view becomes a fast people-first browser.</p>
              </div>
            </div>
          )
        ) : isLoading ? (
          <div className="flex h-96 items-center justify-center rounded-[34px] border border-white/8 bg-white/[0.03] text-center backdrop-blur-xl">
            <div>
              <div className="mx-auto mb-5 h-14 w-14 animate-spin rounded-full border-2 border-teal-300/20 border-t-teal-300"></div>
              <p className="text-base font-medium text-zinc-200">Loading your cinema shelf</p>
              <p className="mt-2 text-sm text-zinc-500">Warming up posters, metadata, and resume state.</p>
            </div>
          </div>
        ) : movies.length > 0 ? (
          <>
            {viewMode === "grid" ? (
              <MovieGrid
                ref={movieGridRef}
                movies={movies}
                onScroll={handleScroll}
                onLoadMore={hasMore ? loadMore : undefined}
                groupByRating={sortOptions.sortBy === "rating"}
              />
            ) : (
              <MovieList
                ref={movieListRef}
                movies={movies}
                onScroll={handleScroll}
                onLoadMore={hasMore ? loadMore : undefined}
                groupByRating={sortOptions.sortBy === "rating"}
              />
            )}
            {isLoadingMore && (
              <div className="mt-5 flex items-center justify-center">
                <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-zinc-300 backdrop-blur-xl">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-teal-300/20 border-t-teal-300"></div>
                  Loading deeper into the library
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex h-96 items-center justify-center rounded-[34px] border border-dashed border-white/10 bg-white/[0.02] text-center backdrop-blur-xl">
            <div className="max-w-md px-6">
              <p className="text-xl font-medium text-white">Nothing matches this view yet</p>
              <p className="mt-3 text-sm leading-6 text-zinc-500">Try loosening filters, changing the sort, or clearing the current query to return to your full collection.</p>
              <button
                onClick={() => {
                  clearFilters();
                  reset();
                  fetchMovies(0);
                }}
                className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-4 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/[0.09]"
              >
                Reset library view
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
