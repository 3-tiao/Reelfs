import type { Location } from "react-router-dom";

export interface RouteState {
  from?: string;
}

export function getRoutePath(location: Pick<Location, "pathname" | "search">): string {
  return `${location.pathname}${location.search}`;
}

export function getRouteState(location: Pick<Location, "pathname" | "search">): RouteState {
  return { from: getRoutePath(location) };
}

export function getBackTarget(
  state: unknown,
  fallback: string,
): string {
  if (state && typeof state === "object" && "from" in state) {
    const from = (state as RouteState).from;
    if (typeof from === "string" && from.length > 0) {
      return from;
    }
  }

  return fallback;
}
