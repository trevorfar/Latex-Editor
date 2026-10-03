"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";

export type MenuEntry =
  | {
      label: ReactNode;
      icon?: ReactNode;
      onSelect: () => void;
      checked?: boolean;
      disabled?: boolean;
      danger?: boolean;
      hint?: string;
    }
  | { separator: true }
  | { heading: string };

interface MenuListProps {
  entries: MenuEntry[];
  onClose: () => void;
  style: React.CSSProperties;
}

function MenuList({ entries, onClose, style }: MenuListProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(style);

  // Keep the menu inside the viewport.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const next = { ...style };
    if (r.right > window.innerWidth - 8) {
      next.left = Math.max(8, window.innerWidth - r.width - 8);
      next.right = undefined;
    }
    if (r.bottom > window.innerHeight - 8) next.top = Math.max(8, window.innerHeight - r.height - 8);
    setPos(next);
  }, [style]);

  useEffect(() => {
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
        const i = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
        items[next]?.focus();
      }
    };
    const t = setTimeout(() => {
      document.addEventListener("mousedown", onDown);
      document.addEventListener("touchstart", onDown);
    });
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onClose);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={pos}
      className="pop-in fixed z-50 min-w-[200px] max-w-[320px] rounded-lg border border-line bg-bg p-1 text-[13px] shadow-pop"
      onContextMenu={(e) => e.preventDefault()}
    >
      {entries.map((entry, i) => {
        if ("separator" in entry) return <div key={i} className="my-1 h-px bg-line" />;
        if ("heading" in entry)
          return (
            <div key={i} className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-fg-faint uppercase">
              {entry.heading}
            </div>
          );
        return (
          <button
            key={i}
            role="menuitem"
            disabled={entry.disabled}
            onClick={() => {
              onClose();
              entry.onSelect();
            }}
            className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-muted focus:bg-muted focus:outline-none disabled:opacity-40 disabled:hover:bg-transparent ${
              entry.danger ? "text-danger" : "text-fg"
            }`}
          >
            <span className="flex w-4 shrink-0 justify-center text-fg-muted">
              {entry.checked !== undefined ? entry.checked ? <Check size={14} className="text-accent" /> : null : entry.icon}
            </span>
            <span className="min-w-0 flex-1 truncate">{entry.label}</span>
            {entry.hint && <span className="ml-3 text-[11px] text-fg-faint">{entry.hint}</span>}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

interface DropdownProps {
  trigger: (props: { onClick: () => void; "aria-expanded": boolean; ref: React.Ref<HTMLButtonElement> }) => ReactNode;
  entries: MenuEntry[] | (() => MenuEntry[]);
  align?: "left" | "right";
}

export function Dropdown({ trigger, entries, align = "left" }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<React.CSSProperties>({});
  const btn = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  const toggle = () => {
    if (open) return setOpen(false);
    const r = btn.current?.getBoundingClientRect();
    if (r) {
      setStyle(
        align === "right"
          ? { top: r.bottom + 4, left: Math.max(8, r.right - 220) }
          : { top: r.bottom + 4, left: r.left },
      );
    }
    setOpen(true);
  };

  return (
    <>
      {trigger({ onClick: toggle, "aria-expanded": open, ref: btn })}
      {open && <MenuList entries={typeof entries === "function" ? entries() : entries} onClose={close} style={style} />}
    </>
  );
}

/** Context menu at a screen position; render conditionally. */
export function ContextMenu({ x, y, entries, onClose }: { x: number; y: number; entries: MenuEntry[]; onClose: () => void }) {
  return <MenuList entries={entries} onClose={onClose} style={{ top: y, left: x }} />;
}
