import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import SearchBar from "../components/SearchBar";
import MovieGrid from "../components/MovieGrid";
import FilterBar from "../components/FilterBar";
import { useMovieStore } from "../stores/movieStore";

export default function Search() {
  const navigate = useNavigate();
  const { movies, isLoading, searchMovies, isUsingFilters, fetchMoviesFiltered } = useMovieStore();
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = (query: string) => {
    if (query.trim()) {
      searchMovies(query);
      setHasSearched(true);
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
            onClick={() => navigate("/")}
            className="flex items-center gap-2 mb-4 px-4 py-2 hover:bg-gray-800 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            Back
          </button>
          <div className="flex justify-center">
            <SearchBar onSearch={handleSearch} placeholder="Search for movies..." />
          </div>
        </div>
      </header>

      <main className="p-4">
        {hasSearched && (
          <>
            <FilterBar onFilterChange={handleFilterChange} />
            
            {isUsingFilters && (
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
            <MovieGrid movies={movies} />
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
