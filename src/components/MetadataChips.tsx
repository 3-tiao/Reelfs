export default function MetadataChips({ title, items }: { title: string; items?: string | null }) {
  if (!items) return null;
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-card p-5">
      <h3 className="mb-3 text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
        {title}
      </h3>
      <div className="flex flex-wrap gap-2">
        {items.split(",").map((item, index) => (
          <span
            key={index}
            className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-foreground/90"
          >
            {item.trim()}
          </span>
        ))}
      </div>
    </div>
  );
}
