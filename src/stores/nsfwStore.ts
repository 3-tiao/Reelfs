import { create } from "zustand";
import { persist } from "zustand/middleware";

interface NsfwStore {
  showThumbnails: boolean;
  toggleShowThumbnails: () => void;
}

export const useNsfwStore = create<NsfwStore>()(
  persist(
    (set) => ({
      showThumbnails: true,
      toggleShowThumbnails: () => set((state) => ({ showThumbnails: !state.showThumbnails })),
    }),
    {
      name: "nsfw-storage-v2",
    }
  )
);
