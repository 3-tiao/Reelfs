import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Movie } from "../services/tauri";
import { Film, RefreshCw, Eye, Layers } from "lucide-react";
import { readBinaryFile, exists } from "@tauri-apps/api/fs";
import { generateThumbnail } from "../services/thumbnail";
import { useNsfwStore } from "../stores/nsfwStore";

interface MovieCardProps {
  movie: Movie;
}

export default function MovieCard({ movie }: MovieCardProps) {
  const navigate = useNavigate();
  const { showThumbnails } = useNsfwStore();
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showThumbnails) {
      setImageSrc(null);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          loadOrGenerateThumbnail();
          observer.disconnect();
        }
      },
      { rootMargin: "100px" }
    );

    if (cardRef.current) {
      observer.observe(cardRef.current);
    }

    return () => observer.disconnect();
  }, [movie, showThumbnails]);

  const loadOrGenerateThumbnail = async () => {
    if (movie.thumbnail_path) {
      loadLocalImage(movie.thumbnail_path);
    } else {
      await generateAndLoadThumbnail();
    }
  };

  const generateAndLoadThumbnail = async () => {
    const posterPath = await getPosterPath(movie.file_path);
    
    if (!posterPath) {
      console.error('[MovieCard] 没有海报路径，无法生成缩略图');
      return;
    }
    
    try {
      setIsGenerating(true);
      console.log('[MovieCard] 开始生成缩略图:', { id: movie.id, title: movie.title });
      
      const thumbnailPath = `/Users/user/.reelfs/cache/thumbnails/${movie.id}.jpg`;
      await generateThumbnail(posterPath, thumbnailPath, movie.id);
      
      loadLocalImage(thumbnailPath);
    } catch (error) {
      console.error('[MovieCard] 生成缩略图失败:', error);
      loadLocalImage(posterPath);
    } finally {
      setIsGenerating(false);
    }
  };

  const getPosterPath = async (videoPath: string): Promise<string | null> => {
    const dir = videoPath.substring(0, videoPath.lastIndexOf('/'));
    const posterNames = ['poster.jpg', 'poster.png', 'folder.jpg', 'cover.jpg', 'fanart.jpg', 'fanart.png'];
    
    for (const name of posterNames) {
      const posterPath = `${dir}/${name}`;
      if (await exists(posterPath)) {
        return posterPath;
      }
    }
    
    return null;
  };

  const loadLocalImage = async (path: string) => {
    try {
      console.log('[MovieCard] 开始加载图片:', path);
      console.log('[MovieCard] 电影信息:', { id: movie.id, title: movie.title });
      
      const data = await readBinaryFile(path);
      console.log('[MovieCard] 文件读取成功，大小:', data.length, 'bytes');
      
      const blob = new Blob([data as BlobPart], { type: 'image/jpeg' });
      const url = URL.createObjectURL(blob);
      console.log('[MovieCard] Blob URL 创建成功:', url);
      
      setImageSrc(url);
      console.log('[MovieCard] 图片加载完成');
    } catch (error) {
      console.error('[MovieCard] 加载图片失败:', path, error);
      console.error('[MovieCard] 错误详情:', {
        path,
        error: String(error),
        movieId: movie.id,
        movieTitle: movie.title
      });
    }
  };

  return (
    <div
      ref={cardRef}
      onClick={() => movie.group_id ? navigate(`/video-group/${movie.group_id}`) : navigate(`/movie/${movie.id}`)}
      className="group cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:-translate-y-1"
    >
      <div className="relative aspect-[2/3] bg-zinc-800/80 backdrop-blur-sm rounded-xl overflow-hidden shadow-lg hover:shadow-2xl hover:shadow-teal-500/10 border border-zinc-700/50 group-hover:border-teal-500/30 transition-all duration-300">
        {imageSrc ? (
          <img
            src={imageSrc}
            alt={movie.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : isGenerating ? (
          <div className="w-full h-full flex items-center justify-center bg-zinc-800/80">
            <div className="text-center">
              <RefreshCw className="w-12 h-12 text-teal-400 animate-spin mx-auto mb-2" />
              <p className="text-zinc-400 text-sm">Generating...</p>
            </div>
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Film className="w-16 h-16 text-zinc-600" />
          </div>
        )}
        
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/90 via-zinc-900/40 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300 flex flex-col justify-end">
          <div className="p-4 transform translate-y-4 group-hover:translate-y-0 transition-transform duration-300">
            {movie.rating && (
              <div className="text-teal-400 text-sm font-semibold mb-1.5 flex items-center gap-1">
                ⭐ {movie.rating.toFixed(1)}
              </div>
            )}
            {movie.plot && (
              <p className="text-zinc-300 text-xs leading-relaxed line-clamp-3 mb-2">{movie.plot}</p>
            )}
            <div className="flex items-center gap-2 mt-2 text-white font-medium text-sm">
              <div className="w-8 h-8 rounded-full bg-teal-500 flex items-center justify-center">
                <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
              </div>
              Play
            </div>
          </div>
        </div>
        
        {movie.is_watched === 1 && (
          <div className="absolute top-2 right-2 bg-teal-500/80 rounded-full p-1 backdrop-blur-sm">
            <Eye className="w-4 h-4 text-white" />
          </div>
        )}
        
        {movie.group_id && (
          <div 
            className="absolute top-2 left-2 bg-purple-500/80 rounded-full p-1 backdrop-blur-sm cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/video-group/${movie.group_id}`);
            }}
          >
            <Layers className="w-4 h-4 text-white" />
          </div>
        )}
      </div>
      
      <div className="mt-2 px-1">
        <h3 className="text-zinc-100 font-medium text-sm truncate">{movie.title}</h3>
        {movie.year && (
          <p className="text-zinc-400 text-xs">{movie.year}</p>
        )}
      </div>
    </div>
  );
}
