import { useState, useEffect, useRef } from "react";
import { Search as SearchIcon, X } from "lucide-react";

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
    <div className="relative flex h-9 w-full items-center">
      <SearchIcon className="pointer-events-none absolute left-3 h-4 w-4 text-muted-foreground/70" />
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
        className="h-full w-full rounded-md border border-white/[0.08] bg-black/40 pl-9 pr-9 text-sm text-foreground transition-colors placeholder:text-muted-foreground/60 hover:border-white/[0.12] focus:border-white/[0.18] focus:outline-none focus:ring-1 focus:ring-white/[0.1]"
      />
      {query && (
        <button
          onClick={handleClear}
          className="absolute right-2 flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
