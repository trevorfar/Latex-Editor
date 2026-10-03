"use client";

import { useMemo, useState } from "react";
import { AlertCircle, AlertTriangle, ChevronDown, Copy, FileWarning, Info, X } from "lucide-react";
import type { LogEntry } from "@/lib/log-parser";
import type { CompileResult } from "./useCompiler";
import { toast } from "@/components/ui/toast";

type Filter = "all" | "error" | "warning" | "typesetting";

interface LogsPanelProps {
  result: CompileResult | null;
  error: string | null;
  onJump: (file: string, line: number) => void;
  onClose: () => void;
}

const LEVEL_STYLE = {
  error: { icon: AlertCircle, bar: "border-l-danger", tint: "bg-danger-soft", text: "text-danger" },
  warning: { icon: AlertTriangle, bar: "border-l-warning", tint: "bg-warning-soft", text: "text-warning" },
  typesetting: { icon: FileWarning, bar: "border-l-info", tint: "bg-info-soft", text: "text-info" },
} as const;

function Entry({ entry, onJump }: { entry: LogEntry; onJump: LogsPanelProps["onJump"] }) {
  const [expanded, setExpanded] = useState(entry.level === "error");
  const style = LEVEL_STYLE[entry.level];
  const Icon = style.icon;
  const canJump = entry.inProject && entry.file && entry.line;
  return (
    <div className={`rounded-md border border-line border-l-4 ${style.bar} bg-bg`}>
      <div className={`flex items-start gap-2 rounded-tr-md px-3 py-2 ${style.tint}`}>
        <Icon size={15} className={`mt-0.5 shrink-0 ${style.text}`} />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium break-words text-fg">{entry.message}</div>
          {entry.file && (
            <button
              disabled={!canJump}
              onClick={() => canJump && onJump(entry.file!, entry.line!)}
              className={`mt-0.5 font-mono text-[11.5px] ${canJump ? "text-accent hover:underline" : "text-fg-faint"}`}
            >
              {entry.file}
              {entry.line ? `, line ${entry.line}` : ""}
            </button>
          )}
        </div>
        {entry.content && (
          <button onClick={() => setExpanded((e) => !e)} className="shrink-0 rounded p-0.5 text-fg-faint hover:text-fg" aria-label="Toggle details">
            <ChevronDown size={15} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>
      {entry.hint && (
        <div className="flex gap-2 border-t border-line px-3 py-2 text-[12.5px] text-fg-muted">
          <Info size={14} className="mt-0.5 shrink-0 text-fg-faint" />
          <span>{entry.hint}</span>
        </div>
      )}
      {expanded && entry.content && (
        <pre className="overflow-x-auto border-t border-line px-3 py-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-fg-muted">
          {entry.content}
        </pre>
      )}
    </div>
  );
}

export function LogsPanel({ result, error, onJump, onClose }: LogsPanelProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const [raw, setRaw] = useState(false);
  const parsed = result?.parsed;
  const counts = {
    error: parsed?.errors.length ?? 0,
    warning: parsed?.warnings.length ?? 0,
    typesetting: parsed?.typesetting.length ?? 0,
  };
  const entries = useMemo(() => {
    if (!parsed) return [];
    if (filter === "error") return parsed.errors;
    if (filter === "warning") return parsed.warnings;
    if (filter === "typesetting") return parsed.typesetting;
    return [...parsed.errors, ...parsed.warnings, ...parsed.typesetting];
  }, [parsed, filter]);

  const rawText = [result?.header.log, result?.header.output ? `\n===== latexmk output =====\n${result.header.output}` : ""].filter(Boolean).join("\n");
  const remoteNoLog = result?.header.backend === "remote" && !result.header.log;

  const tabs: { id: Filter; label: string; count?: number }[] = [
    { id: "all", label: "All" },
    { id: "error", label: "Errors", count: counts.error },
    { id: "warning", label: "Warnings", count: counts.warning },
    { id: "typesetting", label: "Typesetting", count: counts.typesetting },
  ];

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-subtle">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line bg-bg px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setFilter(t.id);
                setRaw(false);
              }}
              className={`flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] ${
                filter === t.id && !raw ? "bg-muted font-medium text-fg" : "text-fg-muted hover:bg-muted"
              }`}
            >
              {t.label}
              {t.count !== undefined && t.count > 0 && (
                <span
                  className={`rounded-full px-1.5 text-[10.5px] font-semibold ${
                    t.id === "error" ? "bg-danger text-white" : t.id === "warning" ? "bg-warning text-white" : "bg-info text-white"
                  }`}
                >
                  {t.count}
                </span>
              )}
            </button>
          ))}
          <button
            onClick={() => setRaw(true)}
            className={`h-7 shrink-0 rounded-md px-2.5 text-[12.5px] ${raw ? "bg-muted font-medium text-fg" : "text-fg-muted hover:bg-muted"}`}
          >
            Raw log
          </button>
        </div>
        <button onClick={onClose} className="rounded-md p-1.5 text-fg-muted hover:bg-muted hover:text-fg" aria-label="Close logs">
          <X size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {error && (
          <div className="mb-3 rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-[13px] text-fg">
            <strong className="text-danger">Compile service problem:</strong> {error}
          </div>
        )}
        {raw ? (
          rawText ? (
            <div className="relative">
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(rawText).then(() => toast("Log copied.", "success"));
                }}
                className="absolute top-2 right-2 flex items-center gap-1 rounded-md border border-line bg-bg px-2 py-1 text-[11.5px] text-fg-muted hover:text-fg"
              >
                <Copy size={12} /> Copy
              </button>
              <pre className="overflow-x-auto rounded-md border border-line bg-bg p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-fg-muted">
                {rawText}
              </pre>
            </div>
          ) : (
            <p className="text-[13px] text-fg-muted">
              {remoteNoLog ? "The remote compile service only returns logs when a compile fails." : "No log yet."}
            </p>
          )
        ) : (
          <div className="flex flex-col gap-2">
            {entries.map((e, i) => (
              <Entry key={`${filter}-${i}`} entry={e} onJump={onJump} />
            ))}
            {result && entries.length === 0 && (
              <div className="rounded-md border border-line bg-bg px-4 py-6 text-center text-[13px] text-fg-muted">
                {filter === "all" || filter === "error" ? "No errors. " : "Nothing here. "}
                {remoteNoLog && filter !== "error" && (
                  <span className="block pt-1 text-[12px] text-fg-faint">
                    Warnings aren&apos;t available: the remote compile service only returns logs when a compile fails. Install TeX Live on
                    the server for full logs.
                  </span>
                )}
              </div>
            )}
            {!result && !error && <p className="text-[13px] text-fg-muted">Compile to see errors and warnings here.</p>}
          </div>
        )}
      </div>
      {result && (
        <div className="shrink-0 border-t border-line bg-bg px-3 py-1.5 text-[11.5px] text-fg-faint">
          {result.header.compiler} · {result.header.backend === "local" ? "local TeX Live" : "remote service"} · {(result.header.durationMs / 1000).toFixed(1)}s ·{" "}
          {new Date(result.at).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}
