import { useEffect, useState } from "react";
import { ScanStatus, onScanProgress, onScanComplete } from "../services/tauri";
import { Loader2, FileVideo, Image } from "lucide-react";

interface ScanProgressProps {
  inline?: boolean;
}

export default function ScanProgress({ inline = false }: ScanProgressProps) {
  const [status, setStatus] = useState<ScanStatus | null>(null);

  useEffect(() => {
    const unlistenProgress = onScanProgress((newStatus) => {
      setStatus(newStatus);
    });

    const unlistenComplete = onScanComplete(() => {
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

  const progress = status.total_files > 0
    ? (status.scanned_files / status.total_files) * 100
    : 0;

  const getStageIcon = () => {
    switch (status.stage) {
      case "Scanning":
        return <Loader2 className="w-5 h-5" />;
      case "Importing":
        return <FileVideo className="w-5 h-5" />;
      case "GeneratingThumbnails":
        return <Image className="w-5 h-5" />;
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

  const content = (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg bg-gray-800 ${getStageColor()}`}>
            {getStageIcon()}
          </div>
          <div>
            <p className="text-white font-medium">{status.stage_message}</p>
            <p className="text-gray-400 text-sm">
              {status.scanned_files} / {status.total_files} 文件
            </p>
          </div>
        </div>
        <span className="text-2xl font-bold text-blue-400">{Math.round(progress)}%</span>
      </div>
      <div className="w-full bg-gray-800 rounded-full h-3 overflow-hidden">
        <div
          className="bg-gradient-to-r from-blue-500 to-blue-400 h-full transition-all duration-300"
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
