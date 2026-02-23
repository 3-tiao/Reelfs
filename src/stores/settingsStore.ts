import { create } from "zustand";
import { AppConfig, getConfig, updateConfig } from "../services/tauri";

interface SettingsStore {
  config: AppConfig | null;
  isLoading: boolean;
  error: string | null;

  loadConfig: () => Promise<void>;
  saveConfig: (config: AppConfig) => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
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
}));
