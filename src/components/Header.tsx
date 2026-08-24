import { Plus } from "lucide-react";
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
}: {
  view: View;
  onAdd: () => void;
}) {
  return (
    <div className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-hairline px-5">
      <h1 className="text-[15px] font-semibold tracking-tight text-ink">{TITLES[view]}</h1>
      <button onClick={onAdd} className="btn-primary">
        <Plus size={15} />
        Add Torrent
      </button>
    </div>
  );
}
