// Unit tests for src/lib/search.ts.
//
// Tauri policy: the module under test reaches ../services/tauri only through a
// type-only import (search.ts:1 `import type { Movie }`), which is erased before
// execution, so the Tauri runtime is not part of this test's module graph. The
// @tauri-apps/api mocks below are defensive — if a value import ever appears,
// these tests stay hermetic and offline. No tauri plugin is imported here.
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

import {
  extractSearchTerms,
  getHighlightedParts,
  getSearchSecondaryText,
  includesSearchTerms,
} from "../search";

describe("extractSearchTerms", () => {
  it("lowercases the query and splits on every non-letter/non-number character", () => {
    expect(extractSearchTerms("The Matrix Reloaded (1999)")).toEqual([
      "the",
      "matrix",
      "reloaded",
      "1999",
    ]);
  });

  it("deduplicates terms case-insensitively via Set", () => {
    expect(extractSearchTerms("Matrix MATRIX matrix")).toEqual(["matrix"]);
  });

  it("keeps Chinese characters and splits on CJK punctuation", () => {
    // A CJK run plus a digit is one contiguous \p{L}\p{N} token.
    expect(extractSearchTerms("流浪地球2")).toEqual(["流浪地球2"]);
    // Full-width comma U+FF0C and exclamation mark are not letters/numbers.
    expect(extractSearchTerms("星球大战，前传！")).toEqual(["星球大战", "前传"]);
  });

  it("keeps accented letters as single terms", () => {
    expect(extractSearchTerms("Amélie")).toEqual(["amélie"]);
  });

  it("returns an empty array for empty or punctuation-only queries", () => {
    expect(extractSearchTerms("")).toEqual([]);
    expect(extractSearchTerms("!!! ... ---")).toEqual([]);
  });
});

describe("includesSearchTerms", () => {
  it("returns false for null, undefined and empty text", () => {
    expect(includesSearchTerms(null, "matrix")).toBe(false);
    expect(includesSearchTerms(undefined, "matrix")).toBe(false);
    expect(includesSearchTerms("", "matrix")).toBe(false);
  });

  it("returns true when any query term is contained, case-insensitively", () => {
    expect(includesSearchTerms("Star Wars: Episode IV", "episode")).toBe(true);
    expect(includesSearchTerms("STAR WARS", "wars")).toBe(true);
  });

  it("returns true when only one of several query terms matches", () => {
    expect(includesSearchTerms("The Matrix Reloaded", "matrix nothingmatches")).toBe(true);
  });

  it("returns false when no query term is contained", () => {
    expect(includesSearchTerms("The Matrix", "titanic avatar")).toBe(false);
  });

  it("returns false when the query carries no usable terms", () => {
    expect(includesSearchTerms("The Matrix", "!!! ???")).toBe(false);
  });

  it("matches Chinese substrings", () => {
    expect(includesSearchTerms("流浪地球", "地球")).toBe(true);
    expect(includesSearchTerms("流浪地球", "星际")).toBe(false);
  });
});

describe("getHighlightedParts", () => {
  it("returns an empty array for null, undefined and empty text", () => {
    expect(getHighlightedParts(null, "matrix")).toEqual([]);
    expect(getHighlightedParts(undefined, "matrix")).toEqual([]);
    expect(getHighlightedParts("", "matrix")).toEqual([]);
  });

  it("returns a single unmatched part when the query yields no terms", () => {
    expect(getHighlightedParts("Star Wars", "!!! ???")).toEqual([
      { text: "Star Wars", matched: false },
    ]);
  });

  it("splits text into matched/unmatched parts, case-insensitively", () => {
    expect(getHighlightedParts("The Matrix", "matrix")).toEqual([
      { text: "The ", matched: false },
      { text: "Matrix", matched: true },
    ]);
    // Every occurrence matches thanks to the "g" flag (search.ts:38).
    expect(getHighlightedParts("Matrix matrix MATRIX", "matrix")).toEqual([
      { text: "Matrix", matched: true },
      { text: " ", matched: false },
      { text: "matrix", matched: true },
      { text: " ", matched: false },
      { text: "MATRIX", matched: true },
    ]);
  });

  it("does not throw when the query contains regex special characters (escapeRegExp path)", () => {
    // "(", ")", "!" are stripped by tokenization before reaching the RegExp,
    // and escapeRegExp (search.ts:10-12) would escape whatever survives.
    expect(getHighlightedParts("Mission: Impossible (1996)", "impossible (1996)!!!")).toEqual([
      { text: "Mission: ", matched: false },
      { text: "Impossible", matched: true },
      { text: " (", matched: false },
      { text: "1996", matched: true },
      { text: ")", matched: false },
    ]);
  });

  it("sorts longest term first so long terms match atomically", () => {
    // With longest-first ordering (search.ts:33) "starwars" survives as one
    // matched part; a naive "star|starwars" alternation would cut it into
    // matched "star" + unmatched "wars".
    expect(getHighlightedParts("star starwars", "star starwars")).toEqual([
      { text: "star", matched: true },
      { text: " ", matched: false },
      { text: "starwars", matched: true },
    ]);
  });

  it("highlights each occurrence of every term, even across token boundaries", () => {
    // "star" and "wars" are separate terms but match back-to-back inside
    // "starwars" (verified: split yields ["", "star", "", "wars", ""]).
    expect(getHighlightedParts("starwars", "star wars")).toEqual([
      { text: "star", matched: true },
      { text: "wars", matched: true },
    ]);
  });
});

describe("getSearchSecondaryText", () => {
  it("returns the first two actor names, trimmed and comma-joined, when actors match", () => {
    expect(
      getSearchSecondaryText(
        { actors: "Keanu Reeves, Carrie-Anne Moss, Laurence Fishburne" },
        "keanu",
      ),
    ).toBe("Keanu Reeves, Carrie-Anne Moss");
  });

  it("trims whitespace around actor names", () => {
    expect(getSearchSecondaryText({ actors: "  A  ,  B  ,  C  " }, "b")).toBe("A, B");
  });

  it("falls back to the director when actors are present but do not match", () => {
    expect(
      getSearchSecondaryText({ actors: "Tom Hardy", director: "Christopher Nolan" }, "nolan"),
    ).toBe("Director: Christopher Nolan");
  });

  it("prefers actors over director when both match", () => {
    expect(
      getSearchSecondaryText({ actors: "Tom Hardy", director: "Christopher Nolan" }, "nolan hardy"),
    ).toBe("Tom Hardy");
  });

  it("returns null when nothing matches or the fields are missing", () => {
    expect(getSearchSecondaryText({ actors: "Tom Hardy", director: "Christopher Nolan" }, "avatar")).toBe(null);
    expect(getSearchSecondaryText({}, "nolan")).toBe(null);
  });

  it("treats empty-string actors as absent and still checks the director", () => {
    // "" is falsy, so `movie.actors && ...` (search.ts:51) short-circuits.
    expect(getSearchSecondaryText({ actors: "", director: "Christopher Nolan" }, "nolan")).toBe(
      "Director: Christopher Nolan",
    );
  });
});
