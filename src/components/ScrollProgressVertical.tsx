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
      className="fixed right-3 top-6 bottom-6 z-50 hidden w-3 cursor-pointer rounded-full border border-white/8 bg-zinc-950/55 shadow-[0_18px_36px_rgba(0,0,0,0.25)] backdrop-blur-xl md:block"
      onClick={handleClick}
    >
      <div className="absolute inset-1 rounded-full bg-white/[0.04]" />
      <div
        className="absolute inset-x-1 bottom-1 rounded-full bg-gradient-to-b from-emerald-300 via-teal-400 to-cyan-500 shadow-[0_0_24px_rgba(45,212,191,0.25)] transition-all duration-150 ease-out"
        style={{ height: `calc(${progress}% - 0.5rem)` }}
      />
      <div 
        className="absolute left-1/2 h-4 w-4 -translate-x-1/2 rounded-full border border-white/35 bg-white shadow-[0_4px_16px_rgba(255,255,255,0.28)] opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        style={{ top: `clamp(0.75rem, ${progress}%, calc(100% - 0.75rem))`, transform: 'translate(-50%, -50%)' }}
      />
    </div>
  );
}
