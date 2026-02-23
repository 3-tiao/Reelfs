import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Movie } from "../services/tauri";
import { Film } from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/tauri";

interface MovieCardProps {
  movie: Movie;
}

export default function MovieCard({ movie }: MovieCardProps) {
  const navigate = useNavigate();
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (movie.thumbnail_path) {
            setImageSrc(convertFileSrc(movie.thumbnail_path));
          } else if (movie.poster_path) {
            setImageSrc(convertFileSrc(movie.poster_path));
          }
          observer.disconnect();
        }
      },
      { rootMargin: "100px" }
    );

    if (cardRef.current) {
      observer.observe(cardRef.current);
    }

    return () => observer.disconnect();
  }, [movie.thumbnail_path, movie.poster_path]);

  return (
    <div
      ref={cardRef}
      onClick={() => navigate(`/movie/${movie.id}`)}
      className="group cursor-pointer transition-transform duration-200 hover:scale-105"
    >
      <div className="relative aspect-[2/3] bg-gray-800 rounded-lg overflow-hidden shadow-lg">
        {imageSrc ? (
          <img
            src={imageSrc}
            alt={movie.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Film className="w-16 h-16 text-gray-600" />
          </div>
        )}
        
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <div className="absolute bottom-0 left-0 right-0 p-4">
            {movie.rating && (
              <div className="text-yellow-400 text-sm font-semibold mb-1">
                ⭐ {movie.rating.toFixed(1)}
              </div>
            )}
            {movie.plot && (
              <p className="text-white text-xs line-clamp-3">{movie.plot}</p>
            )}
          </div>
        </div>
      </div>
      
      <div className="mt-2 px-1">
        <h3 className="text-white font-medium text-sm truncate">{movie.title}</h3>
        {movie.year && (
          <p className="text-gray-400 text-xs">{movie.year}</p>
        )}
      </div>
    </div>
  );
}
