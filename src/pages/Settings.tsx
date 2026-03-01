import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Trash2, FolderOpen, Database, Settings as SettingsIcon, RefreshCw, AlertTriangle } from "lucide-react";
import { useSettingsStore } from "../stores/settingsStore";
import { startInitialScan, getStats, Stats, regenerateAllThumbnails, resetDatabase } from "../services/tauri";
import { open } from "@tauri-apps/api/dialog";
import ScanProgress from "../components/ScanProgress";

export default function Settings() {
  const navigate = useNavigate();
  const { config, loadConfig, saveConfig } = useSettingsStore();
  const [nasPaths, setNasPaths] = useState<string[]>([]);
  const [cacheDir, setCacheDir] = useState<string>("");
  const [stats, setStats] = useState<Stats | null>(null);
  const [scanMode, setScanMode] = useState<"incremental" | "full">("incremental");
  const [deleteInvalid, setDeleteInvalid] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  useEffect(() => {
    loadConfig();
    loadStats();
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
      console.error("Failed to load stats:", error);
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
          setNasPaths([...nasPaths, selected]);
          await saveConfig({
            ...config,
            nas_paths: [...nasPaths, selected],
            db_path: config?.db_path || "",
            cache_dir: config?.cache_dir || "",
            scan_on_startup: config?.scan_on_startup || false,
            auto_generate_thumbnails: config?.auto_generate_thumbnails || false,
            theme: config?.theme || "dark",
            default_player: config?.default_player || "system",
          });
        }
      }
    } catch (error) {
      console.error("Failed to select directory:", error);
    }
  };

  const handleRemovePath = async (index: number) => {
    const newPaths = nasPaths.filter((_, i) => i !== index);
    setNasPaths(newPaths);
    await saveConfig({
      ...config,
      nas_paths: newPaths,
      db_path: config?.db_path || "",
      cache_dir: config?.cache_dir || "",
      scan_on_startup: config?.scan_on_startup || false,
      auto_generate_thumbnails: config?.auto_generate_thumbnails || false,
      theme: config?.theme || "dark",
      default_player: config?.default_player || "system",
    });
  };

  const handleSelectCacheDir = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
      });

      if (selected && typeof selected === "string") {
        setCacheDir(selected);
        await saveConfig({
          ...config,
          cache_dir: selected,
          db_path: config?.db_path || "",
          nas_paths: config?.nas_paths || [],
          scan_on_startup: config?.scan_on_startup || false,
          auto_generate_thumbnails: config?.auto_generate_thumbnails || false,
          theme: config?.theme || "dark",
          default_player: config?.default_player || "system",
        });
      }
    } catch (error) {
      console.error("Failed to select cache directory:", error);
    }
  };

  const handleSave = async () => {
    if (config) {
      try {
        await saveConfig({
          ...config,
          nas_paths: nasPaths,
          cache_dir: cacheDir,
          db_path: config?.db_path || "",
          scan_on_startup: config?.scan_on_startup || false,
          auto_generate_thumbnails: config?.auto_generate_thumbnails || false,
          theme: config?.theme || "dark",
          default_player: config?.default_player || "system",
        });
        alert("Settings saved successfully!");
      } catch (error) {
        alert("Failed to save settings: " + error);
      }
    }
  };

  const handleScan = async () => {
    try {
      await startInitialScan(scanMode, deleteInvalid);
      setDeleteInvalid(false);
      setTimeout(() => {
        loadStats();
      }, 1000);
    } catch (error) {
      alert("Failed to start scan: " + error);
      setDeleteInvalid(false);
    }
  };

  const handleRegenerateThumbnails = async () => {
    try {
      const result = await regenerateAllThumbnails();
      alert(result);
      setTimeout(() => {
        loadStats();
      }, 1000);
    } catch (error) {
      console.error("重新生成缩略图失败:", error);
      alert("重新生成缩略图失败: " + error);
    }
  };

  const handleResetData = async () => {
    try {
      await resetDatabase();
      setShowResetConfirm(false);
      setTimeout(() => {
        loadStats();
      }, 1000);
    } catch (error) {
      console.error("重置数据失败:", error);
      alert("重置数据失败: " + error);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="sticky top-0 z-10 bg-gray-900 border-b border-gray-800">
        <div className="px-6 py-4">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2 px-4 py-2 hover:bg-gray-800 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            Back to Home
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        <h1 className="text-3xl font-bold mb-8">Settings</h1>

        <div className="space-y-8">
          <section className="bg-gray-900 rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
              <SettingsIcon className="w-5 h-5" />
              Scan Configuration
            </h2>
            
            <div className="space-y-6">
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-gray-300">Path Configuration</h3>
                <div className="flex gap-3 mb-4">
                  <button
                    onClick={handleAddPath}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                  >
                    <Plus className="w-5 h-5" />
                    Add Path
                  </button>
                  <div className="flex-1">
                    <span className="text-gray-400 text-sm">Add or remove NAS paths</span>
                  </div>
                </div>
                <div className="space-y-3">
                  {nasPaths.length === 0 ? (
                    <p className="text-gray-400 text-sm">No paths configured</p>
                  ) : (
                    nasPaths.map((path, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between bg-gray-800 rounded-lg p-3"
                      >
                        <span className="text-sm font-mono truncate flex-1">{path}</span>
                        <button
                          onClick={() => handleRemovePath(index)}
                          className="ml-3 p-2 text-red-400 hover:bg-gray-700 rounded transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
                <div className="flex gap-3 mb-4">
                  <button
                    onClick={handleSelectCacheDir}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                  >
                    <FolderOpen className="w-5 h-5" />
                    Select Cache Directory
                  </button>
                  <div className="flex-1">
                    <span className="text-sm font-mono truncate block">{cacheDir || "Not configured"}</span>
                  </div>
                </div>
              </div>
              
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-gray-300">Scan Mode</h3>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <label 
                    className={`relative flex items-center justify-center gap-2 px-4 py-3 rounded-lg cursor-pointer transition-all border-2 ${
                      scanMode === "incremental" 
                        ? "bg-blue-600/20 border-blue-500 text-blue-400" 
                        : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700"
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
                    <div className="text-center">
                      <p className="font-semibold text-sm">增量扫描</p>
                      <p className="text-xs opacity-75 mt-1">推荐</p>
                    </div>
                    {scanMode === "incremental" && (
                      <div className="absolute top-2 right-2 w-2 h-2 bg-blue-400 rounded-full"></div>
                    )}
                  </label>
                  <label 
                    className={`relative flex items-center justify-center gap-2 px-4 py-3 rounded-lg cursor-pointer transition-all border-2 ${
                      scanMode === "full" 
                        ? "bg-green-600/20 border-green-500 text-green-400" 
                        : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700"
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
                    <div className="text-center">
                      <p className="font-semibold text-sm">完全重新校验</p>
                      <p className="text-xs opacity-75 mt-1">耗时较长</p>
                    </div>
                    {scanMode === "full" && (
                      <div className="absolute top-2 right-2 w-2 h-2 bg-green-400 rounded-full"></div>
                    )}
                  </label>
                </div>
                <div className="bg-gray-800/50 rounded-lg p-3 text-sm text-gray-400">
                  {scanMode === "incremental" 
                    ? "仅扫描新增或修改的文件，快速高效" 
                    : "重新校验所有文件，确保数据完整性"}
                </div>
                <label className="flex items-center gap-3 bg-gray-800 rounded-lg p-3 cursor-pointer hover:bg-gray-700 transition-colors">
                  <input
                    type="checkbox"
                    checked={deleteInvalid}
                    onChange={(e) => setDeleteInvalid(e.target.checked)}
                    className="w-5 h-5 rounded"
                  />
                  <div className="flex-1">
                    <span className="text-white font-medium">删除已不存在的文件记录</span>
                  </div>
                </label>
              </div>
              
              <button
                onClick={handleRegenerateThumbnails}
                disabled={!stats || stats.total_movies === 0}
                className="w-full flex items-center justify-center px-6 py-3 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-semibold transition-colors"
              >
                <RefreshCw className="w-5 h-5 mr-2" />
                重新生成缩略图
              </button>
              
              <button
                onClick={handleScan}
                disabled={nasPaths.length === 0}
                className="w-full flex items-center justify-center px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-semibold transition-colors"
              >
                开始扫描
              </button>
              
              <ScanProgress inline={true} />
              
              <div className="pt-4 border-t border-gray-800">
                <button
                  onClick={() => setShowResetConfirm(true)}
                  className="w-full flex items-center justify-center px-6 py-3 bg-red-600/10 hover:bg-red-600/20 text-red-400 border border-red-600/30 rounded-lg font-semibold transition-colors"
                >
                  <AlertTriangle className="w-5 h-5 mr-2" />
                  重置数据
                </button>
                <p className="text-xs text-gray-500 mt-2 text-center">
                  此操作将删除所有电影数据，不可恢复
                </p>
              </div>
            </div>
          </section>
          
          <section className="bg-gray-900 rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <Database className="w-5 h-5" />
              System Information
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-gray-800 rounded-lg p-4">
                <p className="text-gray-400 text-sm mb-1">Total Movies</p>
                <p className="text-2xl font-bold">{stats?.total_movies || 0}</p>
              </div>
              <div className="bg-gray-800 rounded-lg p-4">
                <p className="text-gray-400 text-sm mb-1">Database Size</p>
                <p className="text-2xl font-bold">{stats ? formatBytes(stats.db_size) : "0 B"}</p>
              </div>
              <div className="bg-gray-800 rounded-lg p-4">
                <p className="text-gray-400 text-sm mb-1">Cache Size</p>
                <p className="text-2xl font-bold">{stats ? formatBytes(stats.cache_size) : "0 B"}</p>
              </div>
            </div>
          </section>

          <section className="bg-gray-900 rounded-lg p-6">
            <button
              onClick={handleSave}
              className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold text-lg transition-colors"
            >
              Save Settings
            </button>
          </section>
        </div>
      </main>

      {showResetConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-900 rounded-lg p-6 max-w-md mx-4">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="w-6 h-6 text-red-400" />
              <h3 className="text-xl font-semibold">确认重置数据？</h3>
            </div>
            <p className="text-gray-400 mb-6">
              此操作将删除所有电影数据和缩略图，此操作不可恢复。
            </p>
            <div className="flex gap-3">
              <button 
                onClick={() => setShowResetConfirm(false)}
                className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
              >
                取消
              </button>
              <button 
                onClick={handleResetData}
                className="flex-1 py-2 bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
              >
                确认重置
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
