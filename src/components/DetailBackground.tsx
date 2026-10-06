import { useState } from "react";

export default function DetailBackground({ fanartSrc }: { fanartSrc?: string | null }) {
  // The fanart file may vanish between the existence check and the asset load;
  // hide the broken image instead of rendering a torn poster at 20% opacity.
  const [failed, setFailed] = useState(false);
  return (
    <div className="absolute inset-0 z-0 overflow-hidden">
      <div className="absolute inset-0 bg-background" />
      {fanartSrc && !failed && (
        <img
          src={fanartSrc}
          alt=""
          className="h-full w-full scale-105 object-cover opacity-20 saturate-50"
          onError={() => setFailed(true)}
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/85 to-background" />
    </div>
  );
}
