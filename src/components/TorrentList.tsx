import type { TorrentDto } from "../lib/types";
import { EmptyState } from "./EmptyState";
import { ROW_GRID, TorrentRow, type RowActions } from "./TorrentRow";
import type { View } from "./NavRail";

const COLUMNS = ["Name", "Status", "Size", "Progress", "Speed", "ETA", "Peers", ""];

export function TorrentList({
  torrents,
  selectedId,
  view,
  actions,
  onAdd,
}: {
  torrents: TorrentDto[];
  selectedId: number | null;
  view: Exclude<View, "settings">;
  actions: RowActions;
  onAdd: () => void;
}) {
  if (torrents.length === 0) {
    return <EmptyState view={view} onAdd={onAdd} />;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className={`${ROW_GRID} shrink-0 border-b border-hairline pb-1.5 text-[10px] font-medium tracking-wider text-ink-3 uppercase`}
      >
        {COLUMNS.map((c, i) => (
          <div key={i} className={i === 0 ? "min-w-0 truncate" : i >= 2 && i <= 6 ? "text-right" : ""}>
            {c}
          </div>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {torrents.map((t, i) => (
          <TorrentRow
            key={t.id}
            t={t}
            selected={t.id === selectedId}
            isFirst={i === 0}
            isLast={i === torrents.length - 1}
            actions={actions}
          />
        ))}
      </div>
    </div>
  );
}
