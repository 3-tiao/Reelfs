import { useState, useEffect, useRef } from "react";
import { X } from "lucide-react";

interface SearchBarProps {
  onSearch: (query: string) => void;
  placeholder?: string;
  initialValue?: string;
}

export default function SearchBar({ onSearch, placeholder = "Search movies...", initialValue = "" }: SearchBarProps) {
  const [query, setQuery] = useState(initialValue);
  const lastSearchRef = useRef(initialValue);

  useEffect(() => {
    setQuery(initialValue);
    lastSearchRef.current = initialValue;
  }, [initialValue]);

  const commitSearch = (value: string) => {
    lastSearchRef.current = value;
    onSearch(value);
  };

  useEffect(() => {
    if (query === lastSearchRef.current) {
      return;
    }
    
    const timer = setTimeout(() => {
      if (query !== lastSearchRef.current) {
        commitSearch(query);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query, onSearch]);

  const handleClear = () => {
    setQuery("");
    commitSearch("");
  };

  return (
    <div className="relative flex h-11 w-full items-center group">
      <div className="pointer-events-none absolute inset-y-1 left-1 w-10 rounded-2xl bg-gradient-to-br from-teal-400/18 via-emerald-400/10 to-transparent opacity-70 transition-opacity duration-300 group-focus-within:opacity-100" />
      <div className="absolute left-4 text-zinc-500 group-focus-within:text-teal-300 transition-colors pointer-events-none">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
      </div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commitSearch(query);
          } else if (e.key === "Escape" && query) {
            handleClear();
          }
        }}
        placeholder={placeholder}
        className="h-full w-full rounded-2xl border border-zinc-800/80 bg-[linear-gradient(135deg,rgba(24,24,27,0.92),rgba(12,18,20,0.88))] pl-12 pr-12 text-[15px] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.02),0_16px_40px_rgba(0,0,0,0.28)] transition-all duration-300 placeholder:text-zinc-500 focus:border-teal-900 focus:outline-none focus:ring-4 focus:ring-teal-950/50 hover:border-zinc-700"
      />
      {query && (
        <button
          onClick={handleClear}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-xl border border-zinc-800/80 bg-zinc-900/80 p-1.5 text-zinc-500 transition-all duration-200 hover:border-zinc-700 hover:bg-zinc-800 hover:text-zinc-200"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
