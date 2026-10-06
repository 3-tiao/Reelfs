import { memo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ActorInfo } from "../services/tauri";
import { User } from "lucide-react";
import { useNsfwStore } from "../stores/nsfwStore";
import { thumbnailUrl } from "../lib/thumbnailCache";
import { getRouteState } from "../lib/navigation";

interface ActorCardProps {
  actor: ActorInfo;
}

function ActorCard({ actor }: ActorCardProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { showThumbnails } = useNsfwStore();
  const routeState = getRouteState(location);
  // Asset URL loads natively via loading="lazy". ActorInfo carries no mtime-like
  // field, so unlike movie thumbnails there is no ?v= token here — a regenerated
  // representative thumbnail refreshes when the actor grid is re-fetched.
  const imageSrc =
    showThumbnails && actor.representative_thumbnail
      ? thumbnailUrl(actor.representative_thumbnail)
      : null;

  return (
    <div
      onClick={() => navigate(`/actor/${encodeURIComponent(actor.name)}`, { state: routeState })}
      className="group cursor-pointer"
    >
      <div className="relative aspect-[2/3] overflow-hidden rounded-xl border border-white/[0.06] bg-card transition-colors duration-200 group-hover:border-white/[0.14]">
        {imageSrc ? (
          <img
            src={imageSrc}
            alt={actor.name}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <User className="h-12 w-12 text-white/15" />
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent px-3 pb-3 pt-12">
          <h3 className="truncate text-sm font-semibold text-white">{actor.name}</h3>
          <p className="mt-0.5 text-xs text-white/60">{actor.movie_count} 部作品</p>
        </div>
      </div>
    </div>
  );
}

export default memo(ActorCard);
