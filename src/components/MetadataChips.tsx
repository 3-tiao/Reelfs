export default function MetadataChips({ title, items }: { title: string; items?: string | null }) {
  const chips = items?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
  if (chips.length === 0) return null;

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-card p-5">
      <h3 className="mb-3 text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
        {title}
      </h3>
      <div className="flex flex-wrap gap-2">
        {chips.map((item) => (
          <span
            key={item}
            className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-foreground/90"
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}
