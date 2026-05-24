import { Star } from "lucide-react";

interface InteractiveRatingProps {
  rating?: number | null;
  isRating?: boolean;
  onRate?: (value: number | null) => void;
}

export default function InteractiveRating({ rating, isRating, onRate }: InteractiveRatingProps) {
  if (!onRate) {
    if (rating === undefined || rating === null) return null;
    return (
      <div className="rounded-[28px] border border-amber-400/14 bg-[linear-gradient(135deg,rgba(120,53,15,0.18),rgba(24,24,27,0.24))] p-5 backdrop-blur-xl">
        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.3em] text-zinc-500">Rating</h3>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 rounded-full border border-amber-300/15 bg-amber-300/8 px-4 py-2 text-amber-300">
            <Star className="w-5 h-5" fill="currentColor" />
            <span className="ml-1 text-lg font-semibold">{rating.toFixed(1)}</span>
          </div>
          <span className="text-sm text-zinc-400">Personal score</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[28px] border border-white/8 bg-white/[0.03] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] backdrop-blur-xl">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.3em] text-zinc-500">Rating</h3>
        {rating !== undefined && rating !== null && (
          <div className="rounded-full border border-amber-300/15 bg-amber-300/8 px-3 py-1 text-sm font-semibold text-amber-300">
            {rating.toFixed(1)} / 5
          </div>
        )}
      </div>
      {rating === undefined || rating === null ? (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-full border border-white/8 bg-zinc-950/45 px-3 py-2">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                onClick={() => onRate(value)}
                disabled={isRating}
                className={`flex h-9 w-9 items-center justify-center rounded-full transition-all duration-200 ${
                  isRating
                    ? 'cursor-not-allowed bg-zinc-800 text-zinc-600'
                    : 'bg-zinc-900 text-zinc-500 hover:-translate-y-0.5 hover:bg-amber-400 hover:text-zinc-950'
                }`}
              >
                <Star
                  className="w-4 h-4"
                  fill={isRating ? 'none' : 'currentColor'}
                />
              </button>
            ))}
          </div>
          <button
            onClick={() => onRate(null)}
            disabled={isRating}
            className={`rounded-full px-4 py-2 text-sm font-medium transition-all duration-200 ${
              isRating
                ? 'cursor-not-allowed bg-zinc-800 text-zinc-500'
                : 'border border-white/10 bg-white/[0.04] text-zinc-300 hover:border-rose-400/30 hover:bg-rose-500/12 hover:text-rose-200'
            }`}
          >
            清除
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-full border border-white/8 bg-zinc-950/45 px-3 py-2">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                onClick={() => onRate(value)}
                disabled={isRating}
                className={`flex h-9 w-9 items-center justify-center rounded-full transition-all duration-200 ${
                  isRating
                    ? 'cursor-not-allowed bg-zinc-800 text-zinc-600'
                    : value <= Math.round(rating)
                    ? 'bg-amber-400 text-zinc-950 hover:-translate-y-0.5 hover:bg-amber-300'
                    : 'bg-zinc-900 text-zinc-500 hover:-translate-y-0.5 hover:bg-amber-400 hover:text-zinc-950'
                }`}
              >
                <Star
                  className="w-4 h-4"
                  fill={isRating ? 'none' : value <= Math.round(rating) ? 'currentColor' : 'none'}
                />
              </button>
            ))}
          </div>
          <button
            onClick={() => onRate(null)}
            disabled={isRating}
            className={`rounded-full px-4 py-2 text-sm font-medium transition-all duration-200 ${
              isRating
                ? 'cursor-not-allowed bg-zinc-800 text-zinc-500'
                : 'border border-white/10 bg-white/[0.04] text-zinc-300 hover:border-rose-400/30 hover:bg-rose-500/12 hover:text-rose-200'
            }`}
          >
            清除
          </button>
        </div>
      )}
    </div>
  );
}
