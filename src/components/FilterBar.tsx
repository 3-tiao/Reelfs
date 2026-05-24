import { useState, useEffect, useCallback } from "react";
import { Filter, X, ChevronDown, ChevronUp, ArrowUpDown, Star, Calendar, User, Film, Clock } from "lucide-react";
import { useMovieStore } from "../stores/movieStore";
import { Filters, SortOptions } from "../services/tauri";

interface FilterBarProps {
  onFilterChange: () => void;
}

export default function FilterBar({ onFilterChange }: FilterBarProps) {
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

  const [isExpanded, setIsExpanded] = useState(false);
  const [localFilters, setLocalFilters] = useState<Filters>(filters);
  const [localSortOptions, setLocalSortOptions] = useState<SortOptions>(sortOptions);

  useEffect(() => {
    fetchAvailableGenres();
    fetchAvailableActors();
  }, [fetchAvailableGenres, fetchAvailableActors]);

  useEffect(() => {
    setLocalFilters(filters);
    setLocalSortOptions(sortOptions);
  }, [filters, sortOptions]);

  const debouncedFilterChange = useCallback(
    (key: keyof Filters, value: any) => {
      const newFilters = { ...localFilters, [key]: value };
      setLocalFilters(newFilters);
      setFilters(newFilters);
      
      const timer = setTimeout(() => {
        onFilterChange();
      }, 300);
      
      return () => clearTimeout(timer);
    },
    [localFilters, setFilters, onFilterChange]
  );

  const handleFilterChange = (key: keyof Filters, value: any) => {
    debouncedFilterChange(key, value);
  };

  const handleSortChange = (sortBy: SortOptions['sortBy']) => {
    const newSortOptions: SortOptions = { ...localSortOptions, sortBy };
    setLocalSortOptions(newSortOptions);
    setSortOptions(newSortOptions);
    onFilterChange();
  };

  const handleSortOrderToggle = () => {
    const newSortOrder: 'ASC' | 'DESC' = localSortOptions.sortOrder === 'ASC' ? 'DESC' : 'ASC';
    const newSortOptions: SortOptions = { ...localSortOptions, sortOrder: newSortOrder };
    setLocalSortOptions(newSortOptions);
    setSortOptions(newSortOptions);
    onFilterChange();
  };

  const handleClearFilters = () => {
    clearFilters();
    setLocalFilters({});
    onFilterChange();
  };

  const hasActiveFilters = () => {
    return Object.keys(localFilters).some(key => {
      const value = localFilters[key as keyof Filters];
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

  return (
    <div className="bg-gray-800 rounded-lg p-4 mb-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Filter className="w-5 h-5 text-blue-500" />
          <h3 className="text-white font-semibold">筛选和排序</h3>
          {hasActiveFilters() && (
            <span className="bg-blue-500 text-white text-xs px-2 py-1 rounded-full">已启用</span>
          )}
        </div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-gray-400 hover:text-white transition-colors"
        >
          {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </button>
      </div>

      {isExpanded && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-gray-300 text-sm mb-2">年份范围</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="最小年份"
                  value={localFilters.minYear || ''}
                  onChange={(e) => handleFilterChange('minYear', e.target.value ? parseInt(e.target.value) : undefined)}
                  className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="number"
                  placeholder="最大年份"
                  value={localFilters.maxYear || ''}
                  onChange={(e) => handleFilterChange('maxYear', e.target.value ? parseInt(e.target.value) : undefined)}
                  className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-gray-300 text-sm mb-2">评分范围</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="最小评分"
                  min="0"
                  max="5"
                  step="0.1"
                  value={localFilters.minRating || ''}
                  onChange={(e) => handleFilterChange('minRating', e.target.value ? parseFloat(e.target.value) : undefined)}
                  className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="number"
                  placeholder="最大评分"
                  min="0"
                  max="5"
                  step="0.1"
                  value={localFilters.maxRating || ''}
                  onChange={(e) => handleFilterChange('maxRating', e.target.value ? parseFloat(e.target.value) : undefined)}
                  className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-gray-300 text-sm mb-2">演员</label>
              <select
                value={localFilters.actors || ''}
                onChange={(e) => handleFilterChange('actors', e.target.value || undefined)}
                className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">全部演员</option>
                {availableActors.map((actor) => (
                  <option key={actor} value={actor}>
                    {actor}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-gray-300 text-sm mb-2">类型</label>
              <select
                value={localFilters.genres || ''}
                onChange={(e) => handleFilterChange('genres', e.target.value || undefined)}
                className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">全部类型</option>
                {availableGenres.map((genre) => (
                  <option key={genre} value={genre}>
                    {genre}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-gray-700">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <ArrowUpDown className="w-4 h-4 text-gray-400" />
                <label className="text-gray-300 text-sm">排序方式:</label>
                <select
                  value={localSortOptions.sortBy}
                  onChange={(e) => handleSortChange(e.target.value as SortOptions['sortBy'])}
                  className="bg-gray-700 text-white px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {sortOptionsList.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={handleSortOrderToggle}
                className="flex items-center gap-2 px-3 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
              >
                {localSortOptions.sortOrder === 'ASC' ? '升序' : '降序'}
                {localSortOptions.sortOrder === 'ASC' ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>
            </div>

            {hasActiveFilters() && (
              <button
                onClick={handleClearFilters}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                <X className="w-4 h-4" />
                清除筛选
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
