export default function MetadataChips({ title, items }: { title: string; items?: string | null }) {
  if (!items) return null;
  return (
    <div>
      <h3 className="text-zinc-400 text-sm uppercase tracking-wider mb-3 font-medium">{title}</h3>
      <div className="flex flex-wrap gap-2">
        {items.split(",").map((item, index) => (
          <span
            key={index}
            className="px-4 py-1.5 bg-zinc-800/60 border border-zinc-700/50 rounded-lg text-sm text-zinc-200"
          >
            {item.trim()}
          </span>
        ))}
      </div>
    </div>
  );
}
