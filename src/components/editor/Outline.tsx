"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, ListTree } from "lucide-react";
import { extractOutline, type OutlineItem } from "@/lib/latex/scan";
import type { ProjectStore } from "@/lib/project-store";
import { isTexPath } from "@/lib/paths";

interface OutlineProps {
  store: ProjectStore;
  path: string | null;
  cursorLine: number;
  onJump: (line: number) => void;
}

export function Outline({ store, path, cursorLine, onJump }: OutlineProps) {
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = store.onContentChange((changed) => {
      if (changed !== path) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setTick((t) => t + 1), 400);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [store, path]);

  const items: OutlineItem[] = useMemo(
    () => (path && isTexPath(path) && tick >= 0 ? extractOutline(store.getText(path) ?? "") : []),
    [store, path, tick],
  );

  const minLevel = useMemo(() => Math.min(...items.map((i) => i.level), 9), [items]);
  // The section containing the cursor.
  const activeIndex = useMemo(() => {
    let idx = -1;
    items.forEach((it, i) => {
      if (it.line <= cursorLine) idx = i;
    });
    return idx;
  }, [items, cursorLine]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 shrink-0 items-center gap-1.5 border-b border-line px-2 text-left text-[11px] font-semibold tracking-wide text-fg-faint uppercase hover:text-fg"
      >
        <ChevronRight size={13} className={`transition-transform ${open ? "rotate-90" : ""}`} />
        <ListTree size={13} />
        Outline
      </button>
      {open && (
        <div className="min-h-0 flex-1 overflow-auto p-1.5">
          {items.length === 0 ? (
            <p className="px-2 py-3 text-[12px] text-fg-faint">
              {path && isTexPath(path) ? "No sections in this file." : "Open a .tex file to see its outline."}
            </p>
          ) : (
            <ul>
              {items.map((item, i) => (
                <li key={`${item.line}-${i}`}>
                  <button
                    onClick={() => onJump(item.line)}
                    className={`block w-full truncate rounded-md py-1 pr-2 text-left text-[12.5px] ${
                      i === activeIndex ? "bg-accent-soft font-medium text-fg" : "text-fg-muted hover:bg-muted hover:text-fg"
                    } ${item.level <= minLevel ? "font-medium" : ""}`}
                    style={{ paddingLeft: 8 + (item.level - minLevel) * 12 }}
                    title={`${item.title} (line ${item.line})`}
                  >
                    {item.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
