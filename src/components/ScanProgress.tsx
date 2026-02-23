import { useEffect, useState } from "react";
import { ScanStatus, onScanProgress, onScanComplete } from "../services/tauri";

export default function ScanProgress() {
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

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-800 p-4 shadow-lg">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-2">
          <span className="text-white font-medium">Scanning movies...</span>
          <span className="text-gray-400 text-sm">
            {status.scanned_files} / {status.total_files}
          </span>
        </div>
        <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
          <div
            className="bg-blue-500 h-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        {status.current_file && (
          <p className="text-gray-500 text-xs mt-2 truncate">
            {status.current_file}
          </p>
        )}
      </div>
    </div>
  );
}
