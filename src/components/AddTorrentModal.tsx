import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, HardDrive, Loader2 } from "lucide-react";
import type { PreviewSource, Settings, Source } from "../lib/types";
import {
  addSource,
  defaultDownloadDir,
  diskFreeBytes,
  getSettings,
  previewSource,
} from "../lib/api";
import { errMsg, formatBytes, truncMiddle } from "../lib/format";
import type { ToastKind } from "./Toaster";

type PushFn = (kind: ToastKind, title: string, message?: string) => void;
type Step = "source" | "fetching" | "files";

export function AddTorrentModal({
  initialSource,
  onClose,
  onAdded,
  toast,
}: {
  initialSource: Source | null;
  onClose: () => void;
  onAdded: (id: number) => void;
  toast: PushFn;
}) {
  const [step, setStep] = useState<Step>("source");
  const [magnet, setMagnet] = useState("");
  const [downloadDir, setDownloadDir] = useState<string | null>(null);
  const [freeSpace, setFreeSpace] = useState<number | null>(null);
  const [pendingSrc, setPendingSrc] = useState<Source | null>(null);
  const [meta, setMeta] = useState<PreviewSource | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    Promise.all([getSettings(), defaultDownloadDir()])
      .then(([s, d]) => applyDir((s as Settings).downloadDir ?? d))
      .catch(() => {});
  }, []);

  function applyDir(dir: string | null) {
    setDownloadDir(dir);
    diskFreeBytes(dir)
      .then(setFreeSpace)
      .catch(() => {});
  }

  async function pickFolder() {
    const dir = await open({ directory: true });
    if (typeof dir === "string") applyDir(dir);
  }

  async function submitSource(src: Source) {
    if (busy || step !== "source") return;
    setBusy(true);
    setFetchError(null);
    setStep("fetching");
    try {
      const p = await previewSource(src);
      if (p.duplicate && p.id != null) {
        toast("info", "Already in your list", "Selecting the existing torrent.");
        onAdded(p.id);
        return;
      }
      setPendingSrc(src);
      setMeta(p);
      setSelected(new Set(p.files.map((f) => f.index)));
      setStep("files");
    } catch (e) {
      setFetchError(errMsg(e));
      toast("error", "Could not read torrent", errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (started.current || !initialSource) return;
    started.current = true;
    submitSource(initialSource);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  async function browseFile() {
    const path = await open({
      filters: [{ name: "Torrent", extensions: ["torrent"] }],
    });
    if (typeof path === "string") submitSource({ kind: "torrentPath", path });
  }

  function toggle(index: number) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function confirmAdd() {
    if (busy || !meta || !pendingSrc) return;
    setBusy(true);
    try {
      const [id, duplicate] = await addSource(
        pendingSrc,
        downloadDir,
        selected.size === meta.files.length ? null : [...selected],
      );
      if (duplicate) {
        toast("info", "Already in your list", "Selecting the existing torrent.");
      }
      onAdded(id);
    } catch (e) {
      toast("error", "Could not add torrent", errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add torrent"
        className="relative z-10 flex max-h-[85vh] w-[520px] animate-pop-in flex-col rounded-lg border border-hairline bg-panel-2 shadow-2xl shadow-black/60"
      >
        <div className="shrink-0 border-b border-hairline px-4 py-3">
          <h2 className="text-[14px] font-semibold text-ink">
            {step === "files" ? "Choose files to download" : "Add Torrent"}
          </h2>
        </div>

        {step === "source" && (
          <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-4">
            <textarea
              autoFocus
              value={magnet}
              onChange={(e) => setMagnet(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (magnet.trim()) submitSource({ kind: "magnet", url: magnet.trim() });
                }
              }}
              placeholder="Paste a magnet link…"
              rows={4}
              className="input h-auto resize-none py-2 leading-relaxed"
            />
            <button
              disabled={busy}
              onClick={() => magnet.trim() && submitSource({ kind: "magnet", url: magnet.trim() })}
              className="btn-primary w-full"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : null}
              Add Magnet Link
            </button>
            <div className="flex items-center gap-3 text-[11px] text-ink-3">
              <span className="h-px flex-1 bg-hairline" />
              or
              <span className="h-px flex-1 bg-hairline" />
            </div>
            <div className="flex items-center justify-center gap-2">
              <button onClick={browseFile} className="btn-secondary">
                <FolderOpen size={14} />
                Browse .torrent file
              </button>
            </div>
            <p className="text-center text-[11px] text-ink-3">or drop a file anywhere</p>
            <div className="mt-auto space-y-2 rounded-md border border-hairline bg-panel p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 flex-1 truncate text-[11px] text-ink-2" title={downloadDir ?? undefined}>
                  {downloadDir ? truncMiddle(downloadDir, 46) : "…"}
                </span>
                <button onClick={pickFolder} className="btn-ghost h-6 px-2 text-[11px]">
                  Change
                </button>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] tabular-nums text-ink-3">
                <HardDrive size={12} />
                {freeSpace == null ? "Checking free space…" : `${formatBytes(freeSpace)} free`}
              </div>
            </div>
          </div>
        )}

        {step === "fetching" && (
          <div className="flex flex-col items-center gap-3 px-4 py-10">
            <Loader2 size={24} className="animate-spin text-accent" />
            <div className="text-[13px] font-medium text-ink">Fetching torrent information…</div>
            {fetchError ? (
              <p className="max-w-sm text-center text-[11px] break-words text-danger">{fetchError}</p>
            ) : (
              <p className="text-[11px] text-ink-3">This can take a moment depending on swarm health.</p>
            )}
            <button onClick={onClose} className="btn-secondary mt-2">
              Cancel
            </button>
          </div>
        )}

        {step === "files" && meta && (
          <>
            <div className="flex shrink-0 items-baseline justify-between px-4 pt-3 pb-2">
              <span className="truncate text-[12px] font-medium text-ink" title={meta.name}>
                {meta.name}
              </span>
              <span className="ml-3 shrink-0 text-[11px] tabular-nums text-ink-2">
                {formatBytes(meta.totalBytes)}
              </span>
            </div>
            <div className="flex shrink-0 items-center justify-between border-b border-hairline px-4 pb-2 text-[11px]">
              <span className="text-ink-3">
                {selected.size} / {meta.files.length} selected
              </span>
              <div className="flex gap-3">
                <button
                  onClick={() => setSelected(new Set(meta.files.map((f) => f.index)))}
                  className="text-accent hover:underline"
                >
                  Select all
                </button>
                <button onClick={() => setSelected(new Set())} className="text-ink-2 hover:text-ink hover:underline">
                  Deselect all
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
              {meta.files.map((f) => (
                <label key={f.index} className="flex cursor-default items-center gap-2.5 rounded-md px-1 py-1.5 hover:bg-white/[0.03]">
                  <input
                    type="checkbox"
                    checked={selected.has(f.index)}
                    onChange={() => toggle(f.index)}
                    className="h-3.5 w-3.5 shrink-0"
                  />
                  <span className="min-w-0 flex-1 truncate text-[12px] text-ink" title={f.path}>
                    {f.path}
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-ink-2">{formatBytes(f.len)}</span>
                </label>
              ))}
            </div>
            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-hairline px-4 py-3">
              <button onClick={onClose} className="btn-secondary">
                Cancel
              </button>
              <button onClick={confirmAdd} disabled={selected.size === 0 || busy} className="btn-primary">
                {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                Add and Start
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
