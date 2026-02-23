import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Trash2, FolderOpen, Database, HardDrive } from "lucide-react";
import { useSettingsStore } from "../stores/settingsStore";
import { startInitialScan, clearCache, getStats, Stats } from "../services/tauri";
import { open } from "@tauri-apps/api/dialog";

export default function Settings() {
  const navigate = useNavigate();
  const { config, loadConfig, saveConfig } = useSettingsStore();
  const [nasPaths, setNasPaths] = useState<string[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  useEffect(() => {
    loadConfig();
    loadStats();
  }, []);

  useEffect(() => {
    if (config) {
      setNasPaths(config.nas_paths);
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
        }
      }
    } catch (error) {
      console.error("Failed to select directory:", error);
    }
  };

  const handleRemovePath = (index: number) => {
    setNasPaths(nasPaths.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (config) {
      try {
        await saveConfig({
          ...config,
          nas_paths: nasPaths,
        });
        alert("Settings saved successfully!");
      } catch (error) {
        alert("Failed to save settings: " + error);
      }
    }
  };

  const handleScan = async () => {
    try {
      setIsScanning(true);
      await startInitialScan();
      setTimeout(() => {
        setIsScanning(false);
        loadStats();
      }, 1000);
    } catch (error) {
      setIsScanning(false);
      alert("Failed to start scan: " + error);
    }
  };

  const handleClearCache = async () => {
    if (confirm("Are you sure you want to clear all cached thumbnails?")) {
      try {
        await clearCache();
        loadStats();
        alert("Cache cleared successfully!");
      } catch (error) {
        alert("Failed to clear cache: " + error);
      }
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

        {/* Statistics */}
        {stats && (
          <div className="bg-gray-900 rounded-lg p-6 mb-8">
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <Database className="w-5 h-5" />
              Statistics
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-gray-800 rounded-lg p-4">
                <p className="text-gray-400 text-sm mb-1">Total Movies</p>
                <p className="text-2xl font-bold">{stats.total_movies}</p>
              </div>
              <div className="bg-gray-800 rounded-lg p-4">
                <p className="text-gray-400 text-sm mb-1">Database Size</p>
                <p className="text-2xl font-bold">{formatBytes(stats.db_size)}</p>
              </div>
              <div className="bg-gray-800 rounded-lg p-4">
                <p className="text-gray-400 text-sm mb-1">Cache Size</p>
                <p className="text-2xl font-bold">{formatBytes(stats.cache_size)}</p>
              </div>
            </div>
          </div>
        )}

        {/* NAS Paths */}
        <div className="bg-gray-900 rounded-lg p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <FolderOpen className="w-5 h-5" />
            NAS Paths
          </h2>
          <div className="space-y-3 mb-4">
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
          <button
            onClick={handleAddPath}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            <Plus className="w-5 h-5" />
            Add Path
          </button>
        </div>

        {/* Actions */}
        <div className="bg-gray-900 rounded-lg p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <HardDrive className="w-5 h-5" />
            Actions
          </h2>
          <div className="space-y-3">
            <button
              onClick={handleScan}
              disabled={isScanning || nasPaths.length === 0}
              className="w-full px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-semibold transition-colors"
            >
              {isScanning ? "Scanning..." : "Start Full Scan"}
            </button>
            <button
              onClick={handleClearCache}
              className="w-full px-6 py-3 bg-orange-600 hover:bg-orange-700 rounded-lg font-semibold transition-colors"
            >
              Clear Thumbnail Cache
            </button>
          </div>
        </div>

        {/* Save Button */}
        <button
          onClick={handleSave}
          className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold text-lg transition-colors"
        >
          Save Settings
        </button>
      </main>
    </div>
  );
}
