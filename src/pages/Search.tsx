import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import SearchBar from "../components/SearchBar";
import MovieGrid from "../components/MovieGrid";
import { useMovieStore } from "../stores/movieStore";
import { createLogger } from "../lib/logger";
import SearchManager from "../lib/searchManager";

const logger = createLogger('SearchPage');
const searchManager = new SearchManager();

interface SearchState {
  query: string;
  lastQuery: string;
  isSearching: boolean;
  hasSearched: boolean;
  error: string | null;
  lastSearchTime: number;
}

export default function Search() {
  const navigate = useNavigate();
  const { movies, searchMovies, reset, fetchMovies } = useMovieStore();
  const [state, setState] = useState<SearchState>({
    query: '',
    lastQuery: '',
    isSearching: false,
    hasSearched: false,
    error: null,
    lastSearchTime: 0,
  });

  const handleSearch = (query: string) => {
    setState(prev => ({ ...prev, query }));

    searchManager.search(query, async (searchQuery) => {
      if (!searchQuery.trim()) {
        logger.info('清空搜索，重新加载完整列表');
        reset();
        fetchMovies(0);
        setState(prev => ({
          ...prev,
          isSearching: false,
          hasSearched: false,
          error: null,
        }));
        return;
      }

      if (searchQuery === state.lastQuery) {
        logger.debug('搜索词未变化，跳过搜索');
        return;
      }

      logger.info('开始搜索:', searchQuery);
      setState(prev => ({
        ...prev,
        isSearching: true,
        lastQuery: searchQuery,
        lastSearchTime: Date.now(),
        error: null,
      }));

      try {
        await searchMovies(searchQuery);
        logger.info('搜索完成');
        
        setState(prev => ({
          ...prev,
          isSearching: false,
          hasSearched: true,
          error: null,
        }));
      } catch (error) {
        logger.error('搜索失败:', error);
        setState(prev => ({
          ...prev,
          isSearching: false,
          hasSearched: true,
          error: String(error),
        }));
      }
    });
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
        {state.isSearching ? (
          <div className="flex items-center justify-center h-96">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
              <p className="text-gray-400">Searching...</p>
            </div>
          </div>
        ) : state.query.trim() ? (
          movies.length > 0 ? (
            <MovieGrid movies={movies} />
          ) : state.error ? (
            <div className="flex items-center justify-center h-96">
              <p className="text-red-400 text-lg">{state.error}</p>
            </div>
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
