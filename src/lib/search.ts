import type { Movie } from "../services/tauri";

export interface HighlightPart {
  text: string;
  matched: boolean;
}

const SEARCH_TERM_REGEX = /[\p{L}\p{N}]+/gu;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractSearchTerms(query: string): string[] {
  const matches = query.toLocaleLowerCase().match(SEARCH_TERM_REGEX) ?? [];
  return Array.from(new Set(matches));
}

export function includesSearchTerms(text: string | null | undefined, query: string): boolean {
  if (!text) {
    return false;
  }

  const normalizedText = text.toLocaleLowerCase();
  return extractSearchTerms(query).some((term) => normalizedText.includes(term));
}

export function getHighlightedParts(text: string | null | undefined, query: string): HighlightPart[] {
  if (!text) {
    return [];
  }

  const terms = extractSearchTerms(query).sort((a, b) => b.length - a.length);
  if (terms.length === 0) {
    return [{ text, matched: false }];
  }

  const regex = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "giu");
  const termSet = new Set(terms);

  return text
    .split(regex)
    .filter(Boolean)
    .map((part) => ({
      text: part,
      matched: termSet.has(part.toLocaleLowerCase()),
    }));
}

export function getSearchSecondaryText(movie: Pick<Movie, "actors" | "director">, query: string): string | null {
  if (movie.actors && includesSearchTerms(movie.actors, query)) {
    return movie.actors
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(", ");
  }

  if (movie.director && includesSearchTerms(movie.director, query)) {
    return `Director: ${movie.director}`;
  }

  return null;
}
