import { useState } from "react";
import { Search, X } from "lucide-react";
import { createLogger } from "../lib/logger";

const logger = createLogger('SearchBar');

interface SearchBarProps {
  onSearch: (query: string) => void;
  placeholder?: string;
}

export default function SearchBar({ onSearch, placeholder = "Search movies..." }: SearchBarProps) {
  const [query, setQuery] = useState("");

  const handleChange = (value: string) => {
    setQuery(value);
    logger.debug('搜索框输入:', value);
    onSearch(value);
  };

  const handleClear = () => {
    setQuery("");
    logger.debug('清空搜索框');
    onSearch("");
  };

  return (
    <div className="relative w-full max-w-2xl">
      <div className="absolute left-3 top-1/2 -translate-y-1/2">
        <Search className="w-5 h-5 text-gray-400" />
      </div>
      <input
        type="text"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-gray-800 text-white pl-10 pr-10 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {query && (
        <button
          onClick={handleClear}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
        >
          <X className="w-5 h-5" />
        </button>
      )}
    </div>
  );
}
