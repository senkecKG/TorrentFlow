import { Pause, Play, Plus, Trash2, X } from "lucide-react";
import type { TorrentSort } from "../lib/torrentList";
import type { View } from "./NavRail";

const TITLES: Record<View, string> = {
  all: "All Torrents",
  downloading: "Downloading",
  completed: "Completed",
  settings: "Settings",
};

export function Header({
  view,
  onAdd,
  sort,
  onSort,
  selectionCount,
  busy,
  onPause,
  onResume,
  onRemove,
  onClear,
}: {
  view: View;
  onAdd: () => void;
  sort: TorrentSort;
  onSort: (sort: TorrentSort) => void;
  selectionCount: number;
  busy: boolean;
  onPause: () => void;
  onResume: () => void;
  onRemove: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-hairline px-5">
      <div className="flex min-w-0 items-center gap-3">
        {selectionCount > 0 && view !== "settings" ? (
          <div className="flex min-w-0 items-center gap-1" aria-label={`${selectionCount} torrents selected`}>
            <span className="mr-1 whitespace-nowrap text-[13px] font-semibold text-ink">
              {selectionCount} selected
            </span>
            <button disabled={busy} onClick={onPause} className="btn-ghost" title="Pause selected (Space)">
              <Pause size={14} />
              Pause
            </button>
            <button disabled={busy} onClick={onResume} className="btn-ghost" title="Resume selected (Space)">
              <Play size={14} />
              Resume
            </button>
            <button disabled={busy} onClick={onRemove} className="btn-ghost text-danger hover:text-danger" title="Remove selected (Delete)">
              <Trash2 size={14} />
              Remove
            </button>
            <button disabled={busy} onClick={onClear} className="icon-btn" aria-label="Clear selection" title="Clear selection (Esc)">
              <X size={14} />
            </button>
          </div>
        ) : (
          <>
            <h1 className="shrink-0 text-[15px] font-semibold tracking-tight text-ink">{TITLES[view]}</h1>
            {view !== "settings" && (
              <label className="flex items-center gap-2 text-[11px] text-ink-3">
                <span>Sort</span>
                <select
                  value={sort}
                  onChange={(event) => onSort(event.target.value as TorrentSort)}
                  className="input w-[142px]"
                  aria-label="Sort torrents"
                >
                  <option value="recent">Recent activity</option>
                  <option value="added">Date added</option>
                  <option value="name">Name</option>
                  <option value="queue">Queue order</option>
                </select>
              </label>
            )}
          </>
        )}
      </div>
      <button onClick={onAdd} className="btn-primary">
        <Plus size={15} />
        Add Torrent
      </button>
    </div>
  );
}
