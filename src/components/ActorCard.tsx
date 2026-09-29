import { memo, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ActorInfo } from "../services/tauri";
import { User } from "lucide-react";
import { useNsfwStore } from "../stores/nsfwStore";
import { acquireThumbnail, releaseThumbnail } from "../lib/thumbnailCache";
import { getRouteState } from "../lib/navigation";

interface ActorCardProps {
  actor: ActorInfo;
}

function ActorCard({ actor }: ActorCardProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { showThumbnails } = useNsfwStore();
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const routeState = getRouteState(location);

  useEffect(() => {
    if (!showThumbnails || !actor.representative_thumbnail) {
      setImageSrc(null);
      return;
    }

    let isMounted = true;
    // Path whose Blob URL this card renders; released on unmount so the LRU evicts it.
    let pinnedPath: string | null = null;

    const pin = (path: string) => {
      if (isMounted) {
        pinnedPath = path;
      } else {
        releaseThumbnail(path);
      }
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          loadThumbnail(() => isMounted, pin);
          observer.disconnect();
        }
      },
      { rootMargin: "100px" }
    );

    if (cardRef.current) {
      observer.observe(cardRef.current);
    }

    return () => {
      isMounted = false;
      observer.disconnect();
      if (pinnedPath) {
        releaseThumbnail(pinnedPath);
      }
    };
  }, [actor, showThumbnails]);

  const loadThumbnail = async (checkMounted: () => boolean, pin: (path: string) => void) => {
    if (actor.representative_thumbnail) {
      const path = actor.representative_thumbnail;
      const url = await acquireThumbnail(path);
      if (url) {
        pin(path);
        if (checkMounted()) {
          setImageSrc(url);
        }
      }
    }
  };

  return (
    <div
      ref={cardRef}
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
