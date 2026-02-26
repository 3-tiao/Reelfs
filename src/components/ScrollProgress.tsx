interface ScrollProgressProps {
  percentage: number;
  onScrollTo: (percentage: number) => void;
}

export default function ScrollProgress({ percentage, onScrollTo }: ScrollProgressProps) {
  const safePercentage = isNaN(percentage) ? 0 : Math.max(0, Math.min(100, percentage));
  
  console.log('[ScrollProgress] 渲染:', { percentage, safePercentage });
  
  return (
    <div className="fixed right-4 top-20 bottom-20 w-3 flex flex-col items-center justify-center z-50">
      <div className="relative h-full w-full bg-gray-800 rounded-full overflow-hidden">
        <div 
          className="absolute bottom-0 left-0 right-0 bg-blue-600 rounded-full transition-all duration-150"
          style={{ height: `${safePercentage}%` }}
        />
      </div>
      
      <div className="mt-2 text-xs text-gray-400">
        {safePercentage.toFixed(0)}%
      </div>
    </div>
  );
}
