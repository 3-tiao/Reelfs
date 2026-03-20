import { useState, useCallback, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import SearchBar from "../components/SearchBar";
import MovieGrid, { MovieGridRef } from "../components/MovieGrid";
import FilterSortBar from "../components/FilterSortBar";
import { useMovieStore } from "../stores/movieStore";

export default function Search() {
  const navigate = useNavigate();
  const { movies, isLoading, searchMovies, isUsingFilters, fetchMoviesFiltered, setScrollPosition, reset, clearFilters, searchQuery } = useMovieStore();
  const [hasSearched, setHasSearched] = useState(Boolean(searchQuery) || isUsingFilters);
  const movieGridRef = useRef<MovieGridRef>(null);
  const lastSavedPositionRef = useRef(0);
  const hasRestoredRef = useRef(false);
  const isRestoringRef = useRef(false);
  const hasHydratedSearchRef = useRef(false);

  useEffect(() => {
    setHasSearched(Boolean(searchQuery) || isUsingFilters);
  }, [searchQuery, isUsingFilters]);

  useEffect(() => {
    if (searchQuery && movies.length === 0 && !isLoading && !hasHydratedSearchRef.current) {
      hasHydratedSearchRef.current = true;
      searchMovies(searchQuery);
    }
  }, [searchQuery, movies.length, isLoading, searchMovies]);

  // 保存滚动位置
  const handleScroll = useCallback(() => {
    if (isRestoringRef.current) return;
    
    if (movieGridRef.current) {
      const position = movieGridRef.current.getScrollPosition();
      if (Math.abs(position - lastSavedPositionRef.current) > 100) {
        lastSavedPositionRef.current = position;
        setScrollPosition("search", position);
      }
    }
  }, [setScrollPosition]);

  // 恢复滚动位置
  useEffect(() => {
    const searchScrollPos = useMovieStore.getState().scrollPositions["search"] || 0;
    if (searchScrollPos > 0 && movies.length > 0 && !isLoading && !hasRestoredRef.current) {
      hasRestoredRef.current = true;
      isRestoringRef.current = true;
      
      requestAnimationFrame(() => {
        if (movieGridRef.current) {
          movieGridRef.current.scrollToPosition(searchScrollPos);
        }
        setTimeout(() => {
          isRestoringRef.current = false;
        }, 100);
      });
    }
  }, [movies.length, isLoading]);

  const handleSearch = (query: string) => {
    if (query.trim()) {
      hasHydratedSearchRef.current = true;
      searchMovies(query);
      hasRestoredRef.current = false; // Reset on new search
    } else {
      hasHydratedSearchRef.current = false;
      clearFilters();
      reset();
    }
  };

  const handleFilterChange = () => {
    fetchMoviesFiltered(0, 200);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="sticky top-0 z-10 bg-gray-900 border-b border-gray-800">
        <div className="px-6 py-4">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 mb-4 px-4 py-2 hover:bg-gray-800 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            Back
          </button>
          <div className="flex justify-center">
            <SearchBar onSearch={handleSearch} placeholder="Search for movies..." initialValue={searchQuery} />
          </div>
        </div>
      </header>

      <main className="p-4">
        {hasSearched && (
          <>
            <FilterSortBar onFilterChange={handleFilterChange} />

            {searchQuery && (
              <div className="mt-4 mb-2 text-gray-300 text-sm">
                搜索 “<span className="text-white font-medium">{searchQuery}</span>” 共 {movies.length} 个结果
              </div>
            )}
            
            {isUsingFilters && !searchQuery && (
              <div className="mb-4 text-gray-400 text-sm">
                筛选结果: {movies.length} 个电影
              </div>
            )}
          </>
        )}
        
        {isLoading ? (
          <div className="flex items-center justify-center h-96">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
              <p className="text-gray-400">Searching...</p>
            </div>
          </div>
        ) : hasSearched ? (
          movies.length > 0 ? (
            <MovieGrid ref={movieGridRef} movies={movies} onScroll={handleScroll} />
          ) : (
            <div className="flex items-center justify-center h-96">
              <p className="text-gray-400 text-lg">No results found</p>
            </div>
          )
        ) : (
          <div className="flex items-center justify-center h-96">
            <p className="text-gray-400 text-lg">Start typing to search for movies</p>
          </div>
        )}
      </main>
    </div>
  );
}
