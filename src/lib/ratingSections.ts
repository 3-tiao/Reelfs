import { Movie } from "../services/tauri";

export type RatingKey = number | null;

export function ratingKey(rating: number | null | undefined): RatingKey {
  if (rating === undefined || rating === null) return null;
  const rounded = Math.round(rating);
  if (rounded <= 0) return null;
  return rounded;
}

export interface RatingSection {
  key: RatingKey;
  movies: Movie[];
}

export function buildRatingSections(movies: Movie[]): RatingSection[] {
  const sections: RatingSection[] = [];
  let lastKey: RatingKey | undefined = undefined;
  let current: RatingSection | null = null;

  for (const movie of movies) {
    const key = ratingKey(movie.rating);
    if (key !== lastKey || current === null) {
      current = { key, movies: [movie] };
      sections.push(current);
      lastKey = key;
    } else {
      current.movies.push(movie);
    }
  }

  return sections;
}

export function ratingSectionLabel(key: RatingKey): string {
  if (key === null) return "未评分";
  return `${key} 星`;
}
