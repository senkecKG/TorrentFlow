import { memo } from "react";
import {
  ArrowDown,
  ArrowUp,
  FolderOpen,
  MoreHorizontal,
  Pause,
  Pin,
  Play,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type { TorrentDto } from "../lib/types";
import { formatBytes, formatEta, formatSpeed, percent } from "../lib/format";
import { isVideo } from "../lib/video";
import { ProgressBar, type ProgressVariant } from "./ProgressBar";
import { StatusPill } from "./StatusPill";
import { Dropdown, type MenuItemDef } from "./Menu";

export const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_110px_90px_minmax(120px,1fr)_90px_70px_80px_32px] items-center gap-x-3 px-3";

export interface RowActions {
  onSelect: (t: TorrentDto) => void;
  onPauseResume: (t: TorrentDto) => void;
  onPrioritize: (t: TorrentDto) => void;
  onMove: (t: TorrentDto, delta: number) => void;
  onRecheck: (t: TorrentDto) => void;
  onWatch: (t: TorrentDto) => void;
  onOpenFolder: (t: TorrentDto) => void;
  onRemove: (t: TorrentDto) => void;
}

function progressVariant(t: TorrentDto): ProgressVariant {
  if (t.error) return "error";
  if (t.queued) return "queued";
  switch (t.state) {
    case "downloading":
    case "fetching_metadata":
    case "checking":
      return "normal";
    case "seeding":
      return "seeding";
    default:
      return "paused";
  }
}

export const TorrentRow = memo(function TorrentRow({
  t,
  selected,
  isFirst,
  isLast,
  actions,
}: {
  t: TorrentDto;
  selected: boolean;
  isFirst: boolean;
  isLast: boolean;
  actions: RowActions;
}) {
  const paused = !t.queued && (t.state === "paused" || t.state === "error");
  const hasVideo = t.files.some((f) => isVideo(f.path));

  const items: MenuItemDef[] = [
    paused
      ? { label: "Resume", icon: <Play size={14} />, onSelect: () => actions.onPauseResume(t) }
      : { label: "Pause", icon: <Pause size={14} />, onSelect: () => actions.onPauseResume(t) },
    { label: "Prioritize", icon: <Pin size={14} />, onSelect: () => actions.onPrioritize(t) },
    { label: "Move Up", icon: <ArrowUp size={14} />, disabled: isFirst, onSelect: () => actions.onMove(t, -1) },
    { label: "Move Down", icon: <ArrowDown size={14} />, disabled: isLast, onSelect: () => actions.onMove(t, 1) },
    { label: "Recheck", icon: <RefreshCw size={14} />, onSelect: () => actions.onRecheck(t) },
    ...(hasVideo
      ? [{ label: "Watch in VLC", icon: <Play size={14} />, onSelect: () => actions.onWatch(t) }]
      : []),
    { label: "Open folder", icon: <FolderOpen size={14} />, onSelect: () => actions.onOpenFolder(t) },
    { label: "Remove…", icon: <Trash2 size={14} className="text-danger" />, danger: true, onSelect: () => actions.onRemove(t) },
  ];

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => actions.onSelect(t)}
      onKeyDown={(e) => {
        if (e.key === "Enter") actions.onSelect(t);
      }}
      className={`group relative min-h-[52px] cursor-default border-b border-hairline/60 transition-colors duration-150 hover:bg-row-hover focus-visible:outline-none ${
        selected ? "bg-row-selected shadow-[inset_2px_0_0_0_var(--color-accent)]" : ""
      } ${ROW_GRID}`}
    >
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium text-ink">{t.name || t.infoHash}</div>
      </div>
      <div title={t.error ?? undefined}>
        <StatusPill t={t} />
      </div>
      <div className="text-right text-[12px] tabular-nums text-ink-2">{formatBytes(t.totalBytes)}</div>
      <div className="flex items-center gap-2">
        <ProgressBar value={t.progress} variant={progressVariant(t)} />
        <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-ink-2">{percent(t.progress)}</span>
      </div>
      <div className="text-right text-[12px] tabular-nums text-ink-2">{formatSpeed(t.downloadBps)}</div>
      <div className="text-right text-[12px] tabular-nums text-ink-2">{formatEta(t.etaSecs)}</div>
      <div className="text-right text-[12px] tabular-nums text-ink-2">
        {Math.max(0, t.peers)} / {t.swarmSize < 0 ? "?" : t.swarmSize}
      </div>
      <Dropdown label="Torrent actions" trigger={() => <MoreHorizontal size={16} />} items={items} />
    </div>
  );
});
