import { create } from "zustand";
import { AppConfig, getConfig, updateConfig } from "../services/tauri";

const DEFAULT_CONFIG: AppConfig = {
  nas_paths: [],
  cache_dir: "",
  db_path: "",
  scan_on_startup: false,
  auto_generate_thumbnails: false,
  theme: "dark",
  default_player: "system",
};

interface SettingsStore {
  config: AppConfig | null;
  isLoading: boolean;
  error: string | null;

  loadConfig: () => Promise<void>;
  saveConfig: (config: AppConfig) => Promise<void>;
  patchConfig: (updates: Partial<AppConfig>) => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  config: null,
  isLoading: false,
  error: null,

  loadConfig: async () => {
    set({ isLoading: true, error: null });
    try {
      const config = await getConfig();
      set({ config, isLoading: false });
    } catch (error) {
      set({ error: String(error), isLoading: false });
    }
  },

  saveConfig: async (config: AppConfig) => {
    set({ isLoading: true, error: null });
    try {
      await updateConfig(config);
      set({ config, isLoading: false });
    } catch (error) {
      set({ error: String(error), isLoading: false });
    }
  },

  patchConfig: async (updates: Partial<AppConfig>) => {
    const merged: AppConfig = { ...DEFAULT_CONFIG, ...get().config, ...updates };
    await get().saveConfig(merged);
  },
}));
