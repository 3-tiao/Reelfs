// Unit tests for src/stores/settingsStore.ts — real zustand store logic,
// services/tauri (getConfig/updateConfig) mocked.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../services/tauri", () => ({
  getConfig: vi.fn(),
  updateConfig: vi.fn(),
}));

import { useSettingsStore } from "../settingsStore";
import { getConfig, updateConfig, type AppConfig } from "../../services/tauri";

const mGetConfig = vi.mocked(getConfig);
const mUpdateConfig = vi.mocked(updateConfig);

const makeConfig = (overrides: Partial<AppConfig> = {}): AppConfig => ({
  nas_paths: ["/volume1/movies"],
  cache_dir: "/volume1/.cache/reelfs",
  db_path: "/volume1/.local/share/reelfs/reelfs.db",
  auto_generate_thumbnails: true,
  theme: "dark",
  default_player: "mpv",
  ...overrides,
});

const initialState = useSettingsStore.getState();
const state = () => useSettingsStore.getState();

beforeEach(() => {
  vi.resetAllMocks();
  useSettingsStore.setState(initialState, true);
});

describe("loadConfig", () => {
  it("stores the loaded config and clears isLoading/error", async () => {
    const config = makeConfig();
    mGetConfig.mockResolvedValueOnce(config);

    await state().loadConfig();

    expect(mGetConfig).toHaveBeenCalledTimes(1);
    expect(state().config).toEqual(config);
    expect(state().isLoading).toBe(false);
    expect(state().error).toBeNull();
  });

  it("stores the stringified error and keeps config null on failure", async () => {
    mGetConfig.mockRejectedValueOnce(new Error("backend unavailable"));

    await state().loadConfig();

    expect(state().config).toBeNull();
    expect(state().error).toBe("Error: backend unavailable");
    expect(state().isLoading).toBe(false);
  });
});

describe("saveConfig", () => {
  it("persists via updateConfig and adopts the saved config", async () => {
    mUpdateConfig.mockResolvedValueOnce(undefined);
    const config = makeConfig({ theme: "light" });

    await state().saveConfig(config);

    expect(mUpdateConfig).toHaveBeenCalledWith(config);
    expect(state().config).toEqual(config);
    expect(state().isLoading).toBe(false);
    expect(state().error).toBeNull();
  });

  it("keeps the previous config, reports the error, and rethrows on failure", async () => {
    const existing = makeConfig();
    useSettingsStore.setState({ config: existing });
    mUpdateConfig.mockRejectedValueOnce(new Error("write failed"));

    await expect(state().saveConfig(makeConfig({ theme: "light" }))).rejects.toThrow(
      "write failed",
    );

    expect(state().config).toEqual(existing);
    expect(state().error).toBe("Error: write failed");
    expect(state().isLoading).toBe(false);
  });
});

describe("patchConfig", () => {
  it("merges updates over DEFAULT_CONFIG when no config has been loaded", async () => {
    mUpdateConfig.mockResolvedValueOnce(undefined);

    await state().patchConfig({ theme: "light" });

    const expected: AppConfig = {
      nas_paths: [],
      cache_dir: "",
      db_path: "",
      auto_generate_thumbnails: false,
      theme: "light",
      default_player: "system",
    };
    expect(mUpdateConfig).toHaveBeenCalledWith(expected);
    expect(state().config).toEqual(expected); // saveConfig adopts the merged config
  });

  it("layers updates over the loaded config without dropping loaded fields", async () => {
    useSettingsStore.setState({ config: makeConfig() });
    mUpdateConfig.mockResolvedValueOnce(undefined);

    await state().patchConfig({ auto_generate_thumbnails: false, theme: "light" });

    expect(mUpdateConfig).toHaveBeenCalledWith({
      nas_paths: ["/volume1/movies"],
      cache_dir: "/volume1/.cache/reelfs",
      db_path: "/volume1/.local/share/reelfs/reelfs.db",
      auto_generate_thumbnails: false, // overridden by the patch
      theme: "light", // overridden by the patch
      default_player: "mpv", // preserved from the loaded config
    });
  });

  it("surfaces a backend failure from the underlying save", async () => {
    mUpdateConfig.mockRejectedValueOnce(new Error("disk full"));

    await expect(state().patchConfig({ theme: "light" })).rejects.toThrow("disk full");

    expect(state().error).toBe("Error: disk full");
    expect(state().config).toBeNull();
    expect(state().isLoading).toBe(false);
  });
});
