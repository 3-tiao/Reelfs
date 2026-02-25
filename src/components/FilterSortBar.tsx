import { useState, useEffect, useRef, useCallback } from "react";
import { ArrowUpDown, Filter, X, ChevronDown, ChevronUp, Film, Calendar, Star, Clock, User } from "lucide-react";
import { useMovieStore } from "../stores/movieStore";
import { Filters, SortOptions } from "../services/tauri";

interface FilterSortBarProps {
  onFilterChange: () => void;
}

export default function FilterSortBar({ onFilterChange }: FilterSortBarProps) {
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

  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement>(null);
  const filterMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchAvailableGenres();
    fetchAvailableActors();
  }, [fetchAvailableGenres, fetchAvailableActors]);

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

  const handleSortChange = (sortBy: SortOptions['sortBy']) => {
    const newSortOptions: SortOptions = { ...sortOptions, sortBy };
    setSortOptions(newSortOptions);
    setSortMenuOpen(false);
    onFilterChange();
  };

  const handleSortOrderToggle = () => {
    const newSortOrder: 'ASC' | 'DESC' = sortOptions.sortOrder === 'ASC' ? 'DESC' : 'ASC';
    const newSortOptions: SortOptions = { ...sortOptions, sortOrder: newSortOrder };
    setSortOptions(newSortOptions);
    onFilterChange();
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
    });
  };

  const sortOptionsList = [
    { value: 'title', label: '名称', icon: Film },
    { value: 'year', label: '年份', icon: Calendar },
    { value: 'rating', label: '评分', icon: Star },
    { value: 'added_at', label: '添加时间', icon: Clock },
    { value: 'last_accessed', label: '播放次数', icon: User },
  ];

  const getSortLabel = () => {
    const option = sortOptionsList.find(opt => opt.value === sortOptions.sortBy);
    return option ? option.label : '排序';
  };

  return (
    <div className="flex items-center gap-2 mb-4">
      <div className="relative" ref={sortMenuRef}>
        <button
          onClick={() => setSortMenuOpen(!sortMenuOpen)}
          className="flex items-center p-2.5 bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition-colors border border-gray-700"
        >
          <ArrowUpDown className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm ml-2 whitespace-nowrap">{getSortLabel()}</span>
          {sortOptions.sortOrder === 'ASC' ? (
            <ChevronUp className="w-4 h-4 flex-shrink-0 text-gray-400" />
          ) : (
            <ChevronDown className="w-4 h-4 flex-shrink-0 text-gray-400" />
          )}
        </button>

        {sortMenuOpen && (
          <div className="absolute top-full left-0 mt-2 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 min-w-[200px]">
            <div className="p-2">
              <div className="text-gray-400 text-xs mb-2 px-2">排序方式</div>
              {sortOptionsList.map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.value}
                    onClick={() => handleSortChange(option.value as SortOptions['sortBy'])}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                      sortOptions.sortBy === option.value ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'
                    }`}
                  >
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    <span className="text-sm whitespace-nowrap">{option.label}</span>
                  </button>
                );
              })}
            </div>
            
            <div className="border-t border-gray-700 pt-2 mt-2">
              <button
                onClick={handleSortOrderToggle}
                className="w-full flex items-center justify-between px-3 py-2 text-gray-300 hover:bg-gray-700 rounded-lg transition-colors"
              >
                <span className="text-sm whitespace-nowrap">
                  {sortOptions.sortOrder === 'ASC' ? '升序' : '降序'}
                </span>
                {sortOptions.sortOrder === 'ASC' ? (
                  <ChevronUp className="w-4 h-4 flex-shrink-0" />
                ) : (
                  <ChevronDown className="w-4 h-4 flex-shrink-0" />
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="relative" ref={filterMenuRef}>
        <button
          onClick={() => setFilterMenuOpen(!filterMenuOpen)}
          className={`flex items-center p-2 rounded-lg transition-colors border ${
            hasActiveFilters() 
              ? 'bg-blue-600 text-white border-blue-500 hover:bg-blue-700' 
              : 'bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700'
          }`}
        >
          <Filter className="w-4 h-4 flex-shrink-0" />
          {hasActiveFilters() && (
            <div className="w-2 h-2 bg-white rounded-full flex-shrink-0" />
          )}
        </button>

        {filterMenuOpen && (
          <div className="absolute top-full left-0 mt-2 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 min-w-[280px]">
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-gray-400 text-xs mb-2">年份范围</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    placeholder="最小年份"
                    value={filters.minYear || ''}
                    onChange={(e) => handleFilterChange('minYear', e.target.value ? parseInt(e.target.value) : undefined)}
                    className="flex-1 bg-gray-700 text-white px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                  <input
                    type="number"
                    placeholder="最大年份"
                    value={filters.maxYear || ''}
                    onChange={(e) => handleFilterChange('maxYear', e.target.value ? parseInt(e.target.value) : undefined)}
                    className="flex-1 bg-gray-700 text-white px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-gray-400 text-xs mb-2">评分范围</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    placeholder="最小评分"
                    min="0"
                    max="10"
                    step="0.1"
                    value={filters.minRating || ''}
                    onChange={(e) => handleFilterChange('minRating', e.target.value ? parseFloat(e.target.value) : undefined)}
                    className="flex-1 bg-gray-700 text-white px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                  <input
                    type="number"
                    placeholder="最大评分"
                    min="0"
                    max="10"
                    step="0.1"
                    value={filters.maxRating || ''}
                    onChange={(e) => handleFilterChange('maxRating', e.target.value ? parseFloat(e.target.value) : undefined)}
                    className="flex-1 bg-gray-700 text-white px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-gray-400 text-xs mb-2">演员</label>
                <select
                  value={filters.actors || ''}
                  onChange={(e) => handleFilterChange('actors', e.target.value || undefined)}
                  className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
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
                <label className="block text-gray-400 text-xs mb-2">类型</label>
                <select
                  value={filters.genres || ''}
                  onChange={(e) => handleFilterChange('genres', e.target.value || undefined)}
                  className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                >
                  <option value="">全部类型</option>
                  {availableGenres.slice(0, 50).map((genre) => (
                    <option key={genre} value={genre}>
                      {genre}
                    </option>
                  ))}
                </select>
              </div>

              {hasActiveFilters() && (
                <div className="pt-2 border-t border-gray-700">
                  <button
                    onClick={handleClearFilters}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                  >
                    <X className="w-4 h-4" />
                    <span className="text-sm">清除筛选</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
