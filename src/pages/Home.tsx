import { useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Settings as SettingsIcon, Eye, EyeOff, Grid, List } from "lucide-react";
import { useMovieStore } from "../stores/movieStore";
import { useNsfwStore } from "../stores/nsfwStore";
import { useViewStore } from "../stores/viewStore";
import MovieGrid, { MovieGridRef } from "../components/MovieGrid";
import MovieList, { MovieListRef } from "../components/MovieList";
import SearchBar from "../components/SearchBar";
import FilterSortBar from "../components/FilterSortBar";

export default function Home() {
  const navigate = useNavigate();
  const { 
    movies, 
    isLoading, 
    isLoadingMore,
    hasMore,
    fetchMovies, 
    loadMore,
    searchMovies, 
    reset, 
    isUsingFilters, 
    fetchMoviesFiltered, 
    clearFilters,
    scrollPosition,
    setScrollPosition
  } = useMovieStore();
  const { showThumbnails, toggleShowThumbnails } = useNsfwStore();
  const { viewMode, setViewMode } = useViewStore();
  const movieGridRef = useRef<MovieGridRef>(null);
  const movieListRef = useRef<MovieListRef>(null);
  
  // 保存滚动位置
  const lastSavedPositionRef = useRef(0);
  
  const handleScroll = useCallback(() => {
    const ref = viewMode === 'grid' ? movieGridRef.current : movieListRef.current;
    if (ref) {
      const position = ref.getScrollPosition();
      if (Math.abs(position - lastSavedPositionRef.current) > 100) {
        lastSavedPositionRef.current = position;
        setScrollPosition(position);
      }
    }
  }, [viewMode, setScrollPosition]);
  
  useEffect(() => {
    // 只在 movies 为空时才加载数据
    if (movies.length === 0) {
      fetchMovies(0);
    }
  }, []);
  
  // 恢复滚动位置 - 只在首次加载时执行
  const hasRestoredRef = useRef(false);
  
  useEffect(() => {
    if (scrollPosition > 0 && movies.length > 0 && !hasRestoredRef.current) {
      hasRestoredRef.current = true;
      // 需要等待渲染完成后恢复滚动位置
      requestAnimationFrame(() => {
        if (viewMode === 'grid' && movieGridRef.current) {
          movieGridRef.current.scrollToPosition(scrollPosition);
        } else if (viewMode === 'list' && movieListRef.current) {
          movieListRef.current.scrollToPosition(scrollPosition);
        }
      });
    }
  }, [movies.length, scrollPosition, viewMode]);

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

  return (
    <div className="min-h-screen bg-gray-950">
      <header className="sticky top-0 z-10 bg-gray-900/95 backdrop-blur-sm border-b border-gray-800">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <SearchBar onSearch={handleSearch} />
              <FilterSortBar onFilterChange={handleFilterChange} />
            </div>
            
            <div className="flex items-center gap-2">
              <div className="flex items-center bg-gray-800 rounded-lg p-1">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-2 rounded-lg transition-colors ${
                    viewMode === 'grid' 
                      ? 'bg-blue-600 text-white' 
                      : 'text-gray-400 hover:text-white'
                  }`}
                  title="网格视图"
                >
                  <Grid className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`p-2 rounded-lg transition-colors ${
                    viewMode === 'list' 
                      ? 'bg-blue-600 text-white' 
                      : 'text-gray-400 hover:text-white'
                  }`}
                  title="列表视图"
                >
                  <List className="w-4 h-4" />
                </button>
              </div>
              
              <button
                onClick={toggleShowThumbnails}
                className={`p-2.5 rounded-lg transition-colors ${
                  showThumbnails 
                    ? "bg-green-600/20 text-green-400 hover:bg-green-600/30" 
                    : "bg-red-600/20 text-red-400 hover:bg-red-600/30"
                }`}
                title={showThumbnails ? "显示缩略图" : "隐藏缩略图 (NSFW)"}
              >
                {showThumbnails ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              </button>
              
              <button
                onClick={() => navigate("/settings")}
                className="p-2.5 hover:bg-gray-800 rounded-lg transition-colors"
              >
                <SettingsIcon className="w-4 h-4 text-gray-400 hover:text-white" />
              </button>
            </div>
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
          <>
            {viewMode === 'grid' ? (
              <MovieGrid 
                ref={movieGridRef} 
                movies={movies} 
                onScroll={handleScroll}
                onLoadMore={loadMore}
              />
            ) : (
              <div style={{ height: 'calc(100vh - 180px)' }}>
                <MovieList 
                  ref={movieListRef}
                  movies={movies} 
                  onScroll={handleScroll}
                  onLoadMore={loadMore}
                />
              </div>
            )}
            {isLoadingMore && (
              <div className="flex items-center justify-center py-4">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
              </div>
            )}
            {!hasMore && movies.length > 0 && (
              <div className="text-center py-4 text-gray-400 text-sm">
                已加载全部 {movies.length} 个电影
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
