import { memo } from "react";
import {
  ArrowDown,
  ArrowUp,
  Clapperboard,
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
import { isResumable } from "../lib/torrentList";
import { isVideo } from "../lib/video";
import { ProgressBar, type ProgressVariant } from "./ProgressBar";
import { StatusPill } from "./StatusPill";
import { Dropdown, type MenuItemDef } from "./Menu";

export const ROW_GRID =
  "grid min-w-[984px] grid-cols-[20px_minmax(140px,1fr)_96px_76px_minmax(110px,1fr)_78px_58px_70px_148px] items-center gap-x-2 px-3";

export interface RowActions {
  onSelect: (t: TorrentDto) => void;
  onToggleSelection: (t: TorrentDto) => void;
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
  active,
  selected,
  isFirst,
  isLast,
  manualOrder,
  actions,
}: {
  t: TorrentDto;
  active: boolean;
  selected: boolean;
  isFirst: boolean;
  isLast: boolean;
  manualOrder: boolean;
  actions: RowActions;
}) {
  const resumable = isResumable(t);
  const hasVideo = t.files.some((f) => isVideo(f.path));

  const items: MenuItemDef[] = [
    resumable
      ? { label: "Resume", icon: <Play size={14} />, onSelect: () => actions.onPauseResume(t) }
      : { label: "Pause", icon: <Pause size={14} />, onSelect: () => actions.onPauseResume(t) },
    { label: "Prioritize", icon: <Pin size={14} />, onSelect: () => actions.onPrioritize(t) },
    ...(manualOrder
      ? [
          { label: "Move Up", icon: <ArrowUp size={14} />, disabled: isFirst, onSelect: () => actions.onMove(t, -1) },
          { label: "Move Down", icon: <ArrowDown size={14} />, disabled: isLast, onSelect: () => actions.onMove(t, 1) },
        ]
      : []),
    { label: "Recheck", icon: <RefreshCw size={14} />, onSelect: () => actions.onRecheck(t) },
    ...(hasVideo
      ? [{ label: "Watch in VLC", icon: <Clapperboard size={14} />, onSelect: () => actions.onWatch(t) }]
      : []),
    { label: "Open folder", icon: <FolderOpen size={14} />, onSelect: () => actions.onOpenFolder(t) },
    { label: "Remove…", icon: <Trash2 size={14} className="text-danger" />, danger: true, onSelect: () => actions.onRemove(t) },
  ];

  return (
    <div
      onClick={() => actions.onSelect(t)}
      className={`group relative min-h-[52px] cursor-default border-b border-hairline/60 transition-colors duration-150 hover:bg-row-hover focus-visible:outline-none ${
        selected
          ? "bg-accent/[0.055] shadow-[inset_2px_0_0_0_var(--color-accent)]"
          : active
            ? "bg-row-selected"
            : ""
      } ${ROW_GRID}`}
    >
      <input
        type="checkbox"
        checked={selected}
        onClick={(event) => event.stopPropagation()}
        onChange={() => actions.onToggleSelection(t)}
        className="h-3.5 w-3.5"
        aria-label={`Select ${t.name || t.infoHash}`}
      />
      <div className="min-w-0">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            actions.onSelect(t);
          }}
          className="block w-full truncate text-left text-[13px] font-medium text-ink focus-visible:rounded-sm"
          title={`Open details for ${t.name || t.infoHash}`}
        >
          {t.name || t.infoHash}
        </button>
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
      <div className="flex items-center justify-end gap-0.5" onClick={(event) => event.stopPropagation()}>
        {hasVideo && (
          <button
            type="button"
            onClick={() => actions.onWatch(t)}
            className="icon-btn"
            aria-label={`Watch ${t.name || t.infoHash} in VLC`}
            title="Watch in VLC (V)"
          >
            <Clapperboard size={14} />
          </button>
        )}
        <button
          type="button"
          onClick={() => actions.onPauseResume(t)}
          className="icon-btn"
          aria-label={`${resumable ? "Resume" : "Pause"} ${t.name || t.infoHash}`}
          title={resumable ? "Resume" : "Pause"}
        >
          {resumable ? <Play size={14} /> : <Pause size={14} />}
        </button>
        <button
          type="button"
          onClick={() => actions.onOpenFolder(t)}
          className="icon-btn"
          aria-label={`Show ${t.name || t.infoHash} in Explorer`}
          title="Show in Explorer (F)"
        >
          <FolderOpen size={14} />
        </button>
        <button
          type="button"
          onClick={() => actions.onRemove(t)}
          className="icon-btn text-ink-3 hover:bg-danger/10 hover:text-danger"
          aria-label={`Remove ${t.name || t.infoHash}`}
          title="Remove (Delete)"
        >
          <Trash2 size={14} />
        </button>
        <Dropdown label={`More actions for ${t.name || t.infoHash}`} trigger={() => <MoreHorizontal size={16} />} items={items} />
      </div>
    </div>
  );
});
