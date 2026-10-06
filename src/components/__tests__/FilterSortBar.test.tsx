// FilterSortBar — interaction tests against the REAL zustand stores
// (movieStore + viewStore), with the Tauri IPC layer mocked out at its root
// (@tauri-apps/api/core + event), per the test-package brief.
//
// Covered behaviour (FilterSortBar.tsx):
//   :92-96   movie sort select → setSortOptions + onFilterChange
//   :98-100  actors sort select → viewStore only, no onFilterChange
//   :102-111 sort-order toggle, ASC/DESC flip per mode
//   :113-128 filter writes store synchronously, onFilterChange debounced 300ms
//   :130-133 清空 → clearFilters + immediate onFilterChange
//   :155-163 activeFilterCount badge
//   :218     actors mode renders no filter Popover
//   :74-82   genres/actors fetched on mount in movie mode only
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// services/tauri pulls in @tauri-apps/api/core + event; stores pull in
// services/tauri. Mocking the IPC root keeps every store fetch (genres,
// actors, …) offline. No tauri plugin is imported by these modules.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => []),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

import { invoke } from "@tauri-apps/api/core";
import FilterSortBar from "../FilterSortBar";
import { useMovieStore } from "../../stores/movieStore";
import { useViewStore } from "../../stores/viewStore";

const resetStores = () => {
  useMovieStore.setState({
    filters: {},
    sortOptions: { sortBy: "added_at", sortOrder: "DESC" },
    availableGenres: [],
    availableActors: [],
    isUsingFilters: false,
    scrollPositions: {},
    scrollProgresses: {},
  });
  useViewStore.setState({
    viewMode: "grid",
    actorSortBy: "name",
    actorSortOrder: "ASC",
    actorSearchQuery: "",
  });
};

beforeEach(() => {
  resetStores();
  vi.mocked(invoke).mockClear();
  localStorage.clear();
  // jsdom lacks scrollIntoView; Radix menu/popover focus paths may call it.
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("FilterSortBar — movie mode", () => {
  it("renders default sort label 添加时间 and order 逆序 from the store", () => {
    render(<FilterSortBar viewMode="grid" onFilterChange={() => {}} />);

    expect(screen.getByRole("button", { name: /添加时间/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "逆序" })).toBeInTheDocument();
  });

  it("selecting a sort writes sortOptions and fires onFilterChange", async () => {
    const user = userEvent.setup();
    const onFilterChange = vi.fn();
    render(<FilterSortBar viewMode="grid" onFilterChange={onFilterChange} />);

    await user.click(screen.getByRole("button", { name: /添加时间/ }));
    await user.click(screen.getByRole("menuitem", { name: "名称" }));

    expect(useMovieStore.getState().sortOptions).toEqual({
      sortBy: "title",
      sortOrder: "DESC", // preserves the untouched sortOrder
    });
    expect(onFilterChange).toHaveBeenCalledTimes(1);
    // Trigger label follows the new sort.
    expect(screen.getByRole("button", { name: /名称/ })).toBeInTheDocument();
  });

  it("toggles sort order ASC→DESC in the store and fires onFilterChange each time", async () => {
    const user = userEvent.setup();
    const onFilterChange = vi.fn();
    render(<FilterSortBar viewMode="grid" onFilterChange={onFilterChange} />);

    await user.click(screen.getByRole("button", { name: "逆序" }));

    expect(useMovieStore.getState().sortOptions).toEqual({
      sortBy: "added_at",
      sortOrder: "ASC",
    });
    expect(onFilterChange).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "正序" }));

    expect(useMovieStore.getState().sortOptions).toEqual({
      sortBy: "added_at",
      sortOrder: "DESC",
    });
    expect(onFilterChange).toHaveBeenCalledTimes(2);
  });

  it("fetches genres and actors on mount while both lists are empty", async () => {
    render(<FilterSortBar viewMode="grid" onFilterChange={() => {}} />);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("get_unique_genres");
      expect(invoke).toHaveBeenCalledWith("get_unique_actors");
    });
  });

  it("writes filters synchronously but debounces onFilterChange by 300ms, resetting on each change", async () => {
    // Open the popover with REAL timers: RTL's asyncWrapper drains a fake
    // setTimeout(0) and only advances jest-style timers, so user-event calls
    // deadlock under vitest fake timers. The debounce itself is then driven
    // with synchronous fireEvent + fake timers.
    const user = userEvent.setup();
    const onFilterChange = vi.fn();
    render(<FilterSortBar viewMode="grid" onFilterChange={onFilterChange} />);

    await user.click(screen.getByRole("button", { name: /筛选/ }));
    const minYear = screen.getAllByPlaceholderText("最小")[0]!;

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.change(minYear, { target: { value: "2" } });
    expect(useMovieStore.getState().filters.minYear).toBe(2);
    expect(onFilterChange).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(onFilterChange).not.toHaveBeenCalled();

    // A change before the deadline restarts the 300ms timer.
    fireEvent.change(minYear, { target: { value: "2001" } });
    expect(useMovieStore.getState().filters.minYear).toBe(2001);
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(onFilterChange).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onFilterChange).toHaveBeenCalledTimes(1);
  });

  it("shows an activeFilterCount badge that tracks year/genre/watched filters", async () => {
    const user = userEvent.setup();
    useMovieStore.setState({ availableGenres: ["剧情", "科幻"] });
    render(<FilterSortBar viewMode="grid" onFilterChange={() => {}} />);

    // No badge while no filter is active.
    let filterButton = screen.getByRole("button", { name: /筛选/ });
    expect(within(filterButton).queryByText("1")).not.toBeInTheDocument();

    await user.click(filterButton);
    await user.type(screen.getAllByPlaceholderText("最小")[0]!, "2001");

    filterButton = screen.getByRole("button", { name: /筛选/ });
    expect(within(filterButton).getByText("1")).toBeInTheDocument();

    // Genre select is the second native <select> (演员 is first).
    await user.selectOptions(screen.getAllByRole("combobox")[1]!, "剧情");
    expect(useMovieStore.getState().filters.genres).toBe("剧情");
    expect(useMovieStore.getState().isUsingFilters).toBe(true);
    filterButton = screen.getByRole("button", { name: /筛选/ });
    expect(within(filterButton).getByText("2")).toBeInTheDocument();

    // Watched-state buttons write the boolean filter and bump the badge.
    await user.click(screen.getByRole("button", { name: /已看/ }));
    expect(useMovieStore.getState().filters.isWatched).toBe(true);
    filterButton = screen.getByRole("button", { name: /筛选/ });
    expect(within(filterButton).getByText("3")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "全部" }));
    expect(useMovieStore.getState().filters.isWatched).toBeUndefined();
    filterButton = screen.getByRole("button", { name: /筛选/ });
    expect(within(filterButton).getByText("2")).toBeInTheDocument();
  });

  it("清空 clears filters and isUsingFilters and fires onFilterChange immediately (no debounce)", async () => {
    const user = userEvent.setup();
    const onFilterChange = vi.fn();
    useMovieStore.setState({
      filters: { minYear: 2000, genres: "剧情" },
      isUsingFilters: true,
    });
    render(<FilterSortBar viewMode="grid" onFilterChange={onFilterChange} />);

    await user.click(screen.getByRole("button", { name: /筛选/ }));
    await user.click(screen.getByRole("button", { name: "清空" }));

    expect(useMovieStore.getState().filters).toEqual({});
    expect(useMovieStore.getState().isUsingFilters).toBe(false);
    expect(onFilterChange).toHaveBeenCalledTimes(1);
    // 清空 button and badge disappear once nothing is active.
    expect(screen.queryByRole("button", { name: "清空" })).not.toBeInTheDocument();
    filterBadgeCountIsGone();
  });

  function filterBadgeCountIsGone() {
    const filterButton = screen.getByRole("button", { name: /筛选/ });
    expect(within(filterButton).queryByText(/^\d+$/)).not.toBeInTheDocument();
  }
});

describe("FilterSortBar — actors mode", () => {
  it("selecting a sort writes viewStore.actorSortBy, not movieStore, and never fires onFilterChange", async () => {
    const user = userEvent.setup();
    const onFilterChange = vi.fn();
    render(<FilterSortBar viewMode="actors" onFilterChange={onFilterChange} />);

    await user.click(screen.getByRole("button", { name: /姓名/ }));
    await user.click(screen.getByRole("menuitem", { name: "作品数" }));

    expect(useViewStore.getState().actorSortBy).toBe("movie_count");
    expect(useMovieStore.getState().sortOptions).toEqual({
      sortBy: "added_at",
      sortOrder: "DESC",
    });
    expect(onFilterChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /作品数/ })).toBeInTheDocument();
  });

  it("toggles actorSortOrder in viewStore without firing onFilterChange", async () => {
    const user = userEvent.setup();
    const onFilterChange = vi.fn();
    render(<FilterSortBar viewMode="actors" onFilterChange={onFilterChange} />);

    await user.click(screen.getByRole("button", { name: "正序" }));

    expect(useViewStore.getState().actorSortOrder).toBe("DESC");
    expect(useMovieStore.getState().sortOptions).toEqual({
      sortBy: "added_at",
      sortOrder: "DESC",
    });
    expect(onFilterChange).not.toHaveBeenCalled();
  });

  it("does not render the filter Popover", () => {
    render(<FilterSortBar viewMode="actors" onFilterChange={() => {}} />);

    expect(screen.queryByRole("button", { name: /筛选/ })).not.toBeInTheDocument();
  });

  it("does not fetch genres/actors on mount", async () => {
    render(<FilterSortBar viewMode="actors" onFilterChange={() => {}} />);

    // Let microtasks flush; the mount effect must have early-returned.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /姓名/ })).toBeInTheDocument();
    });
    expect(invoke).not.toHaveBeenCalled();
  });
});
