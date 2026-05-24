import { Movie, SortOptions } from "../services/tauri";

export type SectionKey = string | number | null;

export interface Section {
  key: SectionKey;
  label: string;
  movies: Movie[];
}

export interface SectionConfig {
  keyOf: (movie: Movie) => SectionKey;
  labelOf: (key: SectionKey) => string;
}

/* ---------- Rating ---------- */

function ratingKey(rating: number | null | undefined): SectionKey {
  if (rating === undefined || rating === null) return null;
  const rounded = Math.round(rating);
  if (rounded <= 0) return null;
  return rounded;
}

const ratingConfig: SectionConfig = {
  keyOf: (m) => ratingKey(m.rating),
  labelOf: (key) => (key === null ? "未评分" : `${key} 星`),
};

/* ---------- Play Count ---------- */

function playCountKey(count: number): number {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 5) return 2;
  if (count <= 10) return 3;
  return 4;
}

const PLAY_COUNT_LABELS: Record<number, string> = {
  0: "未播放",
  1: "1 次",
  2: "2-5 次",
  3: "6-10 次",
  4: "10+ 次",
};

const playCountConfig: SectionConfig = {
  keyOf: (m) => playCountKey(m.play_count ?? 0),
  labelOf: (key) => PLAY_COUNT_LABELS[key as number] ?? String(key),
};

/* ---------- Time-based (last_accessed / added_at) ---------- */

const DAY_MS = 24 * 60 * 60 * 1000;

function timeBucket(iso: string | null | undefined): SectionKey {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const days = (Date.now() - t) / DAY_MS;
  if (days <= 7) return 0;
  if (days <= 30) return 1;
  if (days <= 180) return 2;
  return 3;
}

const LAST_ACCESSED_LABELS: Record<number, string> = {
  0: "最近一周",
  1: "最近一月",
  2: "最近半年",
  3: "更早",
};

const ADDED_AT_LABELS: Record<number, string> = {
  0: "本周入库",
  1: "本月入库",
  2: "半年内入库",
  3: "更早",
};

const lastAccessedConfig: SectionConfig = {
  keyOf: (m) => timeBucket(m.last_accessed),
  labelOf: (key) =>
    key === null ? "从未播放" : LAST_ACCESSED_LABELS[key as number] ?? String(key),
};

const addedAtConfig: SectionConfig = {
  keyOf: (m) => timeBucket(m.added_at),
  labelOf: (key) =>
    key === null ? "未知" : ADDED_AT_LABELS[key as number] ?? String(key),
};

/* ---------- Year (by decade) ---------- */

function yearDecadeKey(year: number | null | undefined): SectionKey {
  if (year === undefined || year === null) return null;
  if (year < 1980) return "earlier";
  return Math.floor(year / 10) * 10;
}

const yearConfig: SectionConfig = {
  keyOf: (m) => yearDecadeKey(m.year),
  labelOf: (key) => {
    if (key === null) return "未知年份";
    if (key === "earlier") return "更早";
    return `${key}s`;
  },
};

/* ---------- Dispatcher ---------- */

export type SortBy = SortOptions["sortBy"];

const CONFIGS: Partial<Record<SortBy, SectionConfig>> = {
  rating: ratingConfig,
  play_count: playCountConfig,
  last_accessed: lastAccessedConfig,
  added_at: addedAtConfig,
  year: yearConfig,
  // 'title' intentionally omitted — flat alphabetical list reads cleaner.
};

export function sectionConfigFor(sortBy: SortBy | null | undefined): SectionConfig | null {
  if (!sortBy) return null;
  return CONFIGS[sortBy] ?? null;
}

export function shouldSection(sortBy: SortBy | null | undefined): boolean {
  return sectionConfigFor(sortBy) !== null;
}

/**
 * Walks a backend-sorted movie list and collapses adjacent same-key entries
 * into sections. Backend ordering must be consistent with the key function:
 * the rating/play_count/year/time configs all satisfy this when paired with
 * the matching SQL ORDER BY (with NULLS LAST applied in the Rust layer).
 */
export function buildSections(movies: Movie[], config: SectionConfig): Section[] {
  const out: Section[] = [];
  let current: Section | null = null;

  for (const movie of movies) {
    const key = config.keyOf(movie);
    if (current === null || key !== current.key) {
      current = { key, label: config.labelOf(key), movies: [movie] };
      out.push(current);
    } else {
      current.movies.push(movie);
    }
  }

  return out;
}
