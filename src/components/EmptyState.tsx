import { DownloadCloud, Plus } from "lucide-react";
import type { View } from "./NavRail";

const COPY: Record<Exclude<View, "settings">, { title: string; sub: string }> = {
  all: {
    title: "Nothing downloading yet",
    sub: "Paste a magnet link or add a .torrent file to get started.",
  },
  downloading: {
    title: "No active downloads",
    sub: "Torrents you add will show up here while they transfer.",
  },
  completed: {
    title: "Nothing finished yet",
    sub: "Completed and seeding torrents will appear here.",
  },
};

export function EmptyState({ view, onAdd }: { view: Exclude<View, "settings">; onAdd: () => void }) {
  const copy = COPY[view];
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 pb-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-dim">
        <DownloadCloud size={28} className="text-accent" />
      </div>
      <div className="text-[14px] font-semibold text-ink">{copy.title}</div>
      <p className="max-w-xs text-[12px] leading-relaxed text-ink-2">{copy.sub}</p>
      <button onClick={onAdd} className="btn-primary mt-1">
        <Plus size={15} />
        Add Torrent
      </button>
    </div>
  );
}
