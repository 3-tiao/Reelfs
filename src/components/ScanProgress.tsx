import { useEffect, useState } from "react";
import { ScanStatus, onScanProgress, onScanComplete } from "../services/tauri";
import { Loader2, FileVideo, Image, FolderSearch, Database, Sparkles } from "lucide-react";

interface ScanProgressProps {
  inline?: boolean;
}

export default function ScanProgress({ inline = false }: ScanProgressProps) {
  const [status, setStatus] = useState<ScanStatus | null>(null);
  const [startTime, setStartTime] = useState<number | null>(null);

  useEffect(() => {
    console.log('[ScanProgress] 设置事件监听');
    
    const unlistenProgress = onScanProgress((newStatus) => {
      console.log('[ScanProgress] 收到扫描进度事件:', newStatus);
      if (newStatus.is_scanning && !startTime) {
        setStartTime(Date.now());
      }
      setStatus(newStatus);
    });

    const unlistenComplete = onScanComplete(() => {
      console.log('[ScanProgress] 收到扫描完成事件');
      setStatus(null);
      setStartTime(null);
    });

    return () => {
      unlistenProgress.then((fn) => fn());
      unlistenComplete.then((fn) => fn());
    };
  }, []);

  if (!status || !status.is_scanning) {
    return null;
  }

  const progress = status.total_files > 0
    ? (status.scanned_files / status.total_files) * 100
    : 0;

  const getStageIcon = () => {
    switch (status.stage) {
      case "Scanning":
        return <FolderSearch className="w-5 h-5" />;
      case "Importing":
        return <Database className="w-5 h-5" />;
      case "GeneratingThumbnails":
        return <Sparkles className="w-5 h-5" />;
      default:
        return <Loader2 className="w-5 h-5" />;
    }
  };

  const getStageColor = () => {
    switch (status.stage) {
      case "Scanning":
        return "text-blue-400";
      case "Importing":
        return "text-green-400";
      case "GeneratingThumbnails":
        return "text-purple-400";
      default:
        return "text-blue-400";
    }
  };

  const getStageBgColor = () => {
    switch (status.stage) {
      case "Scanning":
        return "bg-blue-500/20";
      case "Importing":
        return "bg-green-500/20";
      case "GeneratingThumbnails":
        return "bg-purple-500/20";
      default:
        return "bg-blue-500/20";
    }
  };

  const getProgressColor = () => {
    switch (status.stage) {
      case "Scanning":
        return "from-blue-500 to-blue-400";
      case "Importing":
        return "from-green-500 to-green-400";
      case "GeneratingThumbnails":
        return "from-purple-500 to-purple-400";
      default:
        return "from-blue-500 to-blue-400";
    }
  };

  const getEstimatedTime = () => {
    if (!startTime || progress === 0 || progress < 5) return null;
    
    const elapsed = Date.now() - startTime;
    const estimatedTotal = elapsed / (progress / 100);
    const remaining = estimatedTotal - elapsed;
    
    if (remaining < 5000) return "即将完成";
    if (remaining < 60000) return `约 ${Math.round(remaining / 1000)} 秒`;
    if (remaining < 3600000) return `约 ${Math.round(remaining / 60000)} 分钟`;
    return `约 ${Math.round(remaining / 3600000)} 小时`;
  };

  const content = (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${getStageBgColor()} ${getStageColor()}`}>
            {getStageIcon()}
          </div>
          <div>
            <p className="text-white font-medium">{status.stage_message}</p>
            <p className="text-gray-400 text-sm">
              {status.scanned_files} / {status.total_files} 文件
              {getEstimatedTime() && ` · 剩余 ${getEstimatedTime()}`}
            </p>
          </div>
        </div>
        <span className="text-2xl font-bold text-blue-400">{Math.round(progress)}%</span>
      </div>
      <div className="w-full bg-gray-800 rounded-full h-3 overflow-hidden">
        <div
          className={`bg-gradient-to-r ${getProgressColor()} h-full transition-all duration-300`}
          style={{ width: `${progress}%` }}
        />
      </div>
      {status.current_file && (
        <div className="bg-gray-800/50 rounded-lg p-3">
          <p className="text-gray-400 text-sm truncate">{status.current_file}</p>
        </div>
      )}
    </div>
  );

  if (inline) {
    return (
      <div className="bg-gray-900/50 border border-gray-700 rounded-xl p-4 mb-6">
        {content}
      </div>
    );
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-800 p-4 shadow-lg">
      <div className="max-w-4xl mx-auto">
        {content}
      </div>
    </div>
  );
}
