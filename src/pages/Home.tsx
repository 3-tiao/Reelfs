import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Settings as SettingsIcon, Film } from "lucide-react";
import { useMovieStore } from "../stores/movieStore";
import MovieGrid from "../components/MovieGrid";
import ScanProgress from "../components/ScanProgress";
import SearchBar from "../components/SearchBar";
import { createLogger } from "../lib/logger";

const logger = createLogger('HomePage');

export default function Home() {
  const navigate = useNavigate();
  const { movies, isLoading, fetchMovies, searchMovies, reset } = useMovieStore();

  useEffect(() => {
    logger.debug('页面初始化，开始加载电影列表');
    fetchMovies(0);
  }, []);

  const handleSearch = (query: string) => {
    if (query.trim()) {
      logger.info('开始搜索:', query);
      searchMovies(query);
    } else {
      logger.info('清空搜索，重新加载完整列表');
      reset();
      fetchMovies(0);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950">
      <header className="sticky top-0 z-10 bg-gray-900/95 backdrop-blur-sm border-b border-gray-800">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Film className="w-8 h-8 text-blue-500" />
              <h1 className="text-2xl font-bold text-white">Reelfs</h1>
            </div>
            <button
              onClick={() => navigate("/settings")}
              className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
            >
              <SettingsIcon className="w-6 h-6 text-gray-400 hover:text-white" />
            </button>
          </div>
          <div className="flex justify-center">
            <SearchBar onSearch={handleSearch} />
          </div>
        </div>
      </header>

      <main className="p-4">
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

      <ScanProgress />
    </div>
  );
}
