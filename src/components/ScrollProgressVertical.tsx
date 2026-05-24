import { useEffect, useRef, useState } from "react";

interface ScrollProgressVerticalProps {
  progress: number;
  onSeek?: (percentage: number) => void;
  /** Distance in px from the top of the viewport where the track should start. */
  topOffset?: number;
  /** Distance in px from the bottom of the viewport where the track should end. */
  bottomOffset?: number;
}

const THUMB_HEIGHT_PX = 48;

export default function ScrollProgressVertical({
  progress,
  onSeek,
  topOffset = 16,
  bottomOffset = 16,
}: ScrollProgressVerticalProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastProgressRef = useRef(progress);

  useEffect(() => {
    if (progress !== lastProgressRef.current) {
      lastProgressRef.current = progress;
      setIsVisible(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => setIsVisible(false), 900);
    }
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [progress]);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const trackHeight = rect.height;
    const y = e.clientY - rect.top;
    const targetThumbTop = Math.max(0, Math.min(trackHeight - THUMB_HEIGHT_PX, y - THUMB_HEIGHT_PX / 2));
    const percentage =
      trackHeight > THUMB_HEIGHT_PX
        ? (targetThumbTop / (trackHeight - THUMB_HEIGHT_PX)) * 100
        : 0;
    onSeek(Math.max(0, Math.min(100, percentage)));
  };

  const shown = isVisible || isHovered;
  const clampedProgress = Math.max(0, Math.min(100, progress));

  return (
    <div
      className={`fixed right-1.5 z-40 hidden w-3 cursor-pointer md:block ${
        shown ? "opacity-100" : "opacity-0"
      } transition-opacity duration-300`}
      style={{ top: topOffset, bottom: bottomOffset }}
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="absolute inset-y-0 right-1 w-px rounded-full bg-white/[0.08]" />
      <div
        className={`absolute right-0.5 w-1 rounded-full transition-colors duration-150 ${
          isHovered ? "bg-white/80" : "bg-white/40"
        }`}
        style={{
          top: `calc(${clampedProgress}% - ${(clampedProgress * THUMB_HEIGHT_PX) / 100}px)`,
          height: `${THUMB_HEIGHT_PX}px`,
        }}
      />
    </div>
  );
}
