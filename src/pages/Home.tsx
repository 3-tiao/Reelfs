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
      
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-zinc-950/70 border-b border-zinc-800/50 shadow-2xl transition-all duration-300">
        <div className="px-6 py-4 max-w-[1600px] mx-auto">
          <div className="flex flex-col md:flex-row items-center gap-4 md:gap-8">
            <div className="flex items-center gap-2 w-full md:w-auto">
              <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-zinc-100 to-zinc-400 tracking-tight">Reelfs</h1>
              <span className="text-zinc-500 text-xs font-medium ml-1 flex-shrink-0 px-2 py-0.5 rounded-full bg-zinc-800/50 border border-zinc-700/50 hidden lg:inline-block">NAS Movie Browser</span>
            </div>
            
            <div className="flex items-center gap-4 w-full md:w-auto flex-1">
              <div className="w-full md:w-[320px]">
                <SearchBar onSearch={handleSearch} />
              </div>
              <FilterSortBar onFilterChange={handleFilterChange} />
              
              <div className="flex items-center gap-4 ml-4">
                <div className="flex items-center gap-1.5 bg-zinc-900/60 p-1.5 rounded-xl border border-zinc-800/60 shadow-inner">
                  <button
                    onClick={() => setViewMode('grid')}
                    className={`p-2 rounded-lg transition-all duration-300 ${
                      viewMode === 'grid' 
                        ? 'bg-zinc-800 text-teal-400 shadow-md scale-105' 
                        : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                    }`}
                    title="Grid View"
                  >
                    <Grid className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setViewMode('list')}
                    className={`p-2 rounded-lg transition-all duration-300 ${
                      viewMode === 'list' 
                        ? 'bg-zinc-800 text-teal-400 shadow-md scale-105' 
                        : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                    }`}
                    title="List View"
                  >
                    <List className="w-4 h-4" />
                  </button>
                </div>

                <div className="w-px h-8 bg-zinc-800/50 mx-1 hidden md:block"></div>
                
                <button
                  onClick={toggleShowThumbnails}
                  className={`p-2.5 rounded-xl transition-all duration-300 border shadow-sm flex-shrink-0 ${
                    showThumbnails 
                      ? 'bg-zinc-800 text-teal-400 border-zinc-700 hover:bg-zinc-700' 
                      : 'bg-zinc-900/80 text-zinc-500 border-zinc-800/80 hover:text-zinc-300 hover:bg-zinc-800'
                  }`}
                  title={showThumbnails ? "Hide NSFW Thumbnails" : "Show NSFW Thumbnails"}
                >
                  {showThumbnails ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
                </button>
              </div>

              <div className="flex-1 hidden md:block"></div>

              <button
                onClick={() => navigate("/settings")}
                className="p-2.5 bg-zinc-900/80 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-xl transition-all duration-300 border border-zinc-800/80 flex-shrink-0 shadow-sm hover:shadow-md hover:border-zinc-700"
                title="Settings"
              >
                <SettingsIcon className="w-5 h-5" />
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
