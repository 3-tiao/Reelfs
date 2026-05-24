import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Trash2, FolderOpen, Database, Settings as SettingsIcon, RefreshCw, AlertTriangle, CheckCircle } from "lucide-react";
import { useSettingsStore } from "../stores/settingsStore";
import { useMovieStore } from "../stores/movieStore";
import { startInitialScan, getStats, Stats, regenerateAllThumbnails, resetDatabase, stopScan, onScanComplete, ScanResult, logger } from "../services/tauri";
import { open } from "@tauri-apps/api/dialog";
import ScanProgress from "../components/ScanProgress";
import { formatBytes } from "../lib/utils";
import { toast } from "sonner";

export default function Settings() {
  const navigate = useNavigate();
  const { config, loadConfig, patchConfig } = useSettingsStore();
  const { reset: resetMovies, fetchMovies } = useMovieStore();
  const [nasPaths, setNasPaths] = useState<string[]>([]);
  const [cacheDir, setCacheDir] = useState<string>("");
  const [stats, setStats] = useState<Stats | null>(null);
  const [scanMode, setScanMode] = useState<"incremental" | "full">("incremental");
  const [deleteInvalid, setDeleteInvalid] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [showScanResult, setShowScanResult] = useState(false);

  useEffect(() => {
    loadConfig();
    loadStats();
  }, [loadConfig]);

  useEffect(() => {
    const unlistenPromise = onScanComplete((completion) => {
      setIsScanning(false);
      loadStats();
      resetMovies();
      fetchMovies(0);

      if (completion.status === "success" && completion.result) {
        setScanResult(completion.result);
        setShowScanResult(true);
        return;
      }

      setShowScanResult(false);
      setScanResult(null);

      if (completion.status === "error") {
        toast.error(completion.message || "扫描失败");
      } else if (completion.status === "cancelled") {
        toast.info(completion.message || "扫描已停止");
      }
    });

    return () => {
      unlistenPromise.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (config) {
      setNasPaths(config.nas_paths);
      setCacheDir(config.cache_dir);
    }
  }, [config]);

  const loadStats = async () => {
    try {
      const data = await getStats();
      setStats(data);
    } catch (error) {
      logger.error("Failed to load stats:", error);
    }
  };

  const handleAddPath = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
      });

      if (selected && typeof selected === "string") {
        if (!nasPaths.includes(selected)) {
          const updated = [...nasPaths, selected];
          setNasPaths(updated);
          await patchConfig({ nas_paths: updated });
        }
      }
    } catch (error) {
      logger.error("Failed to select directory:", error);
    }
  };

  const handleRemovePath = async (index: number) => {
    const newPaths = nasPaths.filter((_, i) => i !== index);
    setNasPaths(newPaths);
    await patchConfig({ nas_paths: newPaths });
  };

  const handleSelectCacheDir = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
      });

      if (selected && typeof selected === "string") {
        setCacheDir(selected);
        await patchConfig({ cache_dir: selected });
      }
    } catch (error) {
      logger.error("Failed to select cache directory:", error);
    }
  };



  const handleScan = async () => {
    if (isScanning) {
      try {
        await stopScan();
        setIsScanning(false);
      } catch (error) {
        logger.error("停止扫描失败:", error);
        toast.warning("停止扫描失败: " + error);
      }
    } else {
      try {
        await startInitialScan(scanMode, deleteInvalid);
        setIsScanning(true);
        setDeleteInvalid(false);
        setTimeout(() => {
          loadStats();
        }, 1000);
      } catch (error) {
        logger.error("开始扫描失败:", error);
        toast.error("开始扫描失败: " + error);
      }
    }
  };

  const handleRegenerateThumbnails = async () => {
    try {
      const result = await regenerateAllThumbnails();
      toast.success(result);
      setTimeout(() => {
        loadStats();
      }, 1000);
    } catch (error) {
      logger.error("重新生成缩略图失败:", error);
      toast.error("重新生成缩略图失败: " + error);
    }
  };

  const handleResetData = async () => {
    try {
      await resetDatabase();
      setShowResetConfirm(false);
      toast.success("数据已重置，页面将刷新");
      window.location.reload();
    } catch (error) {
      logger.error("重置数据失败:", error);
      toast.error("重置数据失败: " + error);
    }
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 selection:bg-teal-500/30">
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-[#09090b]/70 border-b border-zinc-800/50 shadow-2xl transition-all duration-300">
        <div className="px-8 py-5 max-w-[1200px] mx-auto">
          <button
            onClick={() => navigate(-1)}
            className="group flex items-center gap-2 px-4 py-2 hover:bg-zinc-800/60 rounded-xl transition-all duration-300 border border-transparent hover:border-zinc-700/50"
          >
            <ArrowLeft className="w-5 h-5 text-zinc-400 group-hover:-translate-x-1 group-hover:text-teal-400 transition-all" />
            <span className="font-medium text-zinc-300 group-hover:text-zinc-100">Back to Library</span>
          </button>
        </div>
      </header>

      <main className="max-w-[1200px] mx-auto px-8 py-10">
        <h1 className="text-4xl font-bold mb-10 tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-zinc-100 to-zinc-500">Preferences</h1>

        <div className="space-y-8">
          <div className="grid grid-cols-1 gap-8 mb-8">
            <section className="bg-zinc-900/40 backdrop-blur-md rounded-2xl p-8 border border-zinc-800/60 shadow-xl">
              <h2 className="text-xl font-semibold mb-6 flex items-center gap-3 text-zinc-100">
                <div className="p-2 bg-purple-500/10 rounded-lg border border-purple-500/20">
                  <Database className="w-5 h-5 text-purple-400" />
                </div>
                Database Stats
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="bg-zinc-950/50 border border-zinc-800/80 rounded-xl p-5 flex flex-col justify-center">
                  <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wider mb-2">Total Movies</p>
                  <p className="text-3xl font-light text-zinc-100 tracking-tight">{stats?.total_movies || 0}</p>
                </div>
                <div className="bg-zinc-950/50 border border-zinc-800/80 rounded-xl p-5 flex flex-col justify-center">
                  <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wider mb-2">Db Size</p>
                  <p className="text-3xl font-light text-zinc-100 tracking-tight">{stats ? formatBytes(stats.db_size) : "0 B"}</p>
                </div>
                <div className="col-span-2 md:col-span-1 bg-zinc-950/50 border border-zinc-800/80 rounded-xl p-5 flex justify-between items-center">
                  <div>
                    <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wider mb-1">Cache Size</p>
                    <p className="text-3xl font-light text-zinc-100 tracking-tight">{stats ? formatBytes(stats.cache_size) : "0 B"}</p>
                  </div>
                  <Database className="w-8 h-8 text-zinc-800" />
                </div>
              </div>
            </section>
          </div>

          <section className="bg-zinc-900/40 backdrop-blur-md rounded-2xl p-8 border border-zinc-800/60 shadow-xl">
            <h2 className="text-xl font-semibold mb-6 flex items-center gap-3 text-zinc-100">
              <div className="p-2 bg-teal-500/10 rounded-lg border border-teal-500/20">
                <SettingsIcon className="w-5 h-5 text-teal-400" />
              </div>
              Library Configuration
            </h2>
            
            <div className="space-y-8">
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Media Folders</h3>
                <div className="flex gap-4 mb-4 items-center">
                  <button
                    onClick={handleAddPath}
                    className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl transition-all duration-300 border border-zinc-700/50 hover:border-zinc-600 shadow-inner group"
                  >
                    <Plus className="w-4 h-4 text-teal-400 group-hover:scale-110 transition-transform" />
                    <span>Add Directory</span>
                  </button>
                  <p className="text-zinc-500 text-sm">Select folders containing your movies.</p>
                </div>
                <div className="space-y-2">
                  {nasPaths.length === 0 ? (
                    <div className="p-8 border-2 border-dashed border-zinc-800/80 rounded-xl text-center text-zinc-500 text-sm">
                      No media folders configured yet.
                    </div>
                  ) : (
                     <div className="grid gap-3">
                      {nasPaths.map((path, index) => (
                        <div
                          key={index}
                          className="flex items-center justify-between bg-zinc-950/50 border border-zinc-800/80 rounded-xl p-3 pr-2 group/path transition-all hover:bg-zinc-900/80 hover:border-zinc-700/80"
                        >
                          <div className="flex items-center gap-3 overflow-hidden">
                            <FolderOpen className="w-4 h-4 text-teal-500/70 flex-shrink-0" />
                            <span className="text-sm font-mono text-zinc-300 truncate">{path}</span>
                          </div>
                          <button
                            onClick={() => handleRemovePath(index)}
                            className="p-2 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all opacity-0 group-hover/path:opacity-100"
                            title="Remove folder"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="mt-8 pt-6 border-t border-zinc-800/50 space-y-4">
                  <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Cache Location</h3>
                  <div className="flex gap-4 items-center">
                    <button
                      onClick={handleSelectCacheDir}
                      className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl transition-all duration-300 border border-zinc-700/50 hover:border-zinc-600 shadow-inner group flex-shrink-0"
                    >
                      <Database className="w-4 h-4 text-teal-400" />
                      <span>Set Cache Dir</span>
                    </button>
                    <div className="flex-1 bg-zinc-950/50 border border-zinc-800/80 rounded-xl p-2.5 px-4 truncate max-w-full">
                      <span className="text-sm font-mono text-zinc-400">{cacheDir || "Default system cache"}</span>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="space-y-4 pt-6 mt-4 border-t border-zinc-800/50">
                <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Scan Behavior</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                  <label 
                    className={`relative flex flex-col items-center justify-center gap-2 p-5 rounded-xl cursor-pointer transition-all duration-300 border-2 overflow-hidden group ${
                      scanMode === "incremental" 
                        ? "bg-teal-500/10 border-teal-500/50 shadow-[0_0_20px_rgba(20,184,166,0.15)]" 
                        : "bg-zinc-900/50 border-zinc-800/80 hover:bg-zinc-800 hover:border-zinc-700"
                    }`}
                  >
                    <input
                      type="radio"
                      name="scanMode"
                      value="incremental"
                      checked={scanMode === "incremental"}
                      onChange={() => setScanMode("incremental")}
                      className="sr-only"
                    />
                    <div className="text-center relative z-10">
                      <p className={`font-semibold text-lg transition-colors ${scanMode === "incremental" ? "text-teal-400" : "text-zinc-300"}`}>Incremental Scan</p>
                      <p className="text-sm text-zinc-500 mt-1">Recommended</p>
                    </div>
                    {scanMode === "incremental" && (
                      <div className="absolute top-3 right-3 w-2.5 h-2.5 bg-teal-400 rounded-full shadow-[0_0_8px_rgba(20,184,166,0.8)] animate-pulse"></div>
                    )}
                  </label>
                  <label 
                    className={`relative flex flex-col items-center justify-center gap-2 p-5 rounded-xl cursor-pointer transition-all duration-300 border-2 overflow-hidden group ${
                      scanMode === "full" 
                        ? "bg-purple-500/10 border-purple-500/50 shadow-[0_0_20px_rgba(168,85,247,0.15)]" 
                        : "bg-zinc-900/50 border-zinc-800/80 hover:bg-zinc-800 hover:border-zinc-700"
                    }`}
                  >
                    <input
                      type="radio"
                      name="scanMode"
                      value="full"
                      checked={scanMode === "full"}
                      onChange={() => setScanMode("full")}
                      className="sr-only"
                    />
                    <div className="text-center relative z-10">
                      <p className={`font-semibold text-lg transition-colors ${scanMode === "full" ? "text-purple-400" : "text-zinc-300"}`}>Full Integrity Check</p>
                       <p className="text-sm text-zinc-500 mt-1">Validate, update & import</p>
                    </div>
                    {scanMode === "full" && (
                      <div className="absolute top-3 right-3 w-2.5 h-2.5 bg-purple-400 rounded-full shadow-[0_0_8px_rgba(168,85,247,0.8)] animate-pulse"></div>
                    )}
                  </label>
                </div>
                
                <div className="bg-zinc-950/40 rounded-xl p-4 text-sm text-zinc-400 border border-zinc-800/50 flex gap-3 items-start">
                  <div className="mt-0.5 text-zinc-500"><SettingsIcon className="w-4 h-4"/></div>
                  <p className="leading-relaxed">
                    {scanMode === "incremental" 
                      ? "Only scans newly added or recently modified files. This is the fastest method and is recommended for daily use." 
                      : "Validates all files against the database: removes entries for deleted files, imports new files, and re-parses NFO metadata for existing entries."}
                  </p>
                </div>
                {scanMode === "incremental" && (
                  <label className="flex items-center gap-4 bg-zinc-900/50 rounded-xl p-4 cursor-pointer hover:bg-zinc-800 transition-colors border border-transparent hover:border-zinc-700/50 group mt-4">
                    <div className="relative flex items-center justify-center">
                      <input
                        type="checkbox"
                        checked={deleteInvalid}
                        onChange={(e) => setDeleteInvalid(e.target.checked)}
                        className="peer sr-only"
                      />
                      <div className="w-6 h-6 rounded border-2 border-zinc-600 peer-checked:bg-teal-500 peer-checked:border-teal-500 transition-all flex items-center justify-center">
                        <svg className="w-4 h-4 text-white opacity-0 peer-checked:opacity-100 transition-opacity" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                      </div>
                    </div>
                    <div className="flex-1">
                      <span className="text-zinc-200 font-medium group-hover:text-white transition-colors">Prune missing files</span>
                      <p className="text-xs text-zinc-500 mt-0.5">Automatically remove database entries for files that no longer exist on disk.</p>
                    </div>
                  </label>
                )}
              </div>
              
              <div className="grid sm:grid-cols-2 gap-4 mt-8">
                <button
                  onClick={handleRegenerateThumbnails}
                  disabled={!stats || stats.total_movies === 0}
                  className="w-full flex items-center justify-center px-6 py-4 bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-900/50 disabled:text-zinc-600 disabled:border-transparent text-zinc-100 rounded-xl font-medium transition-all duration-300 border border-zinc-700/50 hover:border-zinc-500 shadow-sm"
                >
                  <RefreshCw className="w-5 h-5 mr-2" />
                  Regenerate Thumbnails
                </button>
                
                <button
                  onClick={handleScan}
                  disabled={!isScanning && nasPaths.length === 0}
                  className={`w-full flex items-center justify-center px-6 py-4 rounded-xl font-medium transition-all duration-300 shadow-lg ${
                    isScanning 
                      ? "bg-red-500/20 hover:bg-red-500/30 text-red-500 border border-red-500/50" 
                      : "bg-teal-600 hover:bg-teal-500 text-white border border-teal-500/50 disabled:bg-zinc-900/50 disabled:text-zinc-600 disabled:border-transparent disabled:shadow-none hover:shadow-teal-500/20"
                  }`}
                >
                  {isScanning ? (
                    <>
                      <AlertTriangle className="w-5 h-5 mr-2 animate-pulse" />
                      Stop Scan
                    </>
                  ) : (
                    "Start Scan"
                  )}
                </button>
              </div>
              
              <div className="mt-8">
                <ScanProgress inline={true} />
              </div>
              
              <div className="pt-8 mt-8 border-t border-zinc-800/50">
                <button
                  onClick={() => setShowResetConfirm(true)}
                  className="w-full flex items-center justify-center px-6 py-4 bg-red-500/5 hover:bg-red-500/10 text-red-400 border border-red-500/20 hover:border-red-500/40 rounded-xl font-medium transition-all duration-300"
                >
                  <Trash2 className="w-5 h-5 mr-2" />
                  Erase All Data
                </button>
                <p className="text-xs text-zinc-600 mt-3 text-center uppercase tracking-wider font-medium">
                  This action is irreversible and will delete your entire database.
                </p>
              </div>
            </div>
          </section>

        </div>
      </main>

      {showResetConfirm && (
        <div className="fixed inset-0 bg-[#09090b]/80 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200">
          <div className="bg-zinc-900 border border-zinc-800/80 rounded-2xl p-8 max-w-md mx-4 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-4 mb-6">
              <div className="p-3 bg-red-500/10 rounded-xl">
                <AlertTriangle className="w-6 h-6 text-red-500" />
              </div>
              <h3 className="text-xl font-semibold text-zinc-100">Confirm Reset</h3>
            </div>
            <p className="text-zinc-400 mb-8 leading-relaxed">
              This action will permanently delete all movie data, watch history, and generated thumbnails. This action cannot be reversed.
            </p>
            <div className="flex gap-3">
              <button 
                onClick={() => setShowResetConfirm(false)}
                className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl font-medium transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleResetData}
                className="flex-1 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-semibold transition-colors shadow-lg shadow-red-500/20"
              >
                Erase Data
              </button>
            </div>
          </div>
        </div>
      )}

      {showScanResult && scanResult && (
        <div className="fixed inset-0 bg-[#09090b]/80 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200">
          <div className="bg-zinc-900 border border-zinc-800/80 rounded-2xl p-8 max-w-md mx-4 shadow-2xl animate-in zoom-in-95 duration-200 w-full">
            <div className="flex items-center gap-4 mb-8">
              <div className="p-3 bg-teal-500/10 rounded-xl">
                <CheckCircle className="w-6 h-6 text-teal-500" />
              </div>
              <h3 className="text-xl font-semibold text-zinc-100">Scan Complete</h3>
            </div>
            
            <div className="space-y-4 mb-8 bg-zinc-950/50 rounded-xl p-5 border border-zinc-800/50">
              <div className="flex justify-between items-center pb-4 border-b border-zinc-800/80">
                <span className="text-zinc-500 font-medium">New Media Found</span>
                <span className="text-teal-400 font-bold text-xl">+{scanResult.new_movies}</span>
              </div>
              {scanResult.updated_movies > 0 && (
                <div className="flex justify-between items-center py-4 border-b border-zinc-800/80">
                  <span className="text-zinc-500 font-medium">Metadata Updated</span>
                  <span className="text-blue-400 font-bold text-xl">{scanResult.updated_movies}</span>
                </div>
              )}
              {scanResult.deleted_movies > 0 && (
                <div className="flex justify-between items-center py-4 border-b border-zinc-800/80">
                  <span className="text-zinc-500 font-medium">Invalid Entries Pruned</span>
                  <span className="text-red-400 font-bold text-xl">-{scanResult.deleted_movies}</span>
                </div>
              )}
              <div className="flex justify-between items-center pt-4">
                <span className="text-zinc-500 font-medium">Total Media in Library</span>
                <span className="text-zinc-100 font-bold text-xl">{scanResult.total_movies}</span>
              </div>
            </div>
            
            <button 
              onClick={() => setShowScanResult(false)}
              className="w-full py-4 bg-zinc-100 hover:bg-white text-zinc-900 rounded-xl font-bold transition-all duration-300 shadow-[0_0_20px_rgba(255,255,255,0.1)] hover:shadow-[0_0_30px_rgba(255,255,255,0.2)]"
            >
              Finish
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
