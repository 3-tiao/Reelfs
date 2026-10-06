import { describe, expect, it } from "vitest";
import { getBackTarget, getRoutePath, getRouteState } from "../navigation";

describe("getRoutePath", () => {
  it("returns pathname alone when search is empty", () => {
    expect(getRoutePath({ pathname: "/movies", search: "" })).toBe("/movies");
  });

  it("concatenates pathname and search", () => {
    expect(getRoutePath({ pathname: "/movies", search: "?genre=action" })).toBe(
      "/movies?genre=action",
    );
  });

  it("handles the root path", () => {
    expect(getRoutePath({ pathname: "/", search: "" })).toBe("/");
  });
});

describe("getRouteState", () => {
  it("wraps the full route as the from field", () => {
    expect(getRouteState({ pathname: "/player", search: "?id=42" })).toEqual({
      from: "/player?id=42",
    });
  });

  it("keeps query strings so back navigation restores filters", () => {
    expect(getRouteState({ pathname: "/movies", search: "?genre=action&page=2" })).toEqual({
      from: "/movies?genre=action&page=2",
    });
  });
});

describe("getBackTarget", () => {
  const fallback = "/movies";

  it("returns from when state carries a non-empty string", () => {
    expect(getBackTarget({ from: "/movies?genre=action" }, fallback)).toBe(
      "/movies?genre=action",
    );
  });

  it("falls back when state is null", () => {
    expect(getBackTarget(null, fallback)).toBe(fallback);
  });

  it("falls back when state is not an object", () => {
    expect(getBackTarget("/movies", fallback)).toBe(fallback);
    expect(getBackTarget(42, fallback)).toBe(fallback);
    expect(getBackTarget(true, fallback)).toBe(fallback);
    expect(getBackTarget(undefined, fallback)).toBe(fallback);
  });

  it("falls back when state lacks from", () => {
    expect(getBackTarget({}, fallback)).toBe(fallback);
    expect(getBackTarget({ other: "x" }, fallback)).toBe(fallback);
  });

  it("falls back when from is an empty string", () => {
    expect(getBackTarget({ from: "" }, fallback)).toBe(fallback);
  });

  it("falls back when from is not a string", () => {
    expect(getBackTarget({ from: 123 }, fallback)).toBe(fallback);
    expect(getBackTarget({ from: null }, fallback)).toBe(fallback);
  });
});
