"use client";

import Link from "next/link";
import {
  ChevronDown,
  Cloud,
  CloudOff,
  Columns2,
  Download,
  FileArchive,
  FileCode2,
  FileText,
  Keyboard,
  Loader2,
  Menu as MenuIcon,
  MoreVertical,
  PanelLeft,
  Play,
  Settings as SettingsIcon,
  Sigma,
  Square,
  Type,
  ArrowLeft,
} from "lucide-react";
import { COMPILERS, type Compiler } from "@/lib/types";
import type { StoreSnapshot } from "@/lib/project-store";
import type { Settings } from "@/lib/settings";
import { updateSettings } from "@/lib/settings";
import { Dropdown, type MenuEntry } from "@/components/ui/Menu";

export type ViewMode = "both" | "code" | "pdf";

interface TopBarProps {
  snapshot: StoreSnapshot;
  settings: Settings;
  compiling: boolean;
  hasPdf: boolean;
  mobile: boolean;
  viewMode: ViewMode;
  onViewMode: (mode: ViewMode) => void;
  onToggleSidebar: () => void;
  onCompile: () => void;
  onCancel: () => void;
  onCompiler: (c: Compiler) => void;
  onRename: () => void;
  onDownloadPdf: () => void;
  onDownloadZip: () => void;
  onWordCount: () => void;
  onSettings: () => void;
  onShortcuts: () => void;
}

function SaveStatus({ state }: { state: StoreSnapshot["saveState"] }) {
  if (state === "error")
    return (
      <span className="flex items-center gap-1 text-[12px] text-danger" title="Couldn't save to browser storage">
        <CloudOff size={13} /> Not saved
      </span>
    );
  return (
    <span className="flex items-center gap-1 text-[12px] text-fg-faint" title="Saved in this browser">
      {state === "saved" ? <Cloud size={13} /> : <Loader2 size={13} className="spin" />}
      <span className="hidden lg:inline">{state === "saved" ? "Saved" : "Saving…"}</span>
    </span>
  );
}

export function TopBar(props: TopBarProps) {
  const { snapshot, settings, compiling, hasPdf, mobile, viewMode, onViewMode } = props;
  const { project } = snapshot;

  const compileMenu: MenuEntry[] = [
    { heading: "Auto-compile" },
    { label: "On: recompile as you type", checked: settings.autoCompile, onSelect: () => updateSettings({ autoCompile: true }) },
    { label: "Off: compile manually", checked: !settings.autoCompile, onSelect: () => updateSettings({ autoCompile: false }) },
    { heading: "Compiler" },
    ...COMPILERS.map((c) => ({ label: c.label, checked: project.compiler === c.id, onSelect: () => props.onCompiler(c.id) })),
    { heading: "On errors" },
    { label: "Try to compile anyway", checked: !settings.stopOnFirstError, onSelect: () => updateSettings({ stopOnFirstError: false }) },
    { label: "Stop on first error", checked: settings.stopOnFirstError, onSelect: () => updateSettings({ stopOnFirstError: true }) },
    ...(compiling ? ([{ separator: true }, { label: "Stop compiling", icon: <Square size={13} />, onSelect: props.onCancel }] as MenuEntry[]) : []),
  ];

  const moreMenu: MenuEntry[] = [
    { label: "Download PDF", icon: <Download size={14} />, onSelect: props.onDownloadPdf, disabled: !hasPdf },
    { label: "Download source (.zip)", icon: <FileArchive size={14} />, onSelect: props.onDownloadZip },
    { label: "Word count", icon: <Type size={14} />, onSelect: props.onWordCount },
    { label: "Rename project", icon: <FileText size={14} />, onSelect: props.onRename },
    { separator: true },
    { label: "Settings", icon: <SettingsIcon size={14} />, onSelect: props.onSettings },
    { label: "Keyboard shortcuts", icon: <Keyboard size={14} />, onSelect: props.onShortcuts, hint: "?" },
  ];

  return (
    <header className="flex h-12 shrink-0 items-center gap-1.5 border-b border-line bg-bg px-2">
      <button
        onClick={props.onToggleSidebar}
        title={mobile ? "Files" : "Toggle file tree"}
        aria-label={mobile ? "Files" : "Toggle file tree"}
        className="rounded-md p-1.5 text-fg-muted hover:bg-muted hover:text-fg"
      >
        {mobile ? <MenuIcon size={18} /> : <PanelLeft size={18} />}
      </button>
      <Link href="/" className="flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-fg-muted hover:bg-muted hover:text-fg" title="All projects">
        {mobile ? (
          <ArrowLeft size={17} />
        ) : (
          <>
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-accent-fg">
              <Sigma size={15} strokeWidth={2.5} />
            </span>
            <span className="hidden text-[13px] font-semibold text-fg md:inline">TeXbench</span>
          </>
        )}
      </Link>
      <span className="hidden text-fg-faint md:inline">/</span>
      <button
        onClick={props.onRename}
        className="min-w-0 truncate rounded-md px-1.5 py-1 text-[14px] font-medium hover:bg-muted"
        title="Rename project"
      >
        {project.name}
      </button>
      {!mobile && <SaveStatus state={snapshot.saveState} />}

      <div className="min-w-0 flex-1" />

      {mobile ? (
        <div className="flex rounded-md border border-line bg-subtle p-0.5">
          {(["code", "pdf"] as const).map((m) => (
            <button
              key={m}
              onClick={() => onViewMode(m)}
              className={`flex items-center gap-1 rounded px-2 py-1 text-[12px] ${viewMode === m ? "bg-bg font-medium text-fg shadow-sm" : "text-fg-muted"}`}
            >
              {m === "code" ? <FileCode2 size={13} /> : <FileText size={13} />}
              {m === "code" ? "Code" : "PDF"}
            </button>
          ))}
        </div>
      ) : (
        <div className="hidden rounded-md border border-line bg-subtle p-0.5 sm:flex" role="group" aria-label="Layout">
          {(
            [
              ["code", "Code only", <FileCode2 key="c" size={14} />],
              ["both", "Code and PDF", <Columns2 key="b" size={14} />],
              ["pdf", "PDF only", <FileText key="p" size={14} />],
            ] as const
          ).map(([m, label, icon]) => (
            <button
              key={m}
              onClick={() => onViewMode(m)}
              title={label}
              aria-label={label}
              aria-pressed={viewMode === m}
              className={`rounded px-2 py-1 ${viewMode === m ? "bg-bg text-fg shadow-sm" : "text-fg-muted hover:text-fg"}`}
            >
              {icon}
            </button>
          ))}
        </div>
      )}

      <div className="flex shrink-0 items-stretch overflow-hidden rounded-md bg-accent text-accent-fg">
        <button
          onClick={props.onCompile}
          title="Compile (Ctrl+S)"
          className="flex h-8 items-center gap-1.5 pr-2 pl-2.5 text-[13px] font-semibold hover:bg-accent-hover"
        >
          {compiling ? <Loader2 size={15} className="spin" /> : <Play size={14} fill="currentColor" />}
          <span className={mobile ? "sr-only" : ""}>{compiling ? "Compiling" : "Recompile"}</span>
        </button>
        <Dropdown
          align="right"
          entries={compileMenu}
          trigger={({ onClick, ref }) => (
            <button
              ref={ref}
              onClick={onClick}
              aria-label="Compile options"
              title="Compile options"
              className="flex h-8 items-center border-l border-black/15 px-1.5 hover:bg-accent-hover"
            >
              <ChevronDown size={15} />
            </button>
          )}
        />
      </div>
      {!mobile && (
        <button
          onClick={props.onDownloadPdf}
          disabled={!hasPdf}
          title="Download PDF"
          aria-label="Download PDF"
          className="rounded-md p-1.5 text-fg-muted hover:bg-muted hover:text-fg disabled:opacity-40"
        >
          <Download size={18} />
        </button>
      )}
      <Dropdown
        align="right"
        entries={moreMenu}
        trigger={({ onClick, ref }) => (
          <button ref={ref} onClick={onClick} aria-label="More" title="More" className="rounded-md p-1.5 text-fg-muted hover:bg-muted hover:text-fg">
            <MoreVertical size={18} />
          </button>
        )}
      />
    </header>
  );
}
