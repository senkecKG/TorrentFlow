import { useEffect, useRef, useState, type ReactNode } from "react";
import { useClickOutside } from "../hooks/useClickOutside";

export interface MenuItemDef {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export function Dropdown({
  label,
  trigger,
  items,
  align = "end",
  width = 184,
}: {
  label: string;
  trigger: (open: boolean) => ReactNode;
  items: MenuItemDef[];
  align?: "start" | "end";
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, open, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        data-open={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="[&[data-open=true]]:bg-white/[0.08] [&[data-open=true]]:text-ink icon-btn"
      >
        {trigger(open)}
      </button>
      {open && items.length > 0 && (
        <div
          role="menu"
          style={{ width }}
          className={`absolute top-full z-50 mt-1 animate-pop-in overflow-hidden rounded-md border border-hairline bg-panel-2 py-1 shadow-xl shadow-black/50 ${
            align === "end" ? "right-0" : "left-0"
          }`}
        >
          {items.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              disabled={it.disabled}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                it.onSelect();
              }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors duration-100 hover:bg-white/[0.05] disabled:pointer-events-none disabled:opacity-40 ${
                it.danger ? "text-danger hover:bg-danger/10" : "text-ink"
              }`}
            >
              {it.icon && <span className="flex w-4 shrink-0 justify-center">{it.icon}</span>}
              <span className="flex-1 truncate">{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
