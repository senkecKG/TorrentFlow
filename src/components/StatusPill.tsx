import { Loader2 } from "lucide-react";
import type { TorrentDto } from "../lib/types";

interface PillState {
  label: string;
  title?: string;
  dot?: string;
  spin?: boolean;
}

export function StatusPill({ t }: { t: TorrentDto }) {
  let s: PillState;
  if (t.error) {
    s = { label: "Error", title: t.error, dot: "bg-danger" };
  } else if (t.queued) {
    s = { label: "Queued", dot: "border border-ink-3 bg-transparent" };
  } else {
    switch (t.state) {
      case "fetching_metadata":
        s = { label: "Fetching…", title: "Fetching torrent information…", spin: true };
        break;
      case "checking":
        s = { label: "Checking", title: "Checking", dot: "bg-warn animate-pulse-soft" };
        break;
      case "downloading":
        s = { label: "Downloading", dot: "bg-accent" };
        break;
      case "seeding":
        s = { label: "Seeding", dot: "bg-accent/50" };
        break;
      default:
        s = { label: "Paused", dot: "bg-ink-3" };
    }
  }
  return (
    <span
      title={s.title}
      className="flex items-center gap-1.5 text-[11px] whitespace-nowrap text-ink-2"
    >
      {s.spin ? (
        <Loader2 size={12} className="shrink-0 animate-spin text-warn" />
      ) : (
        s.dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.dot}`} />
      )}
      <span className={t.error ? "text-danger" : undefined}>{s.label}</span>
    </span>
  );
}
