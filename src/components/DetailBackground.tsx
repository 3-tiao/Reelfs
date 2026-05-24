export default function DetailBackground({ fanartSrc }: { fanartSrc?: string | null }) {
  return (
    <div className="absolute inset-0 z-0 overflow-hidden">
      <div className="absolute inset-0 bg-background" />
      {fanartSrc && (
        <img
          src={fanartSrc}
          alt=""
          className="h-full w-full scale-105 object-cover opacity-20 saturate-50"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/85 to-background" />
    </div>
  );
}
