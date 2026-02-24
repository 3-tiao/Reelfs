import { Movie } from '../services/tauri';
import { createLogger } from './logger';

const logger = createLogger('SearchManager');

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_CACHE_TTL_MS = 5000;

interface CachedResult {
  results: Movie[];
  timestamp: number;
}

class SearchManager {
  private debounceTimer: number | null = null;
  private searchCache: Map<string, CachedResult> = new Map();

  search(query: string, onSearch: (q: string) => void): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    if (!query.trim()) {
      this.debounceTimer = setTimeout(() => {
        onSearch('');
      }, SEARCH_DEBOUNCE_MS);
      return;
    }

    const cached = this.searchCache.get(query);
    const now = Date.now();
    if (cached && (now - cached.timestamp) < SEARCH_CACHE_TTL_MS) {
      logger.debug('使用缓存结果:', query);
      return;
    }

    this.debounceTimer = setTimeout(() => {
      logger.debug('执行搜索:', query);
      onSearch(query);
    }, SEARCH_DEBOUNCE_MS) as unknown as number;
  }

  updateCache(query: string, results: Movie[]): void {
    this.searchCache.set(query, {
      results,
      timestamp: Date.now(),
    });
  }

  clearCache(): void {
    this.searchCache.clear();
  }

  destroy(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.clearCache();
  }
}

export default SearchManager;
