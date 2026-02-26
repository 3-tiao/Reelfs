import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Movie } from "../services/tauri";
import { Film, RefreshCw } from "lucide-react";
import { readBinaryFile, exists } from "@tauri-apps/api/fs";
import { generateThumbnail } from "../services/thumbnail";

interface MovieCardProps {
  movie: Movie;
}

export default function MovieCard({ movie }: MovieCardProps) {
  const navigate = useNavigate();
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
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
  }, [movie]);

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
    const posterNames = ['poster.jpg', 'poster.png', 'folder.jpg', 'cover.jpg'];
    
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
        ) : isGenerating ? (
          <div className="w-full h-full flex items-center justify-center bg-gray-800">
            <div className="text-center">
              <RefreshCw className="w-12 h-12 text-blue-500 animate-spin mx-auto mb-2" />
              <p className="text-gray-400 text-sm">Generating...</p>
            </div>
          </div>
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
