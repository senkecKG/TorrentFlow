import { useEffect } from "react";
import type { TorrentDto } from "../lib/types";

export function RemoveDialog({
  torrent,
  onClose,
  onConfirm,
}: {
  torrent: TorrentDto;
  onClose: () => void;
  onConfirm: (deleteFiles: boolean) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Remove torrent"
        className="relative z-10 w-[420px] animate-pop-in rounded-lg border border-hairline bg-panel-2 p-4 shadow-2xl shadow-black/60"
      >
        <h2 className="text-[14px] font-semibold text-ink">Remove torrent?</h2>
        <p className="mt-1 truncate text-[12px] text-ink-2" title={torrent.name}>
          {torrent.name}
        </p>
        <p className="mt-2 text-[11px] leading-relaxed break-all text-ink-3">
          Files live in <span className="text-ink-2">{torrent.savePath}</span>
        </p>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onClose} className="btn-ghost">
            Cancel
          </button>
          <button onClick={() => onConfirm(false)} className="btn-secondary">
            Remove from list
          </button>
          <button onClick={() => onConfirm(true)} className="btn-danger">
            Remove and delete files
          </button>
        </div>
      </div>
    </div>
  );
}
