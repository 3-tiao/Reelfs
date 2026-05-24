import { useEffect, useRef, useCallback } from "react";
import {
  ArrowUpDown,
  Filter,
  ChevronDown,
  ChevronUp,
  Film,
  Calendar,
  Star,
  Clock,
  User,
  Eye,
  EyeOff,
  Check,
  X,
  Play,
} from "lucide-react";
import { useMovieStore } from "../stores/movieStore";
import { useViewStore } from "../stores/viewStore";
import { Filters, SortOptions } from "../services/tauri";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

interface FilterSortBarProps {
  viewMode: "grid" | "list" | "actors";
  onFilterChange: () => void;
}

const movieSortOptions = [
  { value: "title", label: "名称", icon: Film },
  { value: "year", label: "年份", icon: Calendar },
  { value: "rating", label: "评分", icon: Star },
  { value: "added_at", label: "添加时间", icon: Clock },
  { value: "last_accessed", label: "最近播放", icon: User },
  { value: "play_count", label: "播放次数", icon: Play },
];

const actorSortOptions = [
  { value: "name", label: "姓名", icon: User },
  { value: "movie_count", label: "作品数", icon: Film },
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

  const { actorSortBy, actorSortOrder, setActorSortBy, setActorSortOrder } = useViewStore();

  const filterChangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    return () => {
      if (filterChangeTimerRef.current) {
        clearTimeout(filterChangeTimerRef.current);
      }
    };
  }, []);

  const handleMovieSortChange = (sortBy: SortOptions["sortBy"]) => {
    const newSortOptions: SortOptions = { ...sortOptions, sortBy };
    setSortOptions(newSortOptions);
    onFilterChange();
  };

  const handleActorSortChange = (sortBy: "name" | "movie_count") => {
    setActorSortBy(sortBy);
  };

  const handleSortOrderToggle = () => {
    if (viewMode === "actors") {
      setActorSortOrder(actorSortOrder === "ASC" ? "DESC" : "ASC");
    } else {
      const newSortOrder: "ASC" | "DESC" = sortOptions.sortOrder === "ASC" ? "DESC" : "ASC";
      const newSortOptions: SortOptions = { ...sortOptions, sortOrder: newSortOrder };
      setSortOptions(newSortOptions);
      onFilterChange();
    }
  };

  const handleFilterChange = useCallback(
    (key: keyof Filters, value: any) => {
      const newFilters = { ...filters, [key]: value };
      setFilters(newFilters);

      if (filterChangeTimerRef.current) {
        clearTimeout(filterChangeTimerRef.current);
      }

      filterChangeTimerRef.current = setTimeout(() => {
        filterChangeTimerRef.current = null;
        onFilterChange();
      }, 300);
    },
    [filters, setFilters, onFilterChange],
  );

  const handleClearFilters = () => {
    clearFilters();
    onFilterChange();
  };

  const hasActiveFilters = () => {
    return (
      Object.keys(filters).some((key) => {
        const value = filters[key as keyof Filters];
        return value !== undefined && value !== null && value !== "";
      }) || filters.isWatched !== undefined
    );
  };

  const getSortLabel = () => {
    if (viewMode === "actors") {
      const option = actorSortOptions.find((opt) => opt.value === actorSortBy);
      return option ? option.label : "排序";
    }
    const option = movieSortOptions.find((opt) => opt.value === sortOptions.sortBy);
    return option ? option.label : "排序";
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
  ].filter((value) => value !== undefined && value !== null && value !== "").length;

  const currentSortBy = viewMode === "actors" ? actorSortBy : sortOptions.sortBy;
  const sortOptionsList = viewMode === "actors" ? actorSortOptions : movieSortOptions;

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
            <span>{getSortLabel()}</span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[180px]">
          {sortOptionsList.map((option) => {
            const Icon = option.icon;
            const isActive = currentSortBy === option.value;
            return (
              <DropdownMenuItem
                key={option.value}
                onSelect={() => {
                  if (viewMode === "actors") {
                    handleActorSortChange(option.value as "name" | "movie_count");
                  } else {
                    handleMovieSortChange(option.value as SortOptions["sortBy"]);
                  }
                }}
                className={cn(isActive && "bg-white/[0.06] text-foreground")}
              >
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span>{option.label}</span>
                {isActive && <Check className="ml-auto h-3.5 w-3.5" />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        variant="outline"
        size="sm"
        onClick={handleSortOrderToggle}
        className="gap-2"
        title={currentSortOrder === "ASC" ? "正序" : "逆序"}
      >
        {currentSortOrder === "ASC" ? (
          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <span>{currentSortOrder === "ASC" ? "正序" : "逆序"}</span>
      </Button>

      {viewMode !== "actors" && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant={hasActiveFilters() ? "secondary" : "outline"}
              size="sm"
              className="gap-2"
            >
              <Filter className="h-3.5 w-3.5 text-muted-foreground" />
              <span>筛选</span>
              {hasActiveFilters() && (
                <Badge variant="default" className="ml-1 h-4 min-w-[16px] rounded-full px-1 text-[10px]">
                  {activeFilterCount}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[340px] p-0">
            <div className="flex items-center justify-between p-4">
              <div>
                <div className="text-sm font-medium text-foreground">筛选器</div>
                <div className="mt-0.5 text-xs text-muted-foreground">精炼库里的结果</div>
              </div>
              {hasActiveFilters() && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearFilters}
                  className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                  清空
                </Button>
              )}
            </div>
            <Separator />
            <div className="space-y-4 p-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">年份范围</label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    placeholder="最小"
                    value={filters.minYear || ""}
                    onChange={(e) =>
                      handleFilterChange("minYear", e.target.value ? parseInt(e.target.value) : undefined)
                    }
                  />
                  <Input
                    type="number"
                    placeholder="最大"
                    value={filters.maxYear || ""}
                    onChange={(e) =>
                      handleFilterChange("maxYear", e.target.value ? parseInt(e.target.value) : undefined)
                    }
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">评分范围</label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    placeholder="最小"
                    min="0"
                    max="5"
                    step="0.1"
                    value={filters.minRating || ""}
                    onChange={(e) =>
                      handleFilterChange("minRating", e.target.value ? parseFloat(e.target.value) : undefined)
                    }
                  />
                  <Input
                    type="number"
                    placeholder="最大"
                    min="0"
                    max="5"
                    step="0.1"
                    value={filters.maxRating || ""}
                    onChange={(e) =>
                      handleFilterChange("maxRating", e.target.value ? parseFloat(e.target.value) : undefined)
                    }
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">演员</label>
                <select
                  value={filters.actors || ""}
                  onChange={(e) => handleFilterChange("actors", e.target.value || undefined)}
                  className="flex h-9 w-full rounded-md border border-white/[0.08] bg-black/40 px-3 py-1 text-sm text-foreground transition-colors focus:border-white/[0.18] focus:outline-none focus:ring-1 focus:ring-white/[0.1]"
                >
                  <option value="">全部演员</option>
                  {availableActors.slice(0, 50).map((actor) => (
                    <option key={actor} value={actor}>
                      {actor}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">类型</label>
                <select
                  value={filters.genres || ""}
                  onChange={(e) => handleFilterChange("genres", e.target.value || undefined)}
                  className="flex h-9 w-full rounded-md border border-white/[0.08] bg-black/40 px-3 py-1 text-sm text-foreground transition-colors focus:border-white/[0.18] focus:outline-none focus:ring-1 focus:ring-white/[0.1]"
                >
                  <option value="">全部类型</option>
                  {availableGenres.slice(0, 50).map((genre) => (
                    <option key={genre} value={genre}>
                      {genre}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">观看状态</label>
                <div className="flex gap-1.5">
                  <Button
                    variant={filters.isWatched === undefined ? "default" : "outline"}
                    size="sm"
                    className="flex-1"
                    onClick={() => handleFilterChange("isWatched", undefined)}
                  >
                    全部
                  </Button>
                  <Button
                    variant={filters.isWatched === true ? "default" : "outline"}
                    size="sm"
                    className="flex-1 gap-1.5"
                    onClick={() => handleFilterChange("isWatched", true)}
                  >
                    <Eye className="h-3.5 w-3.5" />
                    已看
                  </Button>
                  <Button
                    variant={filters.isWatched === false ? "default" : "outline"}
                    size="sm"
                    className="flex-1 gap-1.5"
                    onClick={() => handleFilterChange("isWatched", false)}
                  >
                    <EyeOff className="h-3.5 w-3.5" />
                    未看
                  </Button>
                </div>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
