import { useEffect, useState } from "react";

interface ScrollProgressProps {
  total: number;
  current: number;
  onScrollTo?: (percentage: number) => void;
}

export default function ScrollProgress({ total, current, onScrollTo }: ScrollProgressProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragPosition, setDragPosition] = useState<number | null>(null);

  const percentage = total > 0 ? (current / total) * 100 : 0;
  const handleClick = (percentage: number) => {
    if (onScrollTo) {
      onScrollTo(percentage);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    setDragPosition(y);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging || dragPosition === null) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const percentage = ((e.clientY - rect.top) / rect.height) * 100;
    handleClick(Math.max(0, Math.min(100, percentage)));
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    setDragPosition(null);
  };

  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        handleMouseMove(e);
      }
    };

    const handleGlobalMouseUp = () => {
      handleMouseUp();
    };

    document.addEventListener('mousemove', handleGlobalMouseMove);
    document.addEventListener('mouseup', handleGlobalMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
      document.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isDragging, dragPosition]);

  return (
    <div className="fixed right-6 top-1/2 bottom-6 w-2 bg-gray-800 rounded-lg shadow-lg overflow-hidden z-50">
      <div className="h-full flex flex-col">
        <div className="flex-1 bg-gray-700 rounded-t-lg relative overflow-hidden">
          <div 
            className="h-full bg-blue-600 transition-all duration-150 ease-out"
            style={{ height: `${percentage}%` }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
          />
        </div>
        
        <div className="flex flex-col items-center justify-center px-2 py-4 space-y-2">
          <div className="text-center">
            <span className="text-xs text-gray-400">{current} / {total}</span>
            <span className="text-sm font-semibold text-white">{percentage.toFixed(0)}%</span>
          </div>
          
          <div className="space-y-1">
            <button
              onClick={() => handleClick(0)}
              className="w-full py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs text-gray-300 transition-colors"
            >
              顶部
            </button>
            <button
              onClick={() => handleClick(50)}
              className="w-full py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs text-gray-300 transition-colors"
            >
              中间
            </button>
            <button
              onClick={() => handleClick(100)}
              className="w-full py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs text-gray-300 transition-colors"
            >
              底部
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
