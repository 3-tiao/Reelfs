export default function DetailBackground({ fanartSrc }: { fanartSrc?: string | null }) {
  return (
    <div className="absolute inset-0 z-0 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(20,184,166,0.18),transparent_26%),radial-gradient(circle_at_20%_20%,rgba(245,158,11,0.12),transparent_18%),linear-gradient(180deg,rgba(9,9,11,0.92),rgba(9,9,11,1))]" />
      {fanartSrc && (
        <img
          src={fanartSrc}
          alt=""
          className="h-full w-full scale-105 object-cover opacity-28 saturate-[0.92]"
        />
      )}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(9,9,11,0.32),rgba(9,9,11,0.7)_24%,rgba(9,9,11,0.95)_65%,rgb(9,9,11)_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.05),transparent_28%)] mix-blend-screen" />
    </div>
  );
}
