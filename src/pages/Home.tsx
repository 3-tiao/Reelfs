import { useEffect, useRef, useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Settings as SettingsIcon, Eye, EyeOff, Grid, List, Users } from "lucide-react";
import { useMovieStore } from "../stores/movieStore";
import { useNsfwStore } from "../stores/nsfwStore";
import { useViewStore } from "../stores/viewStore";
import MovieGrid, { MovieGridRef } from "../components/MovieGrid";
import MovieList, { MovieListRef } from "../components/MovieList";
import ActorGrid, { ActorGridRef } from "../components/ActorGrid";
import SearchBar from "../components/SearchBar";
import FilterSortBar from "../components/FilterSortBar";
import ScrollProgressVertical from "../components/ScrollProgressVertical";
import { ActorInfo, getActorsWithCounts } from "../services/tauri";

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
    setScrollPosition,
    setScrollProgress: saveScrollProgress,
    hasMore,
    searchQuery,
  } = useMovieStore();
  const { showThumbnails, toggleShowThumbnails } = useNsfwStore();
  const { viewMode, setViewMode } = useViewStore();
  const movieGridRef = useRef<MovieGridRef>(null);
  const movieListRef = useRef<MovieListRef>(null);
  const [scrollProgress, setScrollProgress] = useState(0);
  const actorGridRef = useRef<ActorGridRef>(null);
  const [actors, setActors] = useState<ActorInfo[]>([]);
  const [isLoadingActors, setIsLoadingActors] = useState(false);
  const activeScrollKey = `home:${viewMode}`;

  const getActiveScrollRef = useCallback(() => {
    if (viewMode === 'grid') {
      return movieGridRef.current;
    }

    if (viewMode === 'list') {
      return movieListRef.current;
    }

    if (viewMode === 'actors') {
      return actorGridRef.current;
    }

    return null;
  }, [viewMode]);

  const getActiveItemCount = useCallback(() => {
    if (viewMode === 'actors') {
      return actors.length;
    }

    return movies.length;
  }, [viewMode, actors.length, movies.length]);

  const syncScrollProgressFromRef = useCallback(() => {
    const ref = getActiveScrollRef();
    if (ref) {
      setScrollProgress(ref.getScrollPercentage());
    }
  }, [getActiveScrollRef]);
  
  // 加载演员数据
  useEffect(() => {
    if (viewMode === 'actors' && actors.length === 0) {
      setIsLoadingActors(true);
      getActorsWithCounts()
        .then(data => {
          setActors(data);
          setIsLoadingActors(false);
        })
        .catch(() => setIsLoadingActors(false));
    }
  }, [viewMode]);
  
  // 保存滚动位置
  const lastSavedPositionRef = useRef(0);
  
  // 恢复滚动位置 - 只在首次加载且数据准备好时执行一次
  const restoredKeyRef = useRef<string | null>(null);
  const isRestoringRef = useRef(false);
  
  useEffect(() => {
    const activeItemCount = getActiveItemCount();
    const savedScrollPos = useMovieStore.getState().scrollPositions[activeScrollKey] || 0;
    const savedProgress = useMovieStore.getState().scrollProgresses[activeScrollKey] || 0;

    if (activeItemCount > 0 && restoredKeyRef.current !== activeScrollKey) {
      restoredKeyRef.current = activeScrollKey;
      isRestoringRef.current = true;
      lastSavedPositionRef.current = savedScrollPos;
      setScrollProgress(savedProgress);
      
      // 需要等待渲染完成后恢复滚动位置
      requestAnimationFrame(() => {
        const ref = getActiveScrollRef();
        if (ref) {
          ref.scrollToPosition(savedScrollPos);
        }
        
        // 恢复完成后延迟关闭标志，避免处理恢复过程中产生的滚动事件
        setTimeout(() => {
          syncScrollProgressFromRef();
          isRestoringRef.current = false;
        }, 100);
      });
    } else if (activeItemCount > 0) {
      requestAnimationFrame(() => {
        syncScrollProgressFromRef();
      });
    }
  }, [activeScrollKey, getActiveItemCount, getActiveScrollRef, syncScrollProgressFromRef]);

  const handleScroll = useCallback(() => {
    if (isRestoringRef.current) return;
    
    const ref = getActiveScrollRef();
    if (ref) {
      const position = ref.getScrollPosition();
      const progress = ref.getScrollPercentage();
      setScrollProgress(progress);
      
      if (Math.abs(position - lastSavedPositionRef.current) > 100) {
        lastSavedPositionRef.current = position;
        setScrollPosition(activeScrollKey, position);
      }

      saveScrollProgress(activeScrollKey, progress);
    }
  }, [activeScrollKey, getActiveScrollRef, setScrollPosition, saveScrollProgress]);

  const handleSeek = useCallback((percentage: number) => {
    const ref = getActiveScrollRef();
    if (ref) {
      ref.scrollToPercentage(percentage);
      setScrollProgress(percentage);
      saveScrollProgress(activeScrollKey, percentage);
    }
  }, [activeScrollKey, getActiveScrollRef, saveScrollProgress]);

  useEffect(() => {
    setScrollProgress(useMovieStore.getState().scrollProgresses[activeScrollKey] || 0);
  }, [activeScrollKey]);
  
  useEffect(() => {
    // 只在 movies 为空时才加载数据
    if (movies.length === 0) {
      fetchMovies(0);
    }
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

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-950 to-zinc-900">
      <ScrollProgressVertical progress={scrollProgress} onSeek={handleSeek} />
      
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-zinc-950/70 border-b border-zinc-800/50 shadow-2xl transition-all duration-300">
        <div className="px-8 py-4 w-full">
          <div className="flex flex-col md:flex-row items-center gap-4 md:gap-8">
            <div className="flex items-center gap-2 w-full md:w-auto">
              <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-zinc-100 to-zinc-400 tracking-tight">Reelfs</h1>
              <span className="text-zinc-500 text-xs font-medium ml-1 flex-shrink-0 px-2 py-0.5 rounded-full bg-zinc-800/50 border border-zinc-700/50 hidden lg:inline-block">NAS Movie Browser</span>
            </div>
            
            <div className="flex items-center gap-4 w-full md:w-auto flex-1">
              <div className="w-full md:w-[320px]">
                <SearchBar onSearch={handleSearch} initialValue={searchQuery} />
              </div>
              <FilterSortBar onFilterChange={handleFilterChange} />
              
              <div className="flex-1 hidden md:block"></div>

              <div className="flex items-center gap-3">
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
                  <button
                    onClick={() => setViewMode('actors')}
                    className={`p-2 rounded-lg transition-all duration-300 ${
                      viewMode === 'actors' 
                        ? 'bg-zinc-800 text-violet-400 shadow-md scale-105' 
                        : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                    }`}
                    title="Actor View"
                  >
                    <Users className="w-4 h-4" />
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
        </div>
      </header>
      
      <main className="px-8 py-4">
        {viewMode === 'actors' ? (
          <>
            <div className="mb-4 text-zinc-400 text-sm">
              共 {actors.length} 位演员
            </div>
            {isLoadingActors ? (
              <div className="flex items-center justify-center h-96">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-violet-400 mx-auto mb-4"></div>
                  <p className="text-zinc-400">Loading actors...</p>
                </div>
              </div>
            ) : (
              <ActorGrid ref={actorGridRef} actors={actors} onScroll={handleScroll} />
            )}
          </>
        ) : (
          <>
            {searchQuery && (
              <div className="mb-4 text-zinc-300 text-sm">
                搜索 “<span className="text-white font-medium">{searchQuery}</span>” 共 {movies.length} 个结果
              </div>
            )}

            {isUsingFilters && !searchQuery && (
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
                    onLoadMore={hasMore ? loadMore : undefined}
                  />
                ) : (
                  <MovieList 
                    ref={movieListRef}
                    movies={movies} 
                    onScroll={handleScroll}
                    onLoadMore={hasMore ? loadMore : undefined}
                  />
                )}
                {isLoadingMore && (
                  <div className="flex items-center justify-center py-4">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-400"></div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
