import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type ViewMode = 'grid' | 'list' | 'actors';
type ActorSortBy = 'name' | 'movie_count';
type SortOrder = 'ASC' | 'DESC';

interface ViewStore {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  actorSortBy: ActorSortBy;
  actorSortOrder: SortOrder;
  actorSearchQuery: string;
  setActorSortBy: (sortBy: ActorSortBy) => void;
  setActorSortOrder: (order: SortOrder) => void;
  setActorSearchQuery: (query: string) => void;
}

export const useViewStore = create<ViewStore>()(
  persist(
    (set) => ({
      viewMode: 'grid',
      setViewMode: (mode) => set({ viewMode: mode }),
      actorSortBy: 'name',
      actorSortOrder: 'ASC',
      actorSearchQuery: '',
      setActorSortBy: (sortBy) => set({ actorSortBy: sortBy }),
      setActorSortOrder: (order) => set({ actorSortOrder: order }),
      setActorSearchQuery: (query) => set({ actorSearchQuery: query }),
    }),
    {
      name: 'view-storage',
    }
  )
);
