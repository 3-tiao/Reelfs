import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Plus,
  Trash2,
  FolderOpen,
  Database,
  Settings as SettingsIcon,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  Loader2,
} from "lucide-react";
import { useSettingsStore } from "../stores/settingsStore";
import { useMovieStore } from "../stores/movieStore";
import {
  startInitialScan,
  getStats,
  Stats,
  regenerateAllThumbnails,
  resetDatabase,
  stopScan,
  onScanComplete,
  ScanResult,
  logger,
} from "../services/tauri";
import { open } from "@tauri-apps/api/dialog";
import { invalidateAllThumbnails } from "../lib/thumbnailCache";
import ScanProgress from "../components/ScanProgress";
import { formatBytes } from "../lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";

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
      const selected = await open({ directory: true, multiple: false });
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
      const selected = await open({ directory: true, multiple: false });
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
      // Regeneration overwrites `{cache}/thumbnails/{id}.jpg` in place, so the
      // cache keys stay identical — without this the UI kept showing the old images.
      invalidateAllThumbnails();
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
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-background/80 backdrop-blur-xl">
        <div className="mx-auto max-w-[1200px] px-8 py-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(-1)}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Back to Library</span>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-[1200px] px-8 py-10">
        <h1 className="mb-10 text-3xl font-semibold tracking-tight">Preferences</h1>

        <div className="space-y-6">
          <section className="rounded-2xl border border-white/[0.06] bg-card p-8">
            <div className="mb-6 flex items-center gap-3">
              <Database className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                Database Stats
              </h2>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <StatCard label="Total Movies" value={String(stats?.total_movies ?? 0)} />
              <StatCard label="DB Size" value={stats ? formatBytes(stats.db_size) : "0 B"} />
              <StatCard label="Cache Size" value={stats ? formatBytes(stats.cache_size) : "0 B"} />
            </div>
          </section>

          <section className="rounded-2xl border border-white/[0.06] bg-card p-8">
            <div className="mb-6 flex items-center gap-3">
              <SettingsIcon className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                Library Configuration
              </h2>
            </div>

            <div className="space-y-8">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-foreground">Media Folders</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Select folders containing your movies
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={handleAddPath} className="gap-2">
                    <Plus className="h-3.5 w-3.5" />
                    Add Directory
                  </Button>
                </div>

                {nasPaths.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-white/[0.1] p-8 text-center text-sm text-muted-foreground">
                    No media folders configured yet.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {nasPaths.map((path, index) => (
                      <div
                        key={index}
                        className="group flex items-center justify-between rounded-lg border border-white/[0.06] bg-black/40 p-3 pr-2 transition-colors hover:border-white/[0.1]"
                      >
                        <div className="flex items-center gap-3 overflow-hidden">
                          <FolderOpen className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                          <span className="truncate font-mono text-sm text-foreground/90">
                            {path}
                          </span>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemovePath(index)}
                          className="h-7 w-7 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                          title="Remove folder"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <Separator />

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-foreground">Cache Location</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Where generated thumbnails are stored
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSelectCacheDir}
                    className="gap-2"
                  >
                    <Database className="h-3.5 w-3.5" />
                    Change
                  </Button>
                </div>
                <div className="rounded-lg border border-white/[0.06] bg-black/40 p-3">
                  <span className="font-mono text-sm text-muted-foreground">
                    {cacheDir || "Default system cache"}
                  </span>
                </div>
              </div>

              <Separator />

              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-medium text-foreground">Scan Behavior</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Choose how Reelfs syncs with your media folders
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <ScanModeOption
                    title="Incremental Scan"
                    description="Recommended for daily use"
                    selected={scanMode === "incremental"}
                    onSelect={() => setScanMode("incremental")}
                  />
                  <ScanModeOption
                    title="Full Integrity Check"
                    description="Validate, update & import"
                    selected={scanMode === "full"}
                    onSelect={() => setScanMode("full")}
                  />
                </div>

                <div className="rounded-lg border border-white/[0.06] bg-black/40 p-3 text-xs leading-relaxed text-muted-foreground">
                  {scanMode === "incremental"
                    ? "Only scans newly added or recently modified files. This is the fastest method and is recommended for daily use."
                    : "Validates all files against the database: removes entries for deleted files, imports new files, and re-parses NFO metadata for existing entries."}
                </div>

                {scanMode === "incremental" && (
                  <div className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-black/40 p-3">
                    <div>
                      <div className="text-sm font-medium text-foreground">Prune missing files</div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Remove entries for files that no longer exist on disk
                      </p>
                    </div>
                    <Switch checked={deleteInvalid} onCheckedChange={setDeleteInvalid} />
                  </div>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Button
                  variant="outline"
                  onClick={handleRegenerateThumbnails}
                  disabled={!stats || stats.total_movies === 0}
                  className="gap-2"
                  size="lg"
                >
                  <RefreshCw className="h-4 w-4" />
                  Regenerate Thumbnails
                </Button>
                <Button
                  variant={isScanning ? "destructive" : "default"}
                  onClick={handleScan}
                  disabled={!isScanning && nasPaths.length === 0}
                  className="gap-2"
                  size="lg"
                >
                  {isScanning ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Stop Scan
                    </>
                  ) : (
                    "Start Scan"
                  )}
                </Button>
              </div>

              <div>
                <ScanProgress inline={true} />
              </div>

              <Separator />

              <div>
                <Button
                  variant="ghost"
                  onClick={() => setShowResetConfirm(true)}
                  className="w-full gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  size="lg"
                >
                  <Trash2 className="h-4 w-4" />
                  Erase All Data
                </Button>
                <p className="mt-2 text-center text-[10px] uppercase tracking-wider text-muted-foreground/70">
                  This action is irreversible
                </p>
              </div>
            </div>
          </section>
        </div>
      </main>

      <Dialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
        <DialogContent>
          <DialogHeader>
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-destructive/15">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
            <DialogTitle>Confirm Reset</DialogTitle>
            <DialogDescription>
              This action will permanently delete all movie data, watch history, and generated
              thumbnails. This cannot be reversed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setShowResetConfirm(false)} className="flex-1">
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleResetData} className="flex-1">
              Erase Data
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showScanResult} onOpenChange={setShowScanResult}>
        <DialogContent>
          <DialogHeader>
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.08]">
              <CheckCircle className="h-5 w-5 text-foreground" />
            </div>
            <DialogTitle>Scan Complete</DialogTitle>
          </DialogHeader>
          {scanResult && (
            <div className="space-y-2 rounded-lg border border-white/[0.06] bg-black/40 p-4">
              <ScanResultRow label="New media found" value={`+${scanResult.new_movies}`} />
              {scanResult.updated_movies > 0 && (
                <ScanResultRow label="Metadata updated" value={String(scanResult.updated_movies)} />
              )}
              {scanResult.deleted_movies > 0 && (
                <ScanResultRow label="Invalid entries pruned" value={`-${scanResult.deleted_movies}`} />
              )}
              <Separator />
              <ScanResultRow
                label="Total media in library"
                value={String(scanResult.total_movies)}
                emphasize
              />
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setShowScanResult(false)} className="w-full">
              Finish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-black/40 p-5">
      <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="text-2xl font-light tracking-tight text-foreground">{value}</p>
    </div>
  );
}

function ScanModeOption({
  title,
  description,
  selected,
  onSelect,
}: {
  title: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`relative rounded-xl border p-4 text-left transition-colors ${
        selected
          ? "border-white/[0.18] bg-white/[0.04]"
          : "border-white/[0.06] bg-black/40 hover:border-white/[0.1]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <div
          className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border ${
            selected ? "border-foreground bg-foreground" : "border-white/[0.2]"
          }`}
        >
          {selected && <div className="h-1.5 w-1.5 rounded-full bg-background" />}
        </div>
      </div>
    </button>
  );
}

function ScanResultRow({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={`font-medium ${emphasize ? "text-lg text-foreground" : "text-sm text-foreground"}`}
      >
        {value}
      </span>
    </div>
  );
}
