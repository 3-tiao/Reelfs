import { useNavigate } from "react-router-dom";

export default function CastList({ actors }: { actors?: string | null }) {
  const navigate = useNavigate();
  if (!actors) return null;
  
  return (
    <div>
      <h3 className="text-zinc-400 text-sm uppercase tracking-wider mb-2 font-medium">Cast</h3>
      <div className="flex flex-wrap gap-2">
        {actors.split(",").map((actor, i) => (
          <button
            key={i}
            onClick={() => navigate(`/actor/${encodeURIComponent(actor.trim())}`)}
            className="px-3 py-1 bg-zinc-800/60 hover:bg-teal-600/30 border border-zinc-700/50 hover:border-teal-500/50 rounded-lg text-sm text-zinc-200 hover:text-teal-300 transition-all duration-200"
          >
            {actor.trim()}
          </button>
        ))}
      </div>
    </div>
  );
}
