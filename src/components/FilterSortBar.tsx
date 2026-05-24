import { useState, useEffect, useRef, useCallback } from "react";
import { ArrowUpDown, Filter, ChevronDown, ChevronUp, Film, Calendar, Star, Clock, User, Eye, EyeOff } from "lucide-react";
import { useMovieStore } from "../stores/movieStore";
import { useViewStore } from "../stores/viewStore";
import { Filters, SortOptions } from "../services/tauri";

interface FilterSortBarProps {
  viewMode: 'grid' | 'list' | 'actors';
  onFilterChange: () => void;
}

const movieSortOptions = [
  { value: 'title', label: '名称', icon: Film },
  { value: 'year', label: '年份', icon: Calendar },
  { value: 'rating', label: '评分', icon: Star },
  { value: 'added_at', label: '添加时间', icon: Clock },
  { value: 'last_accessed', label: '播放次数', icon: User },
];

const actorSortOptions = [
  { value: 'name', label: '姓名', icon: User },
  { value: 'movie_count', label: '作品数', icon: Film },
];

export default function FilterSortBar({ viewMode, onFilterChange }: FilterSortBarProps) {
  const {
    filters,
    sortOptions,
    availableGenres,
    availableActors,
    setFilters,
    setSortOptions,
    clearFilters,
    fetchAvailableGenres,
    fetchAvailableActors,
  } = useMovieStore();

  const {
    actorSortBy,
    actorSortOrder,
    setActorSortBy,
    setActorSortOrder,
  } = useViewStore();

  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement>(null);
  const filterMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (viewMode === "actors") return;
    if (availableGenres.length === 0) {
      fetchAvailableGenres();
    }
    if (availableActors.length === 0) {
      fetchAvailableActors();
    }
  }, [viewMode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(event.target as Node)) {
        setSortMenuOpen(false);
      }
      if (filterMenuRef.current && !filterMenuRef.current.contains(event.target as Node)) {
        setFilterMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleMovieSortChange = (sortBy: SortOptions['sortBy']) => {
    const newSortOptions: SortOptions = { ...sortOptions, sortBy };
    setSortOptions(newSortOptions);
    setSortMenuOpen(false);
    onFilterChange();
  };

  const handleActorSortChange = (sortBy: 'name' | 'movie_count') => {
    setActorSortBy(sortBy);
    setSortMenuOpen(false);
  };

  const handleSortOrderToggle = () => {
    if (viewMode === "actors") {
      setActorSortOrder(actorSortOrder === 'ASC' ? 'DESC' : 'ASC');
    } else {
      const newSortOrder: 'ASC' | 'DESC' = sortOptions.sortOrder === 'ASC' ? 'DESC' : 'ASC';
      const newSortOptions: SortOptions = { ...sortOptions, sortOrder: newSortOrder };
      setSortOptions(newSortOptions);
      onFilterChange();
    }
  };

  const handleFilterChange = useCallback(
    (key: keyof Filters, value: any) => {
      const newFilters = { ...filters, [key]: value };
      setFilters(newFilters);
      
      const timer = setTimeout(() => {
        onFilterChange();
      }, 300);
      
      return () => clearTimeout(timer);
    },
    [filters, setFilters, onFilterChange]
  );

  const handleClearFilters = () => {
    clearFilters();
    setFilterMenuOpen(false);
    onFilterChange();
  };

  const hasActiveFilters = () => {
    return Object.keys(filters).some(key => {
      const value = filters[key as keyof Filters];
      return value !== undefined && value !== null && value !== '';
    }) || filters.isWatched !== undefined;
  };

  const getSortLabel = () => {
    if (viewMode === "actors") {
      const option = actorSortOptions.find(opt => opt.value === actorSortBy);
      return option ? option.label : '排序';
    }
    const option = movieSortOptions.find(opt => opt.value === sortOptions.sortBy);
    return option ? option.label : '排序';
  };

  const currentSortOrder = viewMode === "actors" ? actorSortOrder : sortOptions.sortOrder;

  const activeFilterCount = [
    filters.minYear,
    filters.maxYear,
    filters.minRating,
    filters.maxRating,
    filters.actors,
    filters.genres,
    filters.isWatched,
  ].filter((value) => value !== undefined && value !== null && value !== '').length;

  return (
    <div className="flex items-center gap-2.5">
      <div className="relative" ref={sortMenuRef}>
        <button
          onClick={() => setSortMenuOpen(!sortMenuOpen)}
          className="flex items-center gap-2 rounded-2xl border border-zinc-800/80 bg-[linear-gradient(135deg,rgba(39,39,42,0.82),rgba(17,24,24,0.82))] px-4 py-2.5 text-white shadow-[0_14px_32px_rgba(0,0,0,0.2)] transition-all duration-200 hover:border-zinc-700 hover:bg-[linear-gradient(135deg,rgba(39,39,42,0.9),rgba(18,30,29,0.88))]"
        >
          <ArrowUpDown className={`w-4 h-4 flex-shrink-0 ${viewMode === "actors" ? "text-amber-300" : "text-teal-300"}`} />
          <span className="text-sm font-medium whitespace-nowrap">{getSortLabel()}</span>
          <ChevronDown className={`w-4 h-4 flex-shrink-0 text-zinc-400 transition-transform duration-200 ${sortMenuOpen ? 'rotate-180' : ''}`} />
        </button>

        {sortMenuOpen && (
          <div className="absolute top-full left-0 z-50 mt-3 min-w-[240px] rounded-[26px] border border-zinc-800/80 bg-[linear-gradient(160deg,rgba(24,24,27,0.98),rgba(16,23,24,0.96))] p-3 shadow-[0_28px_56px_rgba(0,0,0,0.38)] backdrop-blur-2xl">
            <div className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-zinc-500">排序方式</div>
            <div className="space-y-1.5">
              {(viewMode === "actors" ? actorSortOptions : movieSortOptions).map((option) => {
                const Icon = option.icon;
                const isActive = viewMode === "actors"
                  ? actorSortBy === option.value
                  : sortOptions.sortBy === option.value;
                return (
                  <button
                    key={option.value}
                    onClick={() => {
                      if (viewMode === "actors") {
                        handleActorSortChange(option.value as 'name' | 'movie_count');
                      } else {
                        handleMovieSortChange(option.value as SortOptions['sortBy']);
                      }
                    }}
                    className={`w-full rounded-2xl px-3 py-3 text-left transition-all duration-200 ${
                      isActive ? 'bg-teal-950/80 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]' : 'text-zinc-300 hover:bg-zinc-900/80'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`rounded-xl border p-2 ${isActive ? 'border-teal-900 bg-teal-950/70 text-teal-200' : 'border-zinc-800/80 bg-zinc-900/70 text-zinc-500'}`}>
                        <Icon className="w-4 h-4 flex-shrink-0" />
                      </div>
                      <span className="text-sm font-medium whitespace-nowrap">{option.label}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <button
        onClick={handleSortOrderToggle}
        className="flex items-center gap-2 rounded-2xl border border-zinc-800/80 bg-[linear-gradient(135deg,rgba(39,39,42,0.82),rgba(17,24,24,0.82))] px-4 py-2.5 text-zinc-200 shadow-[0_14px_32px_rgba(0,0,0,0.2)] transition-all duration-200 hover:border-zinc-700 hover:bg-zinc-800/80"
        title={currentSortOrder === 'ASC' ? '当前正序，点击切换为逆序' : '当前逆序，点击切换为正序'}
      >
        {currentSortOrder === 'ASC' ? (
          <>
            <ChevronUp className={`w-4 h-4 flex-shrink-0 ${viewMode === "actors" ? "text-amber-300" : "text-teal-300"}`} />
            <span className="text-sm font-medium whitespace-nowrap">正序</span>
          </>
        ) : (
          <>
            <ChevronDown className={`w-4 h-4 flex-shrink-0 ${viewMode === "actors" ? "text-amber-300" : "text-teal-300"}`} />
            <span className="text-sm font-medium whitespace-nowrap">逆序</span>
          </>
        )}
      </button>

      {viewMode !== "actors" && (
        <div className="relative" ref={filterMenuRef}>
          <button
            onClick={() => setFilterMenuOpen(!filterMenuOpen)}
             className={`flex items-center gap-2 rounded-2xl border px-4 py-2.5 transition-all duration-200 shadow-[0_14px_32px_rgba(0,0,0,0.2)] ${
               hasActiveFilters()
               ? 'border-teal-900 bg-teal-950/70 text-white hover:bg-teal-950'
               : 'border-zinc-800/80 bg-[linear-gradient(135deg,rgba(39,39,42,0.82),rgba(17,24,24,0.82))] text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800/80'
            }`}
          >
            <Filter className="w-4 h-4 flex-shrink-0" />
            <span className="text-sm font-medium">筛选</span>
            {hasActiveFilters() && (
               <div className="flex h-5 min-w-5 items-center justify-center rounded-full bg-teal-200 px-1.5 text-[11px] font-bold text-zinc-950">
               {activeFilterCount}
             </div>
           )}
          </button>

          {filterMenuOpen && (
            <div className="absolute top-full left-0 z-50 mt-3 min-w-[320px] rounded-[28px] border border-zinc-800/80 bg-[linear-gradient(160deg,rgba(24,24,27,0.98),rgba(16,23,24,0.96))] p-5 shadow-[0_28px_56px_rgba(0,0,0,0.38)] backdrop-blur-2xl">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-zinc-500">筛选器</div>
                  <div className="mt-1 text-sm text-zinc-400">精炼库里的结果</div>
                </div>
                {hasActiveFilters() && (
                  <button
                    onClick={handleClearFilters}
                    className="rounded-full border border-rose-400/20 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-200 transition-colors hover:bg-rose-500/18"
                  >
                    清空
                  </button>
                )}
              </div>
              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">年份范围</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      placeholder="最小年份"
                      value={filters.minYear || ''}
                      onChange={(e) => handleFilterChange('minYear', e.target.value ? parseInt(e.target.value) : undefined)}
                      className="flex-1 rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-2.5 text-sm text-white outline-none transition-colors placeholder:text-zinc-500 focus:border-teal-400/35 focus:ring-2 focus:ring-teal-400/12"
                    />
                    <input
                      type="number"
                      placeholder="最大年份"
                      value={filters.maxYear || ''}
                      onChange={(e) => handleFilterChange('maxYear', e.target.value ? parseInt(e.target.value) : undefined)}
                      className="flex-1 rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-2.5 text-sm text-white outline-none transition-colors placeholder:text-zinc-500 focus:border-teal-400/35 focus:ring-2 focus:ring-teal-400/12"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">评分范围</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      placeholder="最小评分"
                      min="0"
                      max="10"
                      step="0.1"
                      value={filters.minRating || ''}
                      onChange={(e) => handleFilterChange('minRating', e.target.value ? parseFloat(e.target.value) : undefined)}
                      className="flex-1 rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-2.5 text-sm text-white outline-none transition-colors placeholder:text-zinc-500 focus:border-teal-400/35 focus:ring-2 focus:ring-teal-400/12"
                    />
                    <input
                      type="number"
                      placeholder="最大评分"
                      min="0"
                      max="10"
                      step="0.1"
                      value={filters.maxRating || ''}
                      onChange={(e) => handleFilterChange('maxRating', e.target.value ? parseFloat(e.target.value) : undefined)}
                      className="flex-1 rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-2.5 text-sm text-white outline-none transition-colors placeholder:text-zinc-500 focus:border-teal-400/35 focus:ring-2 focus:ring-teal-400/12"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">演员</label>
                  <select
                    value={filters.actors || ''}
                    onChange={(e) => handleFilterChange('actors', e.target.value || undefined)}
                    className="w-full rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-2.5 text-sm text-white outline-none transition-colors focus:border-teal-400/35 focus:ring-2 focus:ring-teal-400/12"
                  >
                    <option value="">全部演员</option>
                    {availableActors.slice(0, 50).map((actor) => (
                      <option key={actor} value={actor}>
                        {actor}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">类型</label>
                  <select
                    value={filters.genres || ''}
                    onChange={(e) => handleFilterChange('genres', e.target.value || undefined)}
                    className="w-full rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-2.5 text-sm text-white outline-none transition-colors focus:border-teal-400/35 focus:ring-2 focus:ring-teal-400/12"
                  >
                    <option value="">全部类型</option>
                    {availableGenres.slice(0, 50).map((genre) => (
                      <option key={genre} value={genre}>
                        {genre}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">观看状态</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleFilterChange('isWatched', undefined)}
                      className={`flex-1 rounded-2xl px-3 py-2.5 text-sm font-medium transition-colors ${
                        filters.isWatched === undefined
                          ? 'bg-white text-zinc-950'
                          : 'border border-white/8 bg-white/[0.04] text-zinc-300 hover:bg-white/[0.08]'
                      }`}
                    >
                      全部
                    </button>
                    <button
                      onClick={() => handleFilterChange('isWatched', true)}
                      className={`flex-1 flex items-center justify-center gap-1 rounded-2xl px-3 py-2.5 text-sm font-medium transition-colors ${
                        filters.isWatched === true
                          ? 'bg-emerald-400 text-zinc-950'
                          : 'border border-white/8 bg-white/[0.04] text-zinc-300 hover:bg-white/[0.08]'
                      }`}
                    >
                      <Eye className="w-4 h-4" />
                      已看
                    </button>
                    <button
                      onClick={() => handleFilterChange('isWatched', false)}
                      className={`flex-1 flex items-center justify-center gap-1 rounded-2xl px-3 py-2.5 text-sm font-medium transition-colors ${
                        filters.isWatched === false
                          ? 'bg-amber-300 text-zinc-950'
                          : 'border border-white/8 bg-white/[0.04] text-zinc-300 hover:bg-white/[0.08]'
                      }`}
                    >
                      <EyeOff className="w-4 h-4" />
                      未看
                    </button>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-xs text-zinc-500">
                  提示：筛选会与搜索关键词一起生效，结果会按当前排序方式更新。
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
