import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Settings as SettingsIcon } from "lucide-react";
import { useMovieStore } from "../stores/movieStore";
import MovieGrid from "../components/MovieGrid";
import SearchBar from "../components/SearchBar";
import FilterSortBar from "../components/FilterSortBar";
import ScrollProgress from "../components/ScrollProgress";
import { listen } from "@tauri-apps/api/event";

export default function Home() {
  const navigate = useNavigate();
  const { movies, isLoading, fetchMovies, searchMovies, reset, isUsingFilters, fetchMoviesFiltered, clearFilters } = useMovieStore();
  const [scrollPercentage, setScrollPercentage] = useState(0);

  useEffect(() => {
    fetchMovies(0);
  }, []);

  const handleSearch = (query: string) => {
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

  useEffect(() => {
    const unlistenPromise = listen('scan-progress', (event) => {
      if (event.payload) {
        const payload = event.payload as { current: number; total: number };
        const percentage = payload.total > 0 ? (payload.current / payload.total) * 100 : 0;
        setScrollPercentage(percentage);
      }
    });
    
    unlistenPromise.then(unlisten => {
      return () => {
        unlisten();
      };
    });
  }, []);

  return (
    <div className="min-h-screen bg-gray-950">
      <header className="sticky top-0 z-10 bg-gray-900/95 backdrop-blur-sm border-b border-gray-800">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <SearchBar onSearch={handleSearch} />
              <FilterSortBar onFilterChange={handleFilterChange} />
            </div>
            
            <button
              onClick={() => navigate("/settings")}
              className="p-2.5 hover:bg-gray-800 rounded-lg transition-colors"
            >
              <SettingsIcon className="w-4 h-4 text-gray-400 hover:text-white" />
            </button>
          </div>
        </div>
      </header>
      
      <main className="p-4">
        {isUsingFilters && (
          <div className="mb-4 text-gray-400 text-sm">
            筛选结果: {movies.length} 个电影
          </div>
        )}
        
        {isLoading ? (
          <div className="flex items-center justify-center h-96">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
              <p className="text-gray-400">Loading movies...</p>
            </div>
          </div>
        ) : (
          <MovieGrid movies={movies} />
        )}
      </main>
      
      <ScrollProgress total={movies.length} current={scrollPercentage} onScrollTo={() => {}} />
    </div>
  );
}
