interface ScrollProgressProps {
  thumbHeight: number;
  thumbPosition: number;
  onScrollTo: (percentage: number) => void;
}

export default function ScrollProgress({ thumbHeight, thumbPosition, onScrollTo }: ScrollProgressProps) {
  const safeThumbHeight = isNaN(thumbHeight) ? 0 : Math.max(0, Math.min(100, thumbHeight));
  const safeThumbPosition = isNaN(thumbPosition) ? 0 : Math.max(0, Math.min(100 - safeThumbHeight, thumbPosition));
  
  return (
    <div className="fixed right-4 top-20 bottom-20 w-3 flex flex-col items-center justify-center z-50">
      <div className="relative h-full w-full bg-gray-800 rounded-full overflow-hidden">
        <div 
          className="absolute left-0 right-0 bg-blue-600 rounded-full transition-all duration-150 cursor-pointer hover:bg-blue-500"
          style={{ 
            height: `${safeThumbHeight}%`,
            top: `${safeThumbPosition}%`
          }}
        />
      </div>
    </div>
  );
}
