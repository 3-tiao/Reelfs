import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, SlidersHorizontal } from "lucide-react";
import SearchBar from "../components/SearchBar";
import MovieGrid, { MovieGridRef } from "../components/MovieGrid";
import FilterSortBar from "../components/FilterSortBar";
import { useScrollRestoration } from "../hooks/useScrollRestoration";
import { useMovieStore } from "../stores/movieStore";

export default function Search() {
  const navigate = useNavigate();
  const {
    movies,
    isLoading,
    searchMovies,
    isUsingFilters,
    fetchMoviesFiltered,
    reset,
    clearFilters,
    searchQuery,
  } = useMovieStore();
  const [hasSearched, setHasSearched] = useState(Boolean(searchQuery) || isUsingFilters);
  const movieGridRef = useRef<MovieGridRef>(null);
  const hasHydratedSearchRef = useRef(false);

  const { handleScroll, resetRestoration } = useScrollRestoration({
    storageKey: "search",
    itemCount: movies.length,
    getController: () => movieGridRef.current,
  });

  useEffect(() => {
    setHasSearched(Boolean(searchQuery) || isUsingFilters);
  }, [searchQuery, isUsingFilters]);

  useEffect(() => {
    if (searchQuery && movies.length === 0 && !isLoading && !hasHydratedSearchRef.current) {
      hasHydratedSearchRef.current = true;
      searchMovies(searchQuery);
    }
  }, [searchQuery, movies.length, isLoading, searchMovies]);

  const handleSearch = (query: string) => {
    if (query.trim()) {
      hasHydratedSearchRef.current = true;
      searchMovies(query);
      resetRestoration();
    } else {
      hasHydratedSearchRef.current = false;
      clearFilters();
      reset();
      resetRestoration();
    }
  };

  const handleFilterChange = () => {
    fetchMoviesFiltered(0, 200);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-background/80 backdrop-blur-xl">
        <div className="mx-auto max-w-[1500px] px-5 py-5 md:px-8">
          <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <button
                onClick={() => navigate(-1)}
                className="mb-4 inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-transparent px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:border-white/[0.16] hover:bg-white/[0.04] hover:text-foreground"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </button>
              <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                Precision search
              </div>
              <h1 className="mt-1.5 text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
                Find the right title in seconds
              </h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                Search, refine, and keep your place while you inspect details.
              </p>
            </div>

            <div className="flex gap-2">
              <div className="rounded-xl border border-white/[0.06] bg-card px-4 py-3">
                <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Results
                </div>
                <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
                  {movies.length}
                </div>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-card px-4 py-3">
                <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Refinement
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                  {isUsingFilters ? "Active" : "Idle"}
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-[280px] flex-1 md:max-w-[560px]">
              <SearchBar
                onSearch={handleSearch}
                placeholder="Search for movies, cast, or directors..."
                initialValue={searchQuery}
              />
            </div>
            <FilterSortBar viewMode="grid" onFilterChange={handleFilterChange} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-5 py-6 md:px-8 md:py-8">
        {hasSearched && (
          <section className="mb-6 flex flex-col gap-3 rounded-2xl border border-white/[0.06] bg-card p-5 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                Current query
              </div>
              <h2 className="mt-1.5 text-xl font-semibold text-foreground md:text-2xl">
                {searchQuery ? `"${searchQuery}"` : "Filtered search results"}
              </h2>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <div className="rounded-full border border-white/[0.06] bg-white/[0.03] px-3 py-1 text-muted-foreground tabular-nums">
                {movies.length} matches
              </div>
              {isUsingFilters && (
                <div className="rounded-full border border-white/[0.1] bg-white/[0.06] px-3 py-1 text-foreground">
                  Filters active
                </div>
              )}
            </div>
          </section>
        )}

        {isLoading ? (
          <EmptyState
            loading
            title="Scanning the catalogue"
            description="Matching titles, cast, and metadata against your query."
          />
        ) : hasSearched ? (
          movies.length > 0 ? (
            <MovieGrid ref={movieGridRef} movies={movies} onScroll={handleScroll} />
          ) : (
            <EmptyState
              title="No results landed for that search"
              description="Try a broader title, remove a filter, or search by actor or director to widen the net."
            />
          )
        ) : (
          <EmptyState
            title="Start typing to search your library"
            description="The search bar supports title, actor, and director matches, then lets you refine results without losing context."
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
}: {
  loading?: boolean;
  title: string;
  description: string;
}) {
  return (
    <div className="flex h-96 items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] text-center">
      <div className="max-w-md px-6">
        {loading && (
          <div className="mx-auto mb-4 h-6 w-6 animate-spin rounded-full border-2 border-white/15 border-t-foreground" />
        )}
        <p className="text-base font-medium text-foreground">{title}</p>
        <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
