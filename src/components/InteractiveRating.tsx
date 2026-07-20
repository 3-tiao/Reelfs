import { Star } from "lucide-react";

interface InteractiveRatingProps {
  /** The score owned by the entity currently being edited. */
  rating?: number | null;
  /** A read-only score to display until this entity receives its own score. */
  fallbackRating?: number | null;
  fallbackLabel?: string;
  title?: string;
  isRating?: boolean;
  onRate?: (value: number | null) => void;
}

export default function InteractiveRating({
  rating,
  fallbackRating,
  fallbackLabel,
  title = "Rating",
  isRating,
  onRate,
}: InteractiveRatingProps) {
  if (!onRate) {
    if (rating === undefined || rating === null) return null;
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-card p-5">
        <h3 className="mb-3 text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Rating
        </h3>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5">
            <Star className="h-3.5 w-3.5 text-foreground" fill="currentColor" />
            <span className="text-sm font-semibold text-foreground">{rating.toFixed(1)}</span>
          </div>
          <span className="text-xs text-muted-foreground">Personal score</span>
        </div>
      </div>
    );
  }

  const hasOwnRating = rating !== undefined && rating !== null;
  const displayRating = hasOwnRating ? rating : fallbackRating;
  const isFallback = !hasOwnRating && displayRating !== undefined && displayRating !== null;
  const filled = displayRating === undefined || displayRating === null ? 0 : Math.round(displayRating);

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
          {title}
        </h3>
        {displayRating !== undefined && displayRating !== null && (
          <span className="text-xs font-medium text-foreground">{displayRating.toFixed(1)} / 5</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-full border border-white/[0.06] bg-black/40 px-2 py-1">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              onClick={() => onRate(value)}
              disabled={isRating}
              className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
                isRating
                  ? "cursor-not-allowed text-muted-foreground/40"
                  : value <= filled
                    ? "text-foreground"
                    : "text-muted-foreground/40 hover:text-foreground"
              }`}
            >
              <Star
                className="h-3.5 w-3.5"
                fill={!isRating && value <= filled ? "currentColor" : "none"}
              />
            </button>
          ))}
        </div>
        {isFallback && fallbackLabel && (
          <span className="text-xs text-muted-foreground">{fallbackLabel}</span>
        )}
        {hasOwnRating && (
          <button
            onClick={() => onRate(null)}
            disabled={isRating}
            className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-white/[0.16] hover:text-foreground"
          >
            清除
          </button>
        )}
      </div>
    </div>
  );
}
