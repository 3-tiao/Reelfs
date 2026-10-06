// useScrollRestoration — renderHook tests against the REAL movieStore,
// with a scripted ScrollController. Tauri IPC is mocked at its root because
// movieStore → services/tauri imports @tauri-apps/api.
//
// Covered behaviour (useScrollRestoration.ts):
//   :35-37  local scrollProgress seeded from scrollProgresses[storageKey]
//   :39-65  restore on first non-empty render: rAF → scrollToPosition(saved),
//           then a 100ms window where isRestoring suppresses handleScroll
//   :60-64  itemCount === 0 → no restore attempt
//   :81-84  handleScroll persists position only after a >100px move
//   :86     …but always persists progress
//   :89-98  handleSeek → scrollToPercentage + progress write
//   :100-102 resetRestoration / storageKey switch re-restores (restoredKeyRef)
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => []),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

import { useScrollRestoration, type ScrollController } from "../useScrollRestoration";
import { useMovieStore } from "../../stores/movieStore";

interface ScriptedController {
  controller: ScrollController;
  state: { position: number; scrollSpan: number };
}

// A deterministic ScrollController: percentage = position / scrollSpan and
// scrollToPosition/scrollToPercentage mutate `state.position` like a real
// scroller would.
function createScrollController(
  initial: { position: number; scrollSpan: number } = { position: 0, scrollSpan: 1000 },
): ScriptedController {
  const state = { ...initial };
  const controller: ScrollController = {
    getScrollPosition: vi.fn(() => state.position),
    getScrollPercentage: vi.fn(() => state.position / state.scrollSpan),
    scrollToPosition: vi.fn((top: number) => {
      state.position = top;
    }),
    scrollToPercentage: vi.fn((pct: number) => {
      state.position = pct * state.scrollSpan;
    }),
  };
  return { controller, state };
}

beforeEach(() => {
  useMovieStore.setState({ scrollPositions: {}, scrollProgresses: {} });
  // jsdom 29 defines neither requestAnimationFrame nor setTimeout fakes for
  // it; faking them explicitly lets us drive the hook's rAF + 100ms restore
  // window deterministically (vitest's default toFake omits rAF).
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "requestAnimationFrame",
      "cancelAnimationFrame",
    ],
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useScrollRestoration", () => {
  it("restores the saved position via rAF on first non-empty render and seeds local progress", () => {
    useMovieStore.setState({
      scrollPositions: { grid: 250 },
      scrollProgresses: { grid: 0.5 },
    });
    const { controller, state } = createScrollController();
    const getController = () => controller;

    const { result } = renderHook(() =>
      useScrollRestoration({ storageKey: "grid", itemCount: 5, getController }),
    );

    // Mount effect ran synchronously: restore window open, progress seeded
    // from the store (:43-47).
    expect(result.current.isRestoringRef.current).toBe(true);
    expect(result.current.scrollProgress).toBe(0.5);
    expect(controller.scrollToPosition).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(16); // one rAF frame
    });    expect(controller.scrollToPosition).toHaveBeenCalledWith(250);
    expect(state.position).toBe(250);

    // Within the 100ms window, programmatic scrolling must NOT be persisted.
    state.position = 400;
    act(() => {
      result.current.handleScroll();
    });
    expect(useMovieStore.getState().scrollPositions.grid).toBe(250);
    // …and the pre-existing progress must not be overwritten either.
    expect(useMovieStore.getState().scrollProgresses.grid).toBe(0.5);

    act(() => {
      vi.advanceTimersByTime(100); // restore window closes (:55-58)
    });
    expect(result.current.isRestoringRef.current).toBe(false);
    // Progress re-synced from the controller after restoration.
    expect(result.current.scrollProgress).toBe(0.4);
  });

  it("persists position only after a >100px move, but progress on every scroll", () => {
    useMovieStore.setState({
      scrollPositions: { key: 100 },
      scrollProgresses: { key: 0.1 },
    });
    const { controller, state } = createScrollController();
    const getController = () => controller;

    const { result } = renderHook(() =>
      useScrollRestoration({ storageKey: "key", itemCount: 3, getController }),
    );
    act(() => {
      vi.advanceTimersByTime(116); // rAF + 100ms restore window
    });
    expect(result.current.isRestoringRef.current).toBe(false);

    // 50px move (<100): position kept, progress still written.
    state.position = 150;
    act(() => {
      result.current.handleScroll();
    });
    expect(useMovieStore.getState().scrollPositions.key).toBe(100);
    expect(useMovieStore.getState().scrollProgresses.key).toBe(0.15);
    expect(result.current.scrollProgress).toBe(0.15);

    // 150px move (>100): position persisted and becomes the new baseline.
    state.position = 250;
    act(() => {
      result.current.handleScroll();
    });
    expect(useMovieStore.getState().scrollPositions.key).toBe(250);
    expect(useMovieStore.getState().scrollProgresses.key).toBe(0.25);
  });

  it("handleSeek scrolls to the percentage, updates local progress and writes the store", () => {
    const { controller, state } = createScrollController();
    const getController = () => controller;

    const { result } = renderHook(() =>
      useScrollRestoration({ storageKey: "key", itemCount: 3, getController }),
    );
    act(() => {
      vi.advanceTimersByTime(116);
    });

    act(() => {
      result.current.handleSeek(0.8);
    });

    expect(controller.scrollToPercentage).toHaveBeenCalledWith(0.8);
    expect(state.position).toBe(800);
    expect(result.current.scrollProgress).toBe(0.8);
    expect(useMovieStore.getState().scrollProgresses.key).toBe(0.8);
    // Seek does not touch the position baseline.
    expect(useMovieStore.getState().scrollPositions.key).toBeUndefined();
  });

  it("re-restores when storageKey changes and the saved data differs", () => {
    useMovieStore.setState({
      scrollPositions: { a: 100, b: 900 },
      scrollProgresses: { a: 0.1, b: 0.9 },
    });
    const { controller } = createScrollController();
    const getController = () => controller;

    const { result, rerender } = renderHook(
      ({ storageKey }) =>
        useScrollRestoration({ storageKey, itemCount: 3, getController }),
      { initialProps: { storageKey: "a" as string } },
    );

    act(() => {
      vi.advanceTimersByTime(116);
    });
    expect(controller.scrollToPosition).toHaveBeenLastCalledWith(100);
    expect(result.current.isRestoringRef.current).toBe(false);

    rerender({ storageKey: "b" });

    // restoredKeyRef held "a", so key "b" re-enters the restore path.
    expect(result.current.scrollProgress).toBe(0.9);
    expect(result.current.isRestoringRef.current).toBe(true);
    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(controller.scrollToPosition).toHaveBeenLastCalledWith(900);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current.isRestoringRef.current).toBe(false);
    expect(result.current.scrollProgress).toBe(0.9);
  });

  it("does not restore when itemCount is 0, but still seeds progress for the key", () => {
    useMovieStore.setState({
      scrollPositions: { a: 100 },
      scrollProgresses: { a: 0.7 },
    });
    const { controller } = createScrollController();
    const getController = () => controller;

    const { result } = renderHook(() =>
      useScrollRestoration({ storageKey: "a", itemCount: 0, getController }),
    );

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(controller.scrollToPosition).not.toHaveBeenCalled();
    expect(result.current.isRestoringRef.current).toBe(false);
    // :35-37 seeds local progress from the store regardless of itemCount.
    expect(result.current.scrollProgress).toBe(0.7);
    expect(useMovieStore.getState().scrollPositions.a).toBe(100);
  });

  it("no-ops safely when the controller is null (handleScroll / handleSeek / restore)", () => {
    useMovieStore.setState({ scrollPositions: { a: 100 } });
    const getController = () => null;

    const { result } = renderHook(() =>
      useScrollRestoration({ storageKey: "a", itemCount: 3, getController }),
    );

    act(() => {
      vi.advanceTimersByTime(116); // rAF + restore window, controller absent
    });

    expect(result.current.isRestoringRef.current).toBe(false);
    act(() => {
      result.current.handleScroll();
      result.current.handleSeek(0.5);
    });
    expect(useMovieStore.getState().scrollPositions.a).toBe(100);
    expect(useMovieStore.getState().scrollProgresses.a).toBeUndefined();
  });

  it("resetRestoration allows the same key to restore again", () => {
    useMovieStore.setState({ scrollPositions: { a: 100 }, scrollProgresses: { a: 0.1 } });
    const { controller } = createScrollController();
    const getController = () => controller;

    const { result, rerender } = renderHook(
      ({ itemCount }) =>
        useScrollRestoration({ storageKey: "a", itemCount, getController }),
      { initialProps: { itemCount: 3 } },
    );
    act(() => {
      vi.advanceTimersByTime(116);
    });
    expect(controller.scrollToPosition).toHaveBeenCalledTimes(1);

    // Same storageKey: a plain rerender must NOT re-restore.
    rerender({ itemCount: 4 });
    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(controller.scrollToPosition).toHaveBeenCalledTimes(1);

    // After resetRestoration the next non-empty render restores again.
    act(() => {
      result.current.resetRestoration();
    });
    rerender({ itemCount: 5 });
    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(controller.scrollToPosition).toHaveBeenCalledTimes(2);
    expect(controller.scrollToPosition).toHaveBeenLastCalledWith(100);
  });

  it("does not re-render on high-frequency scroll-state writes (selector subscription)", () => {
    let renders = 0;
    const { controller, state } = createScrollController();
    const getController = () => controller;

    const { result } = renderHook(() => {
      renders += 1;
      return useScrollRestoration({ storageKey: "key", itemCount: 0, getController });
    });
    const rendersAfterMount = renders;
    expect(rendersAfterMount).toBeGreaterThan(0);

    // Another surface writing the hot scroll fields must not re-render this
    // hook — it only subscribes to the stable action identities.
    act(() => {
      useMovieStore.setState({ scrollPositions: { key: 900 }, scrollProgresses: { key: 0.9 } });
    });
    expect(renders).toBe(rendersAfterMount);

    // Its own scroll event bumps exactly one render — the local progress
    // state (:79) — with no extra render from the store writes.
    state.position = 300;
    act(() => {
      result.current.handleScroll();
    });
    expect(useMovieStore.getState().scrollPositions.key).toBe(300);
    expect(useMovieStore.getState().scrollProgresses.key).toBe(0.3); // 300 / 1000
    expect(renders).toBe(rendersAfterMount + 1);
  });
});
