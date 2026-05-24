import { useLocation, useNavigate } from "react-router-dom";
import { getRouteState } from "../lib/navigation";

export default function CastList({ actors }: { actors?: string | null }) {
  const navigate = useNavigate();
  const location = useLocation();
  if (!actors) return null;
  const routeState = getRouteState(location);

  return (
    <section className="rounded-2xl border border-white/[0.06] bg-card p-5">
      <h3 className="mb-3 text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
        Cast
      </h3>
      <div className="flex flex-wrap gap-2">
        {actors.split(",").map((actor, i) => (
          <button
            key={i}
            onClick={() =>
              navigate(`/actor/${encodeURIComponent(actor.trim())}`, { state: routeState })
            }
            className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-foreground/90 transition-colors hover:border-white/[0.16] hover:bg-white/[0.08]"
          >
            {actor.trim()}
          </button>
        ))}
      </div>
    </section>
  );
}
