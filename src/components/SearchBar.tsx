import { useState, useEffect, useRef } from "react";
import { X } from "lucide-react";

interface SearchBarProps {
  onSearch: (query: string) => void;
  placeholder?: string;
}

export default function SearchBar({ onSearch, placeholder = "Search movies..." }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const lastSearchRef = useRef("");

  useEffect(() => {
    if (query === lastSearchRef.current) {
      return;
    }

    lastSearchRef.current = query;
    
    const timer = setTimeout(() => {
      onSearch(query);
    }, 300);

    return () => clearTimeout(timer);
  }, [query, onSearch]);

  const handleClear = () => {
    setQuery("");
  };

  return (
    <div className="relative w-full flex items-center h-11 group">
      <div className="absolute left-3.5 text-zinc-500 group-focus-within:text-teal-500 transition-colors pointer-events-none">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
      </div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        className="w-full h-full bg-zinc-900/60 text-white pl-11 pr-10 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/50 border border-zinc-800/60 hover:border-zinc-700/80 transition-all duration-300 placeholder:text-zinc-500 shadow-inner"
      />
      {query && (
        <button
          onClick={handleClear}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors p-1 rounded-md hover:bg-zinc-800"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
