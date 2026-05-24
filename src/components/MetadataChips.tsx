export default function MetadataChips({ title, items }: { title: string; items?: string | null }) {
  if (!items) return null;
  return (
    <div className="rounded-[28px] border border-white/8 bg-white/[0.03] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] backdrop-blur-xl">
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.3em] text-zinc-500">{title}</h3>
      <div className="flex flex-wrap gap-2.5">
        {items.split(",").map((item, index) => (
          <span
            key={index}
            className="rounded-full border border-white/10 bg-gradient-to-r from-white/[0.07] to-white/[0.03] px-4 py-2 text-sm font-medium text-zinc-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
          >
            {item.trim()}
          </span>
        ))}
      </div>
    </div>
  );
}
