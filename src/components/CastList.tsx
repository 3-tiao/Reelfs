import { useLocation, useNavigate } from "react-router-dom";
import { getRouteState } from "../lib/navigation";

export default function CastList({ actors }: { actors?: string | null }) {
  const navigate = useNavigate();
  const location = useLocation();
  if (!actors) return null;
  const routeState = getRouteState(location);
  
  return (
    <section className="rounded-[28px] border border-white/8 bg-white/[0.03] p-5 backdrop-blur-xl">
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.3em] text-zinc-500">Cast</h3>
      <div className="flex flex-wrap gap-2.5">
        {actors.split(",").map((actor, i) => (
          <button
            key={i}
            onClick={() => navigate(`/actor/${encodeURIComponent(actor.trim())}`, { state: routeState })}
            className="rounded-full border border-white/10 bg-gradient-to-r from-white/[0.06] to-white/[0.03] px-4 py-2 text-sm font-medium text-zinc-200 transition-all duration-200 hover:-translate-y-0.5 hover:border-teal-400/25 hover:bg-teal-400/12 hover:text-teal-100"
          >
            {actor.trim()}
          </button>
        ))}
      </div>
    </section>
  );
}
