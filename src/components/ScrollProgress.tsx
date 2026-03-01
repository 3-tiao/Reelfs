import { useState, useRef, useCallback, useEffect } from "react";

interface ScrollProgressProps {
  thumbHeight: number;
  thumbPosition: number;
  onScrollTo: (percentage: number) => void;
  totalCount?: number;
  currentIndex?: number;
}

export default function ScrollProgress({ 
  thumbHeight, 
  thumbPosition, 
  onScrollTo,
  totalCount,
  currentIndex 
}: ScrollProgressProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
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
  
  const showTooltip = isHovering || isDragging;
  
  return (
    <div 
      className="fixed right-2 top-[72px] bottom-4 flex items-center z-50 group"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      {/* 提示信息 */}
      {showTooltip && (
        <div className="absolute right-8 bg-gray-800 text-white text-xs px-2 py-1 rounded shadow-lg whitespace-nowrap">
          {currentIndex !== undefined && totalCount !== undefined ? (
            <span>{currentIndex} / {totalCount}</span>
          ) : (
            <span>{Math.round(safeThumbPosition)}%</span>
          )}
        </div>
      )}
      
      {/* 滚动条轨道 */}
      <div 
        ref={containerRef}
        className={`relative h-full rounded-full cursor-pointer transition-all duration-200 ${
          isDragging || isHovering ? 'w-4 bg-gray-700' : 'w-2 bg-gray-800/50'
        }`}
        onMouseDown={handleMouseDown}
      >
        {/* 滚动条滑块 */}
        <div 
          className={`absolute left-0 right-0 rounded-full transition-all ${
            isDragging ? 'bg-blue-400 w-full' : isHovering ? 'bg-blue-500' : 'bg-blue-600/80'
          }`}
          style={{ 
            height: `${safeThumbHeight}%`,
            top: `${safeThumbPosition}%`,
            transition: isDragging ? 'none' : 'all 150ms'
          }}
        />
      </div>
    </div>
  );
}
