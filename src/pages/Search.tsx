import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Search as SearchIcon, SlidersHorizontal } from "lucide-react";
import SearchBar from "../components/SearchBar";
import MovieGrid, { MovieGridRef } from "../components/MovieGrid";
import FilterSortBar from "../components/FilterSortBar";
import { useScrollRestoration } from "../hooks/useScrollRestoration";
import { useMovieStore } from "../stores/movieStore";

export default function Search() {
  const navigate = useNavigate();
  const { movies, isLoading, searchMovies, isUsingFilters, fetchMoviesFiltered, reset, clearFilters, searchQuery } = useMovieStore();
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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(20,184,166,0.09),transparent_18%),radial-gradient(circle_at_top_right,rgba(251,191,36,0.08),transparent_16%),linear-gradient(180deg,#09090b_0%,#0a1011_42%,#09090b_100%)] text-white">
      <header className="sticky top-0 z-10 border-b border-white/8 bg-zinc-950/70 backdrop-blur-2xl shadow-[0_18px_48px_rgba(0,0,0,0.22)]">
        <div className="mx-auto max-w-[1500px] px-5 py-5 md:px-8">
          <div className="rounded-[34px] border border-white/8 bg-[linear-gradient(140deg,rgba(24,24,27,0.78),rgba(14,20,22,0.9))] p-5 shadow-[0_24px_56px_rgba(0,0,0,0.24)] backdrop-blur-xl md:p-6">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-2xl">
                <button
                  onClick={() => navigate(-1)}
                  className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/[0.08] hover:text-white"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </button>
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl border border-teal-400/15 bg-teal-400/10 p-3 text-teal-200">
                    <SearchIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.26em] text-zinc-500">Precision search</div>
                    <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white md:text-4xl">Find the right title in seconds</h1>
                  </div>
                </div>
                <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-400 md:text-[15px]">
                  Search, refine, and keep your place while you inspect details. The result set stays fluid even when filters change.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:w-[360px]">
                <div className="rounded-[28px] border border-white/8 bg-white/[0.04] px-4 py-4 backdrop-blur-xl">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-500">Results</div>
                  <div className="mt-3 text-3xl font-semibold text-white">{movies.length}</div>
                </div>
                <div className="rounded-[28px] border border-white/8 bg-white/[0.04] px-4 py-4 backdrop-blur-xl">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-500">Refinement</div>
                  <div className="mt-3 flex items-center gap-2 text-lg font-semibold text-white">
                    <SlidersHorizontal className="h-4 w-4 text-amber-300" />
                    {isUsingFilters ? "Active" : "Idle"}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
              <div className="rounded-[28px] border border-white/8 bg-white/[0.03] p-4 backdrop-blur-xl">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-500">Query</div>
                <div className="max-w-[520px]">
                  <SearchBar onSearch={handleSearch} placeholder="Search for movies, cast, or directors..." initialValue={searchQuery} />
                </div>
              </div>
              <div className="rounded-[28px] border border-white/8 bg-white/[0.03] p-4 backdrop-blur-xl">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-500">Sort and refine</div>
                <FilterSortBar viewMode="grid" onFilterChange={handleFilterChange} />
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-5 py-6 md:px-8 md:py-8">
        {hasSearched && (
          <section className="mb-6 flex flex-col gap-4 rounded-[32px] border border-white/8 bg-[linear-gradient(135deg,rgba(24,24,27,0.55),rgba(14,20,22,0.72))] p-5 shadow-[0_24px_56px_rgba(0,0,0,0.18)] backdrop-blur-xl md:flex-row md:items-end md:justify-between md:p-6">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.26em] text-zinc-500">Current query</div>
              <h2 className="mt-2 text-2xl font-semibold text-white md:text-3xl">
                {searchQuery ? `“${searchQuery}”` : "Filtered search results"}
              </h2>
            </div>
            <div className="flex flex-wrap gap-3 text-sm">
              <div className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-zinc-200">{movies.length} matches</div>
              {isUsingFilters && <div className="rounded-full border border-amber-300/18 bg-amber-300/10 px-4 py-2 text-amber-100">Filters active</div>}
            </div>
          </section>
        )}

        {isLoading ? (
          <div className="flex h-96 items-center justify-center rounded-[34px] border border-white/8 bg-white/[0.03] text-center backdrop-blur-xl">
            <div>
              <div className="mx-auto mb-5 h-14 w-14 animate-spin rounded-full border-2 border-teal-300/20 border-t-teal-300"></div>
              <p className="text-base font-medium text-zinc-200">Scanning the catalogue</p>
              <p className="mt-2 text-sm text-zinc-500">Matching titles, cast, and metadata against your query.</p>
            </div>
          </div>
        ) : hasSearched ? (
          movies.length > 0 ? (
            <MovieGrid ref={movieGridRef} movies={movies} onScroll={handleScroll} />
          ) : (
            <div className="flex h-96 items-center justify-center rounded-[34px] border border-dashed border-white/10 bg-white/[0.02] text-center backdrop-blur-xl">
              <div className="max-w-md px-6">
                <p className="text-xl font-medium text-white">No results landed for that search</p>
                <p className="mt-3 text-sm leading-6 text-zinc-500">Try a broader title, remove a filter, or search by actor or director to widen the net.</p>
              </div>
            </div>
          )
        ) : (
          <div className="flex h-96 items-center justify-center rounded-[34px] border border-dashed border-white/10 bg-white/[0.02] text-center backdrop-blur-xl">
            <div className="max-w-md px-6">
              <p className="text-xl font-medium text-white">Start typing to search your library</p>
              <p className="mt-3 text-sm leading-6 text-zinc-500">The search bar supports title, actor, and director matches, then lets you refine results without losing context.</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
