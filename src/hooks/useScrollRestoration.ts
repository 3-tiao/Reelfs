import { useCallback, useEffect, useRef, useState } from "react";
import { useMovieStore } from "../stores/movieStore";

export interface ScrollController {
  getScrollPosition: () => number;
  getScrollPercentage: () => number;
  scrollToPosition: (scrollTop: number) => void;
  scrollToPercentage: (percentage: number) => void;
}

interface UseScrollRestorationOptions {
  storageKey: string;
  itemCount: number;
  getController: () => ScrollController | null;
}

export function useScrollRestoration({
  storageKey,
  itemCount,
  getController,
}: UseScrollRestorationOptions) {
  const { setScrollPosition, setScrollProgress } = useMovieStore();
  const [scrollProgress, setLocalScrollProgress] = useState(0);
  const lastSavedPositionRef = useRef(0);
  const restoredKeyRef = useRef<string | null>(null);
  const isRestoringRef = useRef(false);

  const syncScrollProgressFromController = useCallback(() => {
    const controller = getController();
    if (controller) {
      setLocalScrollProgress(controller.getScrollPercentage());
    }
  }, [getController]);

  useEffect(() => {
    setLocalScrollProgress(useMovieStore.getState().scrollProgresses[storageKey] || 0);
  }, [storageKey]);

  useEffect(() => {
    const savedScrollPos = useMovieStore.getState().scrollPositions[storageKey] || 0;
    const savedProgress = useMovieStore.getState().scrollProgresses[storageKey] || 0;

    if (itemCount > 0 && restoredKeyRef.current !== storageKey) {
      restoredKeyRef.current = storageKey;
      isRestoringRef.current = true;
      lastSavedPositionRef.current = savedScrollPos;
      setLocalScrollProgress(savedProgress);

      requestAnimationFrame(() => {
        const controller = getController();
        if (controller) {
          controller.scrollToPosition(savedScrollPos);
        }

        setTimeout(() => {
          syncScrollProgressFromController();
          isRestoringRef.current = false;
        }, 100);
      });
    } else if (itemCount > 0) {
      requestAnimationFrame(() => {
        syncScrollProgressFromController();
      });
    }
  }, [storageKey, itemCount, getController, syncScrollProgressFromController]);

  const handleScroll = useCallback(() => {
    if (isRestoringRef.current) {
      return;
    }

    const controller = getController();
    if (!controller) {
      return;
    }

    const position = controller.getScrollPosition();
    const progress = controller.getScrollPercentage();
    setLocalScrollProgress(progress);

    if (Math.abs(position - lastSavedPositionRef.current) > 100) {
      lastSavedPositionRef.current = position;
      setScrollPosition(storageKey, position);
    }

    setScrollProgress(storageKey, progress);
  }, [getController, setScrollPosition, setScrollProgress, storageKey]);

  const handleSeek = useCallback((percentage: number) => {
    const controller = getController();
    if (!controller) {
      return;
    }

    controller.scrollToPercentage(percentage);
    setLocalScrollProgress(percentage);
    setScrollProgress(storageKey, percentage);
  }, [getController, setScrollProgress, storageKey]);

  const resetRestoration = useCallback(() => {
    restoredKeyRef.current = null;
  }, []);

  return {
    scrollProgress,
    handleScroll,
    handleSeek,
    isRestoringRef,
    resetRestoration,
  };
}
