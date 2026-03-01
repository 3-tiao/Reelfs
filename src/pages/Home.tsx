import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Settings as SettingsIcon, Eye, EyeOff } from "lucide-react";
import { useMovieStore } from "../stores/movieStore";
import { useNsfwStore } from "../stores/nsfwStore";
import MovieGrid, { MovieGridRef } from "../components/MovieGrid";
import SearchBar from "../components/SearchBar";
import FilterSortBar from "../components/FilterSortBar";
import ScrollProgress from "../components/ScrollProgress";

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
  const movieGridRef = useRef<MovieGridRef>(null);
  const [scrollInfo, setScrollInfo] = useState({ 
    thumbHeight: 0, 
    thumbPosition: 0,
    totalCount: 0,
    currentIndex: 0
  });
  
  useEffect(() => {
    // 只在 movies 为空时才加载数据
    if (movies.length === 0) {
      fetchMovies(0);
    }
  }, []);
  
  // 恢复滚动位置
  useEffect(() => {
    if (scrollPosition > 0 && movies.length > 0) {
      // 需要等待 Grid 渲染完成
      const timer = setTimeout(() => {
        if (movieGridRef.current) {
          movieGridRef.current.scrollToPosition(scrollPosition);
        }
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [movies.length, scrollPosition]);

  // 保存滚动位置 - 使用 useLayoutEffect 确保在导航前保存
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (movieGridRef.current) {
        const position = movieGridRef.current.getScrollPosition();
        setScrollPosition(position);
      }
    };
    
    return () => {
      handleBeforeUnload();
    };
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

  const handleScrollTo = (percentage: number) => {
    if (movieGridRef.current) {
      movieGridRef.current.scrollToPercentage(percentage);
    }
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
            <MovieGrid 
              ref={movieGridRef} 
              movies={movies} 
              onScroll={setScrollInfo}
              onLoadMore={loadMore}
            />
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
      
      <ScrollProgress 
        thumbHeight={scrollInfo.thumbHeight}
        thumbPosition={scrollInfo.thumbPosition}
        totalCount={scrollInfo.totalCount}
        currentIndex={scrollInfo.currentIndex}
        onScrollTo={handleScrollTo} 
      />
    </div>
  );
}
