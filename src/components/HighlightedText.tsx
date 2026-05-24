import { getHighlightedParts } from "../lib/search";

interface HighlightedTextProps {
  text?: string | null;
  query: string;
  highlightClassName?: string;
  className?: string;
}

export default function HighlightedText({
  text,
  query,
  highlightClassName = "bg-white/15 text-foreground rounded px-0.5",
  className,
}: HighlightedTextProps) {
  if (!text) {
    return null;
  }

  const parts = getHighlightedParts(text, query);

  return (
    <span className={className}>
      {parts.map((part, index) => (
        <span
          key={`${part.text}-${index}`}
          className={part.matched ? highlightClassName : undefined}
        >
          {part.text}
        </span>
      ))}
    </span>
  );
}
