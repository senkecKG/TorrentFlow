import { ArrowDownToLine, CheckCircle2, LayoutList, Settings2 } from "lucide-react";

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
}: {
  view: View;
  onView: (v: View) => void;
  collapsed: boolean;
}) {
  return (
    <nav
      className={`flex shrink-0 flex-col gap-1 border-r border-hairline bg-panel py-4 ${
        collapsed ? "w-14 px-2.5" : "w-[210px] px-3"
      }`}
    >
      {SECTIONS.map(({ id, label, icon: Icon }) => {
        const active = view === id;
        return (
          <button
            key={id}
            onClick={() => onView(id)}
            title={collapsed ? label : undefined}
            className={`group relative flex h-10 items-center gap-3 rounded-lg px-3 text-[13px] transition-colors duration-150 ${
              active ? "bg-raised font-medium text-ink" : "text-ink-2 hover:bg-white/[0.04] hover:text-ink"
            }`}
          >
            {active && <span className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-accent" />}
            <Icon size={18} className="shrink-0" />
            {!collapsed && <span className="truncate">{label}</span>}
          </button>
        );
      })}
      <button
        onClick={() => onView("settings")}
        title={collapsed ? "Settings" : undefined}
        className={`group relative mt-auto flex h-10 items-center gap-3 rounded-lg px-3 text-[13px] transition-colors duration-150 ${
          view === "settings"
            ? "bg-raised font-medium text-ink"
            : "text-ink-2 hover:bg-white/[0.04] hover:text-ink"
        }`}
      >
        {view === "settings" && (
          <span className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-accent" />
        )}
        <Settings2 size={18} className="shrink-0" />
        {!collapsed && <span>Settings</span>}
      </button>
    </nav>
  );
}
