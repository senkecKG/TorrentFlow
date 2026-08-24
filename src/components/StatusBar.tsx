import { Activity, ArrowDownToLine, ArrowUp } from "lucide-react";
import type { SessionStats } from "../lib/types";
import { formatSpeed } from "../lib/format";

export function StatusBar({ session }: { session: SessionStats | null }) {
  const dht = session?.dhtNodes ?? null;
  const port = session?.listenPort ?? null;
  return (
    <footer className="flex h-7 shrink-0 items-center justify-between border-t border-hairline bg-panel px-3 text-[11px] tabular-nums text-ink-3">
      <span className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${dht != null && dht > 0 ? "bg-accent" : "bg-warn"}`} />
        DHT · {dht == null ? "—" : dht} nodes
      </span>
      <span>Port {port ?? "—"}</span>
      <span className="flex items-center gap-3">
        <span className="flex items-center gap-1">
          <ArrowDownToLine size={12} className="text-accent" />
          {session ? formatSpeed(session.downloadBps) : "—"}
        </span>
        <span className="flex items-center gap-1">
          <ArrowUp size={12} className="text-slate-400" />
          {session ? formatSpeed(session.uploadBps) : "—"}
        </span>
        <span className="flex items-center gap-1">
          <Activity size={12} />
          {session?.activeDownloads ?? 0} active
        </span>
      </span>
    </footer>
  );
}
