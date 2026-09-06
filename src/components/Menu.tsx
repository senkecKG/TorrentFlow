import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [position, setPosition] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !menuRef.current) return;
    const triggerBounds = triggerRef.current.getBoundingClientRect();
    const menuBounds = menuRef.current.getBoundingClientRect();
    const left = align === "end" ? triggerBounds.right - menuBounds.width : triggerBounds.left;
    const top = triggerBounds.bottom + menuBounds.height + 4 > window.innerHeight - 8
      ? triggerBounds.top - menuBounds.height - 4
      : triggerBounds.bottom + 4;
    setPosition({
      left: Math.max(8, Math.min(left, window.innerWidth - menuBounds.width - 8)),
      top: Math.max(8, top),
    });
    menuRef.current.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }, [open, align, width]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onOutside = (e: MouseEvent) => {
      if (!triggerRef.current?.contains(e.target as Node) && !menuRef.current?.contains(e.target as Node)) close();
    };
    const onScroll = (e: Event) => {
      if (!menuRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <div
      className="relative"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget) && !menuRef.current?.contains(e.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (!open) return;
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          triggerRef.current?.focus();
        } else if (e.key === "Tab") {
          triggerRef.current?.focus();
          setOpen(false);
        } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
          e.preventDefault();
          const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
          if (!buttons.length) return;
          const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1
            : (current + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next].focus();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
          }
        }}
        data-open={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="[&[data-open=true]]:bg-white/[0.08] [&[data-open=true]]:text-ink icon-btn"
      >
        {trigger(open)}
      </button>
      {open && items.length > 0 && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          style={{ width, ...position, maxWidth: "calc(100vw - 16px)", maxHeight: "calc(100vh - 16px)" }}
          className="fixed z-[70] overflow-y-auto rounded-md border border-hairline bg-panel-2 py-1 shadow-xl shadow-black/50"
        >
          {items.map((it, index) => (
            <button
              key={`${index}-${it.label}`}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                triggerRef.current?.focus();
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
        </div>,
        document.body,
      )}
    </div>
  );
}
