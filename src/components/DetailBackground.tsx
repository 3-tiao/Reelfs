export default function DetailBackground({ fanartSrc }: { fanartSrc?: string | null }) {
  if (!fanartSrc) return null;
  return (
    <div className="absolute inset-0 z-0 overflow-hidden">
      <img
        src={fanartSrc}
        alt=""
        className="w-full h-full object-cover opacity-30 scale-105"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-zinc-900/60 via-zinc-950/85 to-zinc-950"></div>
    </div>
  );
}
