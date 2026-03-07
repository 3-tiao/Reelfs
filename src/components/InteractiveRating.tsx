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
      <div>
        <h3 className="text-zinc-400 text-sm uppercase tracking-wider mb-3 font-medium">Rating</h3>
        <div className="flex items-center gap-1">
          <div className="flex items-center gap-1 text-teal-400">
            <Star className="w-5 h-5" fill="currentColor" />
            <span className="font-medium text-lg ml-1">{rating.toFixed(1)}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-zinc-400 text-sm uppercase tracking-wider mb-3 font-medium">Rating</h3>
      {rating === undefined || rating === null ? (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                onClick={() => onRate(value)}
                disabled={isRating}
                className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all duration-200 ${
                  isRating
                    ? 'bg-zinc-700 cursor-not-allowed'
                    : 'bg-zinc-800 hover:bg-teal-600 hover:scale-110'
                }`}
              >
                <Star
                  className={`w-5 h-5 ${
                    isRating ? 'text-zinc-500' : 'text-zinc-400'
                  }`}
                  fill={isRating ? 'none' : 'currentColor'}
                />
              </button>
            ))}
          </div>
          <button
            onClick={() => onRate(null)}
            disabled={isRating}
            className={`px-3 py-1.5 text-sm rounded-lg transition-all duration-200 ${
              isRating
                ? 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
                : 'bg-zinc-800 text-zinc-400 hover:bg-red-600 hover:text-white'
            }`}
          >
            清除
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                onClick={() => onRate(value)}
                disabled={isRating}
                className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all duration-200 ${
                  isRating
                    ? 'bg-zinc-700 cursor-not-allowed'
                    : value <= Math.round(rating)
                    ? 'bg-teal-600 hover:bg-teal-500 hover:scale-110'
                    : 'bg-zinc-800 hover:bg-teal-600 hover:scale-110'
                }`}
              >
                <Star
                  className={`w-5 h-5 ${
                    isRating ? 'text-zinc-500' : value <= Math.round(rating) ? 'text-white' : 'text-zinc-400'
                  }`}
                  fill={isRating ? 'none' : value <= Math.round(rating) ? 'currentColor' : 'none'}
                />
              </button>
            ))}
          </div>
          <button
            onClick={() => onRate(null)}
            disabled={isRating}
            className={`px-3 py-1.5 text-sm rounded-lg transition-all duration-200 ${
              isRating
                ? 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
                : 'bg-zinc-800 text-zinc-400 hover:bg-red-600 hover:text-white'
            }`}
          >
            清除
          </button>
        </div>
      )}
    </div>
  );
}
