interface ScrollProgressVerticalProps {
  progress: number;
  onSeek?: (percentage: number) => void;
}

export default function ScrollProgressVertical({ progress, onSeek }: ScrollProgressVerticalProps) {
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const percentage = (y / rect.height) * 100;
    onSeek(Math.max(0, Math.min(100, percentage)));
  };

  return (
    <div 
      className="fixed right-0 top-0 bottom-0 w-2 bg-zinc-800/50 z-50 cursor-pointer group"
      onClick={handleClick}
    >
      <div
        className="w-full bg-gradient-to-b from-teal-500 to-teal-400 transition-all duration-150 ease-out"
        style={{ height: `${progress}%` }}
      />
      <div 
        className="absolute left-0 w-full h-3 bg-white rounded opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ top: `${progress}%`, transform: 'translateY(-50%)' }}
      />
    </div>
  );
}
