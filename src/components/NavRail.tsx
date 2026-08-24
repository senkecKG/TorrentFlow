import { ArrowDownToLine, ArrowUp, CheckCircle2, LayoutList, Settings2 } from "lucide-react";
import type { SessionStats } from "../lib/types";
import { formatSpeed } from "../lib/format";

export type View = "all" | "downloading" | "completed" | "settings";

const SECTIONS: { id: Exclude<View, "settings">; label: string; icon: typeof LayoutList }[] = [
  { id: "all", label: "All Torrents", icon: LayoutList },
  { id: "downloading", label: "Downloading", icon: ArrowDownToLine },
  { id: "completed", label: "Completed", icon: CheckCircle2 },
];

export function NavRail({
  view,
  onView,
  collapsed,
  session,
}: {
  view: View;
  onView: (v: View) => void;
  collapsed: boolean;
  session: SessionStats | null;
}) {
  return (
    <nav
      className={`flex shrink-0 flex-col gap-0.5 border-r border-hairline bg-panel py-3 ${
        collapsed ? "w-14 px-2.5" : "w-[200px] px-3"
      }`}
    >
      {SECTIONS.map(({ id, label, icon: Icon }) => {
        const active = view === id;
        return (
          <button
            key={id}
            onClick={() => onView(id)}
            title={collapsed ? label : undefined}
            className={`group relative flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors duration-150 ${
              active ? "bg-raised font-medium text-ink" : "text-ink-2 hover:bg-white/[0.04] hover:text-ink"
            }`}
          >
            {active && <span className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-full bg-accent" />}
            <Icon size={18} className="shrink-0" />
            {!collapsed && <span className="truncate">{label}</span>}
          </button>
        );
      })}
      <button
        onClick={() => onView("settings")}
        title={collapsed ? "Settings" : undefined}
        className={`group relative mt-auto flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors duration-150 ${
          view === "settings"
            ? "bg-raised font-medium text-ink"
            : "text-ink-2 hover:bg-white/[0.04] hover:text-ink"
        }`}
      >
        {view === "settings" && (
          <span className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-full bg-accent" />
        )}
        <Settings2 size={18} className="shrink-0" />
        {!collapsed && <span>Settings</span>}
      </button>

      {session && !collapsed && (
        <div className="mt-3 space-y-1 border-t border-hairline px-1 pt-3 text-[11px] tabular-nums text-ink-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <ArrowDownToLine size={13} className="text-accent" />
              DL
            </span>
            <span>{formatSpeed(session.downloadBps)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <ArrowUp size={13} className="text-slate-400" />
              UL
            </span>
            <span>{formatSpeed(session.uploadBps)}</span>
          </div>
        </div>
      )}
    </nav>
  );
}
