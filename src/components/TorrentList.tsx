import { useEffect, useRef } from "react";
import type { TorrentDto } from "../lib/types";
import { EmptyState } from "./EmptyState";
import { ROW_GRID, TorrentRow, type RowActions } from "./TorrentRow";
import type { View } from "./NavRail";

const COLUMNS = ["", "Name", "Status", "Size", "Progress", "Speed", "ETA", "Peers", "Actions"];

export function TorrentList({
  torrents,
  activeId,
  selectedIds,
  manualOrder,
  view,
  actions,
  onAdd,
  onSelectAll,
}: {
  torrents: TorrentDto[];
  activeId: number | null;
  selectedIds: ReadonlySet<number>;
  manualOrder: boolean;
  view: Exclude<View, "settings">;
  actions: RowActions;
  onAdd: () => void;
  onSelectAll: (selected: boolean) => void;
}) {
  const selectAllRef = useRef<HTMLInputElement>(null);
  const selectedCount = torrents.reduce((count, torrent) => count + Number(selectedIds.has(torrent.id)), 0);
  const allSelected = torrents.length > 0 && selectedCount === torrents.length;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selectedCount > 0 && !allSelected;
    }
  }, [allSelected, selectedCount]);

  if (torrents.length === 0) {
    return <EmptyState view={view} onAdd={onAdd} />;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className={`${ROW_GRID} shrink-0 border-b border-hairline pb-1.5 text-[10px] font-medium tracking-wider text-ink-3 uppercase`}
      >
        <input
          ref={selectAllRef}
          type="checkbox"
          checked={allSelected}
          onChange={() => onSelectAll(!allSelected)}
          className="h-3.5 w-3.5"
          aria-label={allSelected ? "Clear visible torrent selection" : "Select all visible torrents"}
        />
        {COLUMNS.slice(1).map((column, index) => (
          <div
            key={column || index}
            className={index === 0 ? "min-w-0 truncate" : index >= 2 && index <= 6 ? "text-right" : index === 7 ? "text-right" : ""}
          >
            {column}
          </div>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {torrents.map((t, i) => (
          <TorrentRow
            key={t.id}
            t={t}
            active={t.id === activeId}
            selected={selectedIds.has(t.id)}
            isFirst={i === 0}
            isLast={i === torrents.length - 1}
            manualOrder={manualOrder}
            actions={actions}
          />
        ))}
      </div>
    </div>
  );
}
