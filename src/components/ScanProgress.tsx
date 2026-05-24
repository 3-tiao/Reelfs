import { useEffect, useState } from "react";
import { ScanStatus, onScanProgress, onScanComplete, logger } from "../services/tauri";
import { Loader2, FolderSearch, Database, Sparkles, Film } from "lucide-react";

interface ScanProgressProps {
  inline?: boolean;
}

export default function ScanProgress({ inline = false }: ScanProgressProps) {
  const [status, setStatus] = useState<ScanStatus | null>(null);

  useEffect(() => {
    logger.info("[ScanProgress] 设置事件监听");

    const unlistenProgress = onScanProgress((newStatus) => {
      logger.info("[ScanProgress] 收到扫描进度事件:", newStatus);
      setStatus(newStatus);
    });

    const unlistenComplete = onScanComplete((completion) => {
      logger.info("[ScanProgress] 收到扫描完成事件:", completion);
      setStatus(null);
    });

    return () => {
      unlistenProgress.then((fn) => fn());
      unlistenComplete.then((fn) => fn());
    };
  }, []);

  if (!status || !status.is_scanning) {
    return null;
  }

  const progress = status.total_files > 0 ? (status.scanned_files / status.total_files) * 100 : 0;

  const getStageIcon = () => {
    switch (status.stage) {
      case "Scanning":
        return <FolderSearch className="h-4 w-4" />;
      case "Importing":
        return <Database className="h-4 w-4" />;
      case "ProbingVideo":
        return <Film className="h-4 w-4" />;
      case "GeneratingThumbnails":
        return <Sparkles className="h-4 w-4" />;
      default:
        return <Loader2 className="h-4 w-4 animate-spin" />;
    }
  };

  const content = (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.04] text-foreground">
            {getStageIcon()}
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">{status.stage_message}</p>
            <p className="text-xs text-muted-foreground">
              {status.scanned_files} / {status.total_files} 文件
            </p>
          </div>
        </div>
        <span className="text-xl font-light tabular-nums text-foreground">
          {Math.round(progress)}%
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full bg-foreground transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
      {status.current_file && (
        <div className="rounded-md border border-white/[0.06] bg-black/40 px-3 py-2">
          <p className="truncate font-mono text-xs text-muted-foreground">{status.current_file}</p>
        </div>
      )}
    </div>
  );

  if (inline) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-black/40 p-4">{content}</div>
    );
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 border-t border-white/[0.06] bg-card p-4">
      <div className="mx-auto max-w-4xl">{content}</div>
    </div>
  );
}
