import { Activity, ArrowDownToLine, ArrowUp, Plus } from "lucide-react";
import type { SessionStats } from "../lib/types";
import { formatSpeed } from "../lib/format";
import type { View } from "./NavRail";

const TITLES: Record<View, string> = {
  all: "All Torrents",
  downloading: "Downloading",
  completed: "Completed",
  settings: "Settings",
};

export function Header({
  view,
  session,
  onAdd,
}: {
  view: View;
  session: SessionStats | null;
  onAdd: () => void;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-hairline px-4">
      <h1 className="text-[14px] font-semibold text-ink">{TITLES[view]}</h1>
      <div className="flex items-center gap-3">
        {session && (
          <>
            <span className="hidden items-center gap-1.5 text-[11px] tabular-nums text-ink-2 lg:flex" title="Total download speed">
              <ArrowDownToLine size={13} className="text-accent" />
              {formatSpeed(session.downloadBps)}
            </span>
            <span className="hidden items-center gap-1.5 text-[11px] tabular-nums text-ink-2 lg:flex" title="Total upload speed">
              <ArrowUp size={13} className="text-slate-400" />
              {formatSpeed(session.uploadBps)}
            </span>
            <span className="flex items-center gap-1.5 text-[11px] tabular-nums text-ink-2" title="Active transfers">
              <Activity size={13} className="text-ink-3" />
              {session.activeDownloads} active
            </span>
          </>
        )}
        <button onClick={onAdd} className="btn-primary">
          <Plus size={15} />
          Add Torrent
        </button>
      </div>
    </div>
  );
}
