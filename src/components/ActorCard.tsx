import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ActorInfo } from "../services/tauri";
import { User } from "lucide-react";
import { useNsfwStore } from "../stores/nsfwStore";
import { getCachedThumbnail } from "../lib/thumbnailCache";

interface ActorCardProps {
  actor: ActorInfo;
}

export default function ActorCard({ actor }: ActorCardProps) {
  const navigate = useNavigate();
  const { showThumbnails } = useNsfwStore();
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showThumbnails || !actor.representative_thumbnail) {
      setImageSrc(null);
      return;
    }

    let isMounted = true;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          loadThumbnail(() => isMounted);
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
    };
  }, [actor, showThumbnails]);

  const loadThumbnail = async (checkMounted: () => boolean) => {
    if (actor.representative_thumbnail) {
      const url = await getCachedThumbnail(actor.representative_thumbnail);
      if (checkMounted() && url) {
        setImageSrc(url);
      }
    }
  };

  return (
    <div
      ref={cardRef}
      onClick={() => navigate(`/actor/${encodeURIComponent(actor.name)}`)}
      className="group cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:-translate-y-1"
    >
      <div className="relative aspect-[2/3] bg-zinc-800/80 backdrop-blur-sm rounded-xl overflow-hidden shadow-lg hover:shadow-2xl hover:shadow-violet-500/10 border border-zinc-700/50 group-hover:border-violet-500/30 transition-all duration-300">
        {imageSrc ? (
          <img
            src={imageSrc}
            alt={actor.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900">
            <User className="w-16 h-16 text-zinc-600" />
          </div>
        )}
        
        {/* Always-visible bottom overlay with actor info */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-zinc-950/95 via-zinc-950/70 to-transparent pt-12 pb-3 px-3">
          <h3 className="text-white font-semibold text-sm truncate">{actor.name}</h3>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-violet-400 text-xs font-medium">
              {actor.movie_count} 部作品
            </span>
          </div>
        </div>

        {/* Hover overlay with play-like action */}
        <div className="absolute inset-0 bg-violet-500/10 opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center justify-center">
          <div className="w-12 h-12 rounded-full bg-violet-500/80 backdrop-blur-sm flex items-center justify-center transform scale-75 group-hover:scale-100 transition-transform duration-300">
            <User className="w-6 h-6 text-white" />
          </div>
        </div>
      </div>
    </div>
  );
}
