import { useEffect, useRef, useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Settings as SettingsIcon, Eye, EyeOff, Grid, List } from "lucide-react";
import { useMovieStore } from "../stores/movieStore";
import { useNsfwStore } from "../stores/nsfwStore";
import { useViewStore } from "../stores/viewStore";
import MovieGrid, { MovieGridRef } from "../components/MovieGrid";
import MovieList, { MovieListRef } from "../components/MovieList";
import SearchBar from "../components/SearchBar";
import FilterSortBar from "../components/FilterSortBar";
import ScrollProgressVertical from "../components/ScrollProgressVertical";

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
    scrollPosition,
    setScrollPosition
  } = useMovieStore();
  const { showThumbnails, toggleShowThumbnails } = useNsfwStore();
  const { viewMode, setViewMode } = useViewStore();
  const movieGridRef = useRef<MovieGridRef>(null);
  const movieListRef = useRef<MovieListRef>(null);
  const [scrollProgress, setScrollProgress] = useState(0);
  
  // 保存滚动位置
  const lastSavedPositionRef = useRef(0);
  
  const handleScroll = useCallback(() => {
    const ref = viewMode === 'grid' ? movieGridRef.current : movieListRef.current;
    if (ref) {
      const position = ref.getScrollPosition();
      const progress = ref.getScrollPercentage();
      setScrollProgress(progress);
      
      if (Math.abs(position - lastSavedPositionRef.current) > 100) {
        lastSavedPositionRef.current = position;
        setScrollPosition(position);
      }
    }
  }, [viewMode, setScrollPosition]);

  const handleSeek = useCallback((percentage: number) => {
    const ref = viewMode === 'grid' ? movieGridRef.current : movieListRef.current;
    if (ref) {
      ref.scrollToPercentage(percentage);
      setScrollProgress(percentage);
    }
  }, [viewMode]);
  
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
    <div className="min-h-screen bg-gradient-to-b from-zinc-950 to-zinc-900">
      <ScrollProgressVertical progress={scrollProgress} onSeek={handleSeek} />
      
      <header className="sticky top-0 z-10 bg-zinc-900/95 backdrop-blur-sm border-b border-zinc-800">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <SearchBar onSearch={handleSearch} />
              <FilterSortBar onFilterChange={handleFilterChange} />
            </div>
            
            <div className="flex items-center gap-2">
              <div className="flex items-center bg-zinc-800 rounded-lg p-1">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-2 rounded-lg transition-all ${
                    viewMode === 'grid' 
                      ? 'bg-gradient-to-r from-teal-500 to-teal-600 text-white shadow-lg shadow-teal-500/25' 
                      : 'text-zinc-400 hover:text-white hover:bg-zinc-700/50'
                  }`}
                  title="网格视图"
                >
                  <Grid className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`p-2 rounded-lg transition-all ${
                    viewMode === 'list' 
                      ? 'bg-gradient-to-r from-teal-500 to-teal-600 text-white shadow-lg shadow-teal-500/25' 
                      : 'text-zinc-400 hover:text-white hover:bg-zinc-700/50'
                  }`}
                  title="列表视图"
                >
                  <List className="w-4 h-4" />
                </button>
              </div>
              
              <button
                onClick={toggleShowThumbnails}
                className={`p-2.5 rounded-lg transition-all border ${
                  showThumbnails 
                    ? "bg-teal-600/20 text-teal-400 hover:bg-teal-600/30 border-teal-500/30" 
                    : "bg-red-600/20 text-red-400 hover:bg-red-600/30 border-red-500/30"
                }`}
                title={showThumbnails ? "显示缩略图" : "隐藏缩略图 (NSFW)"}
              >
                {showThumbnails ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              </button>
              
              <button
                onClick={() => navigate("/settings")}
                className="p-2.5 hover:bg-zinc-800 rounded-lg transition-colors"
              >
                <SettingsIcon className="w-4 h-4 text-zinc-400 hover:text-white" />
              </button>
            </div>
          </div>
        </div>
      </header>
      
      <main className="p-4">
        {isUsingFilters && (
          <div className="mb-4 text-zinc-400 text-sm">
            筛选结果: {movies.length} 个电影
          </div>
        )}
        
        {isLoading ? (
          <div className="flex items-center justify-center h-96">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-400 mx-auto mb-4"></div>
              <p className="text-zinc-400">Loading movies...</p>
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
              <MovieList 
                ref={movieListRef}
                movies={movies} 
                onScroll={handleScroll}
                onLoadMore={loadMore}
              />
            )}
            {isLoadingMore && (
              <div className="flex items-center justify-center py-4">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-400"></div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
