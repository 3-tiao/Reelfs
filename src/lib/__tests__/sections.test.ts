// Unit tests for src/lib/sections.ts — the pure grouping helpers that collapse
// a backend-sorted movie list into labelled sections.
//
// sections.ts imports only *types* from ../services/tauri (erased at runtime),
// so no Tauri code actually executes here; the @tauri-apps/api entry points
// are mocked anyway so this file stays hermetic if that import ever becomes
// value-level.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Movie } from "../../services/tauri";
import { buildSections, sectionConfigFor, shouldSection } from "../sections";
import type { SortBy } from "../sections";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

// ---------- helpers ----------

// Optional fields on Movie are typed `?: number`, but the Rust/JSON boundary
// serializes missing values as null and sections.ts guards `=== null`
// explicitly (rating at sections.ts:19, year at sections.ts:97). These casts
// let tests exercise those runtime null paths despite the narrower TS type.
function forceNum(v: unknown): number {
  return v as number;
}

function forceStr(v: unknown): string {
  return v as string;
}

function makeMovie(overrides: Partial<Movie> = {}): Movie {
  return {
    id: 1,
    file_path: "/nas/movies/sample.mkv",
    title: "Sample Movie",
    added_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2025-01-01T00:00:00.000Z",
    play_count: 0,
    ...overrides,
  };
}

// ---------- dispatcher ----------

describe("sectionConfigFor / shouldSection", () => {
  it.each(["rating", "play_count", "last_accessed", "added_at", "year"] as const)(
    "maps known sortBy %s to a config and shouldSection is true",
    (sortBy) => {
      expect(sectionConfigFor(sortBy)).not.toBeNull();
      expect(shouldSection(sortBy)).toBe(true);
    },
  );

  it("maps 'title' to null — flat list by design (sections.ts:121)", () => {
    expect(sectionConfigFor("title")).toBeNull();
    expect(shouldSection("title")).toBe(false);
  });

  it("maps null / undefined sortBy to null", () => {
    expect(sectionConfigFor(null)).toBeNull();
    expect(sectionConfigFor(undefined)).toBeNull();
    expect(shouldSection(null)).toBe(false);
    expect(shouldSection(undefined)).toBe(false);
  });

  it("maps an unknown sortBy to null via the runtime guard (CONFIGS[sortBy] ?? null)", () => {
    const unknownSortBy = "mystery-sort" as unknown as SortBy;
    expect(sectionConfigFor(unknownSortBy)).toBeNull();
    expect(shouldSection(unknownSortBy)).toBe(false);
  });

  it("returns the config matching the sortBy, not a shared one", () => {
    expect(sectionConfigFor("rating")?.labelOf(null)).toBe("未评分");
    expect(sectionConfigFor("added_at")?.labelOf(null)).toBe("未知");
    expect(sectionConfigFor("play_count")?.keyOf(makeMovie({ play_count: 12 }))).toBe(4);
  });
});

// ---------- rating ----------

describe("rating config (ratingKey)", () => {
  const cfg = sectionConfigFor("rating")!;

  it.each([undefined, forceNum(null)])(
    "treats %p rating as unrated (key null, label 未评分)",
    (rating) => {
      expect(cfg.keyOf(makeMovie({ rating }))).toBeNull();
      expect(cfg.labelOf(null)).toBe("未评分");
    },
  );

  it.each([0, -0.4, -3.2])("rounds rating %p to null when the result is <= 0", (rating) => {
    expect(cfg.keyOf(makeMovie({ rating }))).toBeNull();
  });

  it.each([
    [0.5, 1], // Math.round(0.5) = 1 — half rounds up
    [1.4, 1],
    [1.5, 2],
    [7.4, 7],
    [7.5, 8],
    [9.5, 10],
    [10, 10],
  ])("rounds rating %p into the %p-star bucket", (rating, expected) => {
    expect(cfg.keyOf(makeMovie({ rating }))).toBe(expected);
  });

  it("labels star buckets as `${key} 星`", () => {
    expect(cfg.labelOf(1)).toBe("1 星");
    expect(cfg.labelOf(8)).toBe("8 星");
    expect(cfg.labelOf(10)).toBe("10 星");
  });
});

// ---------- play count ----------

describe("play_count config (playCountKey)", () => {
  const cfg = sectionConfigFor("play_count")!;

  it.each([
    [0, 0],
    [-7, 0], // negative counts clamp into the 未播放 bucket
    [1, 1],
    [2, 2],
    [5, 2], // 5 still in the 2-5 bucket (boundary, inclusive)
    [6, 3],
    [10, 3], // 10 still in the 6-10 bucket (boundary, inclusive)
    [11, 4],
    [999, 4],
  ])("buckets play_count %p into key %p", (count, expected) => {
    expect(cfg.keyOf(makeMovie({ play_count: count }))).toBe(expected);
  });

  it("falls back to the 未播放 bucket when play_count is undefined (?? 0)", () => {
    expect(cfg.keyOf(makeMovie({ play_count: undefined }))).toBe(0);
  });

  it("labels the five buckets exactly as PLAY_COUNT_LABELS", () => {
    expect(cfg.labelOf(0)).toBe("未播放");
    expect(cfg.labelOf(1)).toBe("1 次");
    expect(cfg.labelOf(2)).toBe("2-5 次");
    expect(cfg.labelOf(3)).toBe("6-10 次");
    expect(cfg.labelOf(4)).toBe("10+ 次");
  });

  it("falls back to String(key) for keys outside the five buckets", () => {
    expect(cfg.labelOf(99)).toBe("99");
  });
});

// ---------- time buckets ----------

describe("time buckets (last_accessed / added_at)", () => {
  const FIXED_NOW = Date.parse("2026-06-15T12:00:00.000Z");
  const MS_PER_DAY = 86_400_000;

  const isoDaysAgo = (days: number, extraMs = 0) =>
    new Date(FIXED_NOW - days * MS_PER_DAY - extraMs).toISOString();

  beforeEach(() => {
    // timeBucket reads Date.now() directly (sections.ts:61) — pin it so the
    // 7/30/180-day boundaries are exact regardless of when tests run.
    vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    [isoDaysAgo(0), 0],
    [isoDaysAgo(3.5), 0],
    [isoDaysAgo(7), 0], // exactly 7 days: `days <= 7` boundary is inclusive
    [isoDaysAgo(7, 1), 1], // 7 days + 1ms falls into the next bucket
    [isoDaysAgo(30), 1],
    [isoDaysAgo(30, 1), 2],
    [isoDaysAgo(180), 2],
    [isoDaysAgo(180, 1), 3],
    [isoDaysAgo(3650), 3],
    [isoDaysAgo(-5), 0], // future timestamp → negative days, still <= 7
  ])("buckets last_accessed %p into key %p", (iso, expected) => {
    const cfg = sectionConfigFor("last_accessed")!;
    expect(cfg.keyOf(makeMovie({ last_accessed: iso }))).toBe(expected);
  });

  it.each([undefined, "", "not-an-iso-date"])(
    "maps last_accessed %p (missing or invalid) to the null key",
    (iso) => {
      const cfg = sectionConfigFor("last_accessed")!;
      expect(cfg.keyOf(makeMovie({ last_accessed: iso }))).toBeNull();
    },
  );

  it("maps a JSON-null last_accessed to the null key", () => {
    const cfg = sectionConfigFor("last_accessed")!;
    expect(cfg.keyOf(makeMovie({ last_accessed: forceStr(null) }))).toBeNull();
  });

  it("labels last_accessed buckets 从未播放/最近一周/最近一月/最近半年/更早", () => {
    const cfg = sectionConfigFor("last_accessed")!;
    expect(cfg.labelOf(null)).toBe("从未播放");
    expect(cfg.labelOf(0)).toBe("最近一周");
    expect(cfg.labelOf(1)).toBe("最近一月");
    expect(cfg.labelOf(2)).toBe("最近半年");
    expect(cfg.labelOf(3)).toBe("更早");
  });

  it.each([
    [isoDaysAgo(2), "本周入库"],
    [isoDaysAgo(10), "本月入库"],
    [isoDaysAgo(90), "半年内入库"],
    [isoDaysAgo(400), "更早"],
  ])("labels added_at %p as %p", (iso, label) => {
    const cfg = sectionConfigFor("added_at")!;
    const key = cfg.keyOf(makeMovie({ added_at: iso }));
    expect(key).not.toBeNull();
    expect(cfg.labelOf(key)).toBe(label);
  });

  it("labels a missing/invalid added_at as 未知", () => {
    const cfg = sectionConfigFor("added_at")!;
    expect(cfg.keyOf(makeMovie({ added_at: "garbage" }))).toBeNull();
    expect(cfg.labelOf(null)).toBe("未知");
  });
});

// ---------- year (decades) ----------

describe("year config (yearDecadeKey)", () => {
  const cfg = sectionConfigFor("year")!;

  it.each([undefined, forceNum(null)])("maps %p year to null (未知年份)", (year) => {
    expect(cfg.keyOf(makeMovie({ year }))).toBeNull();
    expect(cfg.labelOf(null)).toBe("未知年份");
  });

  it.each([1979, 1950, 0])("maps pre-1980 year %p to the 'earlier' bucket", (year) => {
    expect(cfg.keyOf(makeMovie({ year }))).toBe("earlier");
    expect(cfg.labelOf("earlier")).toBe("更早");
  });

  it.each([
    [1980, 1980],
    [1989, 1980],
    [1990, 1990],
    [1999, 1990],
    [2024, 2020],
  ])("maps year %p to decade key %p", (year, expected) => {
    expect(cfg.keyOf(makeMovie({ year }))).toBe(expected);
  });

  it("labels decade keys as `${key}s`", () => {
    expect(cfg.labelOf(1980)).toBe("1980s");
    expect(cfg.labelOf(2020)).toBe("2020s");
  });
});

// ---------- buildSections ----------

describe("buildSections", () => {
  const ratingCfg = sectionConfigFor("rating")!;

  it("returns an empty list for an empty movie list", () => {
    expect(buildSections([], ratingCfg)).toEqual([]);
  });

  it("creates one section per distinct adjacent key, with labels from the config", () => {
    const movies = [
      makeMovie({ id: 1, rating: 9.1 }), // 9
      makeMovie({ id: 2, rating: 8.4 }), // 8
      makeMovie({ id: 3, rating: 7.4 }), // 7
    ];
    const sections = buildSections(movies, ratingCfg);
    expect(sections.map((s) => s.key)).toEqual([9, 8, 7]);
    expect(sections.map((s) => s.label)).toEqual(["9 星", "8 星", "7 星"]);
    expect(sections.map((s) => s.movies.length)).toEqual([1, 1, 1]);
  });

  it("merges adjacent movies with the same key into one section", () => {
    const a = makeMovie({ id: 1, rating: 8.2 }); // key 8
    const b = makeMovie({ id: 2, rating: 8.4 }); // key 8 (8.9 would round to 9)
    const sections = buildSections([a, b], ratingCfg);

    expect(sections).toHaveLength(1);
    expect(sections[0].key).toBe(8);
    expect(sections[0].label).toBe("8 星");
    expect(sections[0].movies).toEqual([a, b]);
    expect(sections[0].movies[0]).toBe(a); // identity preserved, not cloned
    expect(sections[0].movies[1]).toBe(b);
  });

  it("opens a new section only when the key changes mid-list", () => {
    const movies = [
      makeMovie({ id: 1, rating: 9.0 }), // 9
      makeMovie({ id: 2, rating: 8.4 }), // 8
      makeMovie({ id: 3, rating: 8.1 }), // 8 — same key, merges into previous
    ];
    const sections = buildSections(movies, ratingCfg);
    expect(sections).toHaveLength(2);
    expect(sections[0]).toMatchObject({ key: 9, label: "9 星" });
    expect(sections[1]).toMatchObject({ key: 8, label: "8 星" });
    expect(sections[1].movies.map((m) => m.id)).toEqual([2, 3]);
  });

  it("keeps non-adjacent same-key movies in separate sections (adjacency, not global grouping)", () => {
    const movies = [
      makeMovie({ id: 1, rating: 8.2 }), // 8
      makeMovie({ id: 2, rating: 9.4 }), // 9
      makeMovie({ id: 3, rating: 8.4 }), // 8 again, but not adjacent to id 1
    ];
    const sections = buildSections(movies, ratingCfg);
    expect(sections).toHaveLength(3);
    expect(sections[0].key).toBe(8);
    expect(sections[2].key).toBe(8);
    expect(sections[0].movies.map((m) => m.id)).toEqual([1]);
    expect(sections[2].movies.map((m) => m.id)).toEqual([3]);
  });

  it("merges adjacent null-key (unrated) movies and switches on the first rated one", () => {
    const movies = [
      makeMovie({ id: 1 }), // null
      makeMovie({ id: 2 }), // null
      makeMovie({ id: 3, rating: 8.4 }), // 8
    ];
    const sections = buildSections(movies, ratingCfg);
    expect(sections).toHaveLength(2);
    expect(sections[0].key).toBeNull();
    expect(sections[0].label).toBe("未评分");
    expect(sections[0].movies.map((m) => m.id)).toEqual([1, 2]);
    expect(sections[1].key).toBe(8);
  });

  it("works with a non-rating config too (year decades)", () => {
    const yearCfg = sectionConfigFor("year")!;
    const movies = [
      makeMovie({ id: 1, year: 2024 }), // 2020
      makeMovie({ id: 2, year: 2023 }), // 2020
      makeMovie({ id: 3, year: 1999 }), // 1990
      makeMovie({ id: 4, year: 1971 }), // earlier
    ];
    const sections = buildSections(movies, yearCfg);
    expect(sections.map((s) => [s.key, s.label, s.movies.length])).toEqual([
      [2020, "2020s", 2],
      [1990, "1990s", 1],
      ["earlier", "更早", 1],
    ]);
  });
});
