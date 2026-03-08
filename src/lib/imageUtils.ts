import { readBinaryFile } from '@tauri-apps/api/fs';
import { invoke } from '@tauri-apps/api/tauri';
import { logger } from '../services/tauri';

/**
 * 并行检查多个文件路径，返回第一个存在的路径。
 * 相比串行 exists() 循环，可大幅减少 NAS 等高延迟场景下的等待时间。
 *
 * 工作原理：
 *  - 按优先级分批发出检查请求（batch_size 控制并发），
 *    同一批内并发，批次间保留优先级顺序。
 *  - 使用 Rust 侧的 `check_file_exists` 命令代替 Tauri fs.exists，
 *    避免逐个 IPC 调用的额外开销。
 */
export async function findFirstExisting(
  paths: string[],
  batchSize = 4
): Promise<string | null> {
  // 分批并行检查，保留优先级顺序
  for (let i = 0; i < paths.length; i += batchSize) {
    const batch = paths.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map((p) =>
        invoke<boolean>('check_file_exists', { path: p }).catch(() => false)
      )
    );
    for (let j = 0; j < results.length; j++) {
      if (results[j]) return batch[j];
    }
  }
  return null;
}

/**
 * 同时并行查找 poster 和 fanart，返回两者结果。
 * 比顺序查找快约 2x。
 */
export async function findPosterAndFanart(videoPath: string): Promise<{
  posterPath: string | null;
  fanartPath: string | null;
}> {
  const dir = videoPath.substring(0, videoPath.lastIndexOf('/'));

  const posterCandidates = [
    `${dir}/poster.jpg`,
    `${dir}/poster.png`,
    `${dir}/folder.jpg`,
    `${dir}/cover.jpg`,
  ];

  const fanartCandidates = [
    `${dir}/fanart.jpg`,
    `${dir}/fanart.png`,
    `${dir}/backdrop.jpg`,
    `${dir}/background.jpg`,
  ];

  const [posterPath, fanartPath] = await Promise.all([
    findFirstExisting(posterCandidates),
    findFirstExisting(fanartCandidates),
  ]);

  return { posterPath, fanartPath };
}

/**
 * 直接读取图片文件并创建 Blob URL，不走首页缩略图的并发限制队列。
 * 适用于详情页这种一次只加载 1~2 张大图的场景。
 */
export async function loadImageAsBlobUrl(path: string): Promise<string | null> {
  try {
    const data = await readBinaryFile(path);
    const blob = new Blob([data as BlobPart], { type: 'image/jpeg' });
    return URL.createObjectURL(blob);
  } catch (error) {
    logger.error('[imageUtils] 加载图片失败:', path, String(error));
    return null;
  }
}
