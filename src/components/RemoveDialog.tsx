import { useEffect } from "react";
import type { TorrentDto } from "../lib/types";

export function RemoveDialog({
  torrents,
  busy,
  onClose,
  onConfirm,
}: {
  torrents: TorrentDto[];
  busy: boolean;
  onClose: () => void;
  onConfirm: (deleteFiles: boolean) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || busy) return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const multiple = torrents.length > 1;
  const names = torrents.slice(0, 3);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={() => !busy && onClose()} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="remove-title"
        aria-describedby="remove-description"
        className="relative z-10 w-[420px] animate-pop-in rounded-lg border border-hairline bg-panel-2 p-4 shadow-2xl shadow-black/60"
      >
        <h2 id="remove-title" className="text-[14px] font-semibold text-ink">
          Remove {multiple ? `${torrents.length} torrents` : "torrent"}?
        </h2>
        <div id="remove-description">
          <ul className="mt-2 space-y-1 text-[12px] text-ink-2">
            {names.map((torrent) => (
              <li key={torrent.id} className="truncate" title={torrent.name}>
                {torrent.name || torrent.infoHash}
              </li>
            ))}
            {torrents.length > names.length && (
              <li className="text-ink-3">and {torrents.length - names.length} more…</li>
            )}
          </ul>
          <p className="mt-2 text-[11px] leading-relaxed break-all text-ink-3">
            {multiple ? (
              "Downloaded files may be in different folders."
            ) : (
              <>
                Files live in <span className="text-ink-2">{torrents[0]?.savePath}</span>
              </>
            )}
          </p>
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button autoFocus disabled={busy} onClick={onClose} className="btn-ghost">
            Cancel
          </button>
          <button disabled={busy} onClick={() => onConfirm(false)} className="btn-secondary">
            Remove from list
          </button>
          <button disabled={busy} onClick={() => onConfirm(true)} className="btn-danger">
            {busy ? "Removing…" : "Remove and delete files"}
          </button>
        </div>
      </div>
    </div>
  );
}
