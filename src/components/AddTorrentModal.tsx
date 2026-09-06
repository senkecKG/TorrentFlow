import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, HardDrive, Loader2, X } from "lucide-react";
import type { PreviewSource, Source } from "../lib/types";
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
  const [magnet, setMagnet] = useState(initialSource?.kind === "magnet" ? initialSource.url : "");
  const [downloadDir, setDownloadDir] = useState<string | null>(null);
  const [freeSpace, setFreeSpace] = useState<number | null>(null);
  const [pendingSrc, setPendingSrc] = useState<Source | null>(null);
  const [meta, setMeta] = useState<PreviewSource | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const started = useRef(false);
  const mounted = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef(document.activeElement as HTMLElement | null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getSettings()
      .then(async (s) => s.downloadDir ?? await defaultDownloadDir())
      .then((dir) => { if (!cancelled) setDownloadDir((current) => current ?? dir); })
      .catch((e) => { if (!cancelled) toast("error", "Could not load download folder", errMsg(e)); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setFreeSpace(null);
    diskFreeBytes(downloadDir)
      .then((bytes) => { if (!cancelled) setFreeSpace(bytes); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [downloadDir]);

  async function pickFolder() {
    try {
      const dir = await open({ directory: true });
      if (mounted.current && typeof dir === "string") setDownloadDir(dir);
    } catch (e) {
      if (mounted.current) toast("error", "Could not open folder picker", errMsg(e));
    }
  }

  async function submitSource(src: Source) {
    if (busy || step !== "source") return;
    setBusy(true);
    setFetchError(null);
    setStep("fetching");
    try {
      const p = await previewSource(src);
      if (!mounted.current) return;
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
      if (!mounted.current) return;
      setFetchError(errMsg(e));
      setStep("source");
      toast("error", "Could not read torrent", errMsg(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  useEffect(() => {
    if (started.current || !initialSource) return;
    started.current = true;
    submitSource(initialSource);
  }, []);

  useEffect(() => {
    if (!dialogRef.current?.contains(document.activeElement)) dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        const controls = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea, input:not(:disabled), [tabindex="0"]');
        if (!controls?.length) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!dialogRef.current?.contains(document.activeElement) || document.activeElement === dialogRef.current || (e.shiftKey ? document.activeElement === first : document.activeElement === last)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        }
        return;
      }
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (previousFocus.current?.isConnected) previousFocus.current.focus();
    };
  }, []);

  useEffect(() => {
    if (!dialogRef.current?.contains(document.activeElement)) dialogRef.current?.focus();
  }, [step]);

  async function browseFile() {
    try {
      const path = await open({
        filters: [{ name: "Torrent", extensions: ["torrent"] }],
      });
      if (mounted.current && typeof path === "string") submitSource({ kind: "torrentPath", path });
    } catch (e) {
      if (mounted.current) toast("error", "Could not open torrent picker", errMsg(e));
    }
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
    if (busy || !meta || !pendingSrc || selected.size === 0) return;
    setBusy(true);
    try {
      const [id, duplicate] = await addSource(
        pendingSrc,
        downloadDir,
        selected.size === meta.files.length ? null : [...selected],
      );
      if (!mounted.current) return;
      if (duplicate) {
        toast("info", "Already in your list", "Selecting the existing torrent.");
      }
      onAdded(id);
    } catch (e) {
      if (mounted.current) toast("error", "Could not add torrent", errMsg(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" />
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Add torrent"
        className="relative z-10 flex max-h-[85vh] w-[520px] max-w-[calc(100vw-2rem)] animate-pop-in flex-col rounded-lg border border-hairline bg-panel-2 shadow-2xl shadow-black/60"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-hairline px-4 py-3">
          <h2 className="text-[14px] font-semibold text-ink">
            {step === "files" ? "Choose files to download" : "Add Torrent"}
          </h2>
          <button onClick={onClose} aria-label="Close add torrent" className="icon-btn"><X size={16} /></button>
        </div>

        {step === "source" && (
          <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-4">
            <textarea
              autoFocus
              aria-label="Magnet link"
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
              disabled={busy || !magnet.trim()}
              onClick={() => magnet.trim() && submitSource({ kind: "magnet", url: magnet.trim() })}
              className="btn-primary w-full"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : null}
              Add Magnet Link
            </button>
            {fetchError && <p role="alert" className="text-[11px] break-words text-danger">{fetchError}</p>}
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
                {freeSpace == null ? "Free space unavailable" : `${formatBytes(freeSpace)} free`}
              </div>
            </div>
          </div>
        )}

        {step === "fetching" && (
          <div className="flex flex-col items-center gap-3 px-4 py-10">
            <Loader2 size={24} className="animate-spin text-accent" />
            <div className="text-[13px] font-medium text-ink">Fetching torrent information…</div>
            <p className="text-[11px] text-ink-3">This can take a moment depending on swarm health.</p>
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
