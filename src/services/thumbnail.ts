import { readBinaryFile, writeBinaryFile, exists } from '@tauri-apps/api/fs';
import { invoke } from '@tauri-apps/api/tauri';

export async function generateThumbnail(
  sourcePath: string,
  outputPath: string,
  movieId: number
): Promise<void> {
  try {
    console.log('[缩略图生成] 开始处理:', { sourcePath, outputPath, movieId });

    const fileExists = await exists(outputPath);
    if (fileExists) {
      console.log('[缩略图生成] 缩略图已存在，跳过生成:', outputPath);
      return;
    }

    const startTime = Date.now();

    const data = await readBinaryFile(sourcePath);
    console.log('[缩略图生成] 读取源文件完成，大小:', data.length, 'bytes');

    const img = await createImageBitmap(new Blob([data as BlobPart]));
    console.log('[缩略图生成] 图像加载完成，尺寸:', img.width, 'x', img.height);

    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 450;
    const ctx = canvas.getContext('2d');
    
    if (!ctx) {
      throw new Error('无法获取 canvas context');
    }

    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const ratio = Math.min(
      300 / img.width,
      450 / img.height
    );

    const newWidth = img.width * ratio;
    const newHeight = img.height * ratio;
    const x = (300 - newWidth) / 2;
    const y = (450 - newHeight) / 2;

    ctx.drawImage(img, x, y, newWidth, newHeight);
    console.log('[缩略图生成] 图像调整完成，新尺寸:', newWidth, 'x', newHeight);

    const blob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.85);
    });

    const buffer = await blob.arrayBuffer();
    const uint8Array = new Uint8Array(buffer);
    
    await writeBinaryFile(outputPath, Array.from(uint8Array));
    
    const elapsed = Date.now() - startTime;
    console.log('[缩略图生成] 生成完成:', outputPath, '耗时:', elapsed, 'ms');

    await invoke('update_thumbnail_path', { movieId, thumbnailPath: outputPath });
    console.log('[缩略图生成] 数据库路径更新成功:', movieId);
  } catch (error) {
    console.error('[缩略图生成] 失败:', error);
    throw error;
  }
}

export async function batchGenerateThumbnails(
  movies: Array<{ id: number; file_path: string }>,
  cacheDir: string,
  onProgress?: (current: number, total: number) => void
): Promise<void> {
  console.log('[缩略图生成] 开始批量生成:', movies.length, '个缩略图');

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < movies.length; i++) {
    const movie = movies[i];
    
    const posterPath = getPosterPath(movie.file_path);
    
    if (posterPath) {
      const thumbnailPath = `${cacheDir}/thumbnails/${movie.id}.jpg`;
      
      try {
        await generateThumbnail(posterPath, thumbnailPath, movie.id);
        successCount++;
      } catch (error) {
        console.error('[缩略图生成] 失败: id=', movie.id, 'error=', error);
        failCount++;
      }
    }
    
    if (onProgress) {
      onProgress(i + 1, movies.length);
    }
  }

  console.log('[缩略图生成] 批量生成完成:', successCount, '/', movies.length, '成功，', failCount, '失败');
}

function getPosterPath(videoPath: string): string | null {
  const dir = videoPath.substring(0, videoPath.lastIndexOf('/'));
  const posterNames = ['poster.jpg', 'poster.png', 'folder.jpg', 'cover.jpg'];
  
  for (const name of posterNames) {
    const posterPath = `${dir}/${name}`;
    return posterPath;
  }
  
  return null;
}