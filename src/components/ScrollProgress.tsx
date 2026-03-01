import { useState, useRef, useCallback, useEffect } from "react";

interface ScrollProgressProps {
  thumbHeight: number;
  thumbPosition: number;
  onScrollTo: (percentage: number) => void;
}

export default function ScrollProgress({ thumbHeight, thumbPosition, onScrollTo }: ScrollProgressProps) {
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const safeThumbHeight = isNaN(thumbHeight) ? 0 : Math.max(0, Math.min(100, thumbHeight));
  const safeThumbPosition = isNaN(thumbPosition) ? 0 : Math.max(0, Math.min(100 - safeThumbHeight, thumbPosition));

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    
    const container = containerRef.current;
    if (!container) return;
    
    const rect = container.getBoundingClientRect();
    const clickY = e.clientY - rect.top;
    const percentage = (clickY / rect.height) * 100;
    onScrollTo(Math.max(0, Math.min(100, percentage)));
  }, [onScrollTo]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    
    const container = containerRef.current;
    if (!container) return;
    
    const rect = container.getBoundingClientRect();
    const moveY = e.clientY - rect.top;
    const percentage = (moveY / rect.height) * 100;
    onScrollTo(Math.max(0, Math.min(100, percentage)));
  }, [isDragging, onScrollTo]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);
  
  return (
    <div className="fixed right-4 top-[72px] bottom-4 w-3 flex flex-col items-center justify-center z-50">
      <div 
        ref={containerRef}
        className="relative h-full w-full bg-gray-800 rounded-full overflow-hidden cursor-pointer"
        onMouseDown={handleMouseDown}
      >
        <div 
          className={`absolute left-0 right-0 rounded-full transition-all duration-150 ${
            isDragging ? 'bg-blue-400' : 'bg-blue-600 hover:bg-blue-500'
          }`}
          style={{ 
            height: `${safeThumbHeight}%`,
            top: `${safeThumbPosition}%`
          }}
        />
      </div>
    </div>
  );
}
