import { useEffect, useState } from "react";

// The virtualized grids/lists in Home sit below the fixed chrome (search bar,
// filter/sort bar); their viewport is the window minus that fixed height.
// Single source of truth — previously duplicated as `window.innerHeight - 80`
// in ActorGrid / MovieGrid / MovieList.
const CHROME_HEIGHT = 80;

export interface ViewportSize {
  width: number;
  height: number;
}

function measureViewport(): ViewportSize {
  return {
    width: window.innerWidth,
    height: Math.max(0, window.innerHeight - CHROME_HEIGHT),
  };
}

/**
 * Shared window-dimension source for the virtualized grids/lists.
 *
 * Tracks window resizes (the same signal the previous per-component listeners
 * used, so behavior is unchanged) while centralizing the chrome offset.
 * Measuring the actual scroll container instead — a true useElementSize via
 * ResizeObserver — would require rewiring the Home layout around a full-height
 * container and is tracked as follow-up work.
 */
export function useViewportSize(): ViewportSize {
  const [size, setSize] = useState<ViewportSize>(measureViewport);

  useEffect(() => {
    const handleResize = () => {
      setSize(measureViewport());
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return size;
}
