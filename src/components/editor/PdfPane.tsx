"use client";

import { useState, type Ref } from "react";
import { AlertCircle, AlertTriangle, Download, ExternalLink, FileText, Loader2, Minus, Plus, ScrollText } from "lucide-react";
import { PdfViewer, type PdfClick, type PdfViewerHandle } from "./PdfViewer";
import { LogsPanel } from "./LogsPanel";
import type { CompilerState } from "./useCompiler";
import { Button } from "@/components/ui/Button";

const SCALE_KEY = "latex-studio:pdf-scale";
const PRESETS: { value: string; label: string }[] = [
  { value: "page-width", label: "Fit width" },
  { value: "page-fit", label: "Fit page" },
  { value: "0.5", label: "50%" },
  { value: "0.75", label: "75%" },
  { value: "1", label: "100%" },
  { value: "1.25", label: "125%" },
  { value: "1.5", label: "150%" },
  { value: "2", label: "200%" },
  { value: "3", label: "300%" },
  { value: "4", label: "400%" },
];

function readScale(): string {
  try {
    return localStorage.getItem(SCALE_KEY) || "page-width";
  } catch {
    return "page-width";
  }
}

export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "document";
}

export function downloadPdf(pdf: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([pdf as BlobPart], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeFileName(name)}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

interface PdfPaneProps {
  compiler: CompilerState & { compile: () => void };
  projectName: string;
  logsOpen: boolean;
  setLogsOpen: (open: boolean) => void;
  viewerRef: Ref<PdfViewerHandle>;
  viewer: () => PdfViewerHandle | null;
  onInverseSync: (click: PdfClick) => void;
  onJump: (file: string, line: number) => void;
}

export function PdfPane({ compiler, projectName, logsOpen, setLogsOpen, viewerRef, viewer, onInverseSync, onJump }: PdfPaneProps) {
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [pageDraft, setPageDraft] = useState<string | null>(null);
  const [scaleValue, setScaleValue] = useState("page-width");
  const [scalePct, setScalePct] = useState(100);
  const [initialScale] = useState(readScale);
  const { pdf, result, compiling, error } = compiler;
  const errors = result?.parsed.errors.length ?? 0;
  const warnings = (result?.parsed.warnings.length ?? 0) + (result?.parsed.typesetting.length ?? 0);
  const failed = result?.header.status !== undefined && result.header.status !== "success";

  const setScale = (value: string) => {
    viewer()?.setScale(value);
    setScaleValue(value);
    try {
      localStorage.setItem(SCALE_KEY, value);
    } catch {
      // Not persisted.
    }
  };

  const openInTab = () => {
    if (!pdf) return;
    const url = URL.createObjectURL(new Blob([pdf as BlobPart], { type: "application/pdf" }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const scaleLabel = PRESETS.find((p) => p.value === scaleValue)?.label ?? `${scalePct}%`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line bg-bg px-1.5">
        <button
          onClick={() => setLogsOpen(!logsOpen)}
          title="Logs and errors"
          className={`flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12.5px] ${logsOpen ? "bg-muted text-fg" : "text-fg-muted hover:bg-muted hover:text-fg"}`}
        >
          <ScrollText size={15} />
          <span className="hidden sm:inline">Logs</span>
          {errors > 0 && (
            <span className="flex items-center gap-0.5 rounded-full bg-danger px-1.5 text-[10.5px] font-semibold text-white">
              <AlertCircle size={10} />
              {errors}
            </span>
          )}
          {warnings > 0 && (
            <span className="flex items-center gap-0.5 rounded-full bg-warning px-1.5 text-[10.5px] font-semibold text-white">
              <AlertTriangle size={10} />
              {warnings}
            </span>
          )}
        </button>

        <div className="min-w-0 flex-1" />

        {pdf && (
          <>
            <form
              className="flex items-center gap-1 text-[12.5px] text-fg-muted"
              onSubmit={(e) => {
                e.preventDefault();
                if (pageDraft) viewer()?.goToPage(Number(pageDraft));
                setPageDraft(null);
              }}
            >
              <input
                value={pageDraft ?? String(page)}
                onChange={(e) => setPageDraft(e.target.value.replace(/\D/g, ""))}
                onFocus={(e) => e.target.select()}
                onBlur={() => setPageDraft(null)}
                className="h-7 w-9 rounded-md border border-line bg-bg text-center text-[12.5px] text-fg outline-none focus:border-accent"
                aria-label="Page number"
                inputMode="numeric"
              />
              <span className="whitespace-nowrap">/ {pages}</span>
            </form>
            <span className="mx-1 h-5 w-px bg-line" />
            <Button variant="ghost" size="sm" icon onClick={() => viewer()?.zoomOut()} title="Zoom out" aria-label="Zoom out">
              <Minus size={15} />
            </Button>
            <select
              value={PRESETS.some((p) => p.value === scaleValue) ? scaleValue : "custom"}
              onChange={(e) => setScale(e.target.value)}
              className="h-7 max-w-[92px] rounded-md border border-line bg-bg px-1 text-[12.5px] text-fg outline-none focus:border-accent"
              aria-label="Zoom"
            >
              {!PRESETS.some((p) => p.value === scaleValue) && <option value="custom">{scaleLabel}</option>}
              {PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <Button variant="ghost" size="sm" icon onClick={() => viewer()?.zoomIn()} title="Zoom in" aria-label="Zoom in">
              <Plus size={15} />
            </Button>
            <span className="mx-1 h-5 w-px bg-line" />
            <Button variant="ghost" size="sm" icon onClick={openInTab} title="Open in new tab (print from there)" aria-label="Open PDF in new tab">
              <ExternalLink size={15} />
            </Button>
            <Button variant="ghost" size="sm" icon onClick={() => downloadPdf(pdf, projectName)} title="Download PDF" aria-label="Download PDF">
              <Download size={15} />
            </Button>
          </>
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        {compiling && <div className="progress-bar absolute inset-x-0 top-0 z-30 h-0.5 bg-accent-soft" />}

        {pdf && failed && !logsOpen && (
          <button
            onClick={() => setLogsOpen(true)}
            className="absolute top-2 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-danger/40 bg-bg px-3 py-1 text-[12px] text-danger shadow-pop"
          >
            <AlertCircle size={13} />
            {result?.producedPdf ? "Compiled with errors" : "Compile failed: showing the last PDF"}
          </button>
        )}

        <PdfViewer
          ref={viewerRef}
          data={pdf}
          initialScale={initialScale}
          onPageChange={(p, total) => {
            setPage(p);
            setPages(total);
          }}
          onScaleChange={(scale, value) => {
            setScalePct(Math.round(scale * 100));
            setScaleValue(value);
          }}
          onDoubleClick={onInverseSync}
        />

        {!pdf && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-pdf p-6 text-center">
            {compiling ? (
              <>
                <Loader2 size={28} className="spin text-accent" />
                <p className="text-[13px] text-fg-muted">Compiling…</p>
              </>
            ) : failed || error ? (
              <>
                <AlertCircle size={28} className="text-danger" />
                <p className="max-w-xs text-[13px] text-fg-muted">{error ?? "No PDF yet. Fix the errors and recompile."}</p>
                <div className="flex gap-2">
                  <Button onClick={() => setLogsOpen(true)}>View logs</Button>
                  <Button variant="primary" onClick={compiler.compile}>
                    Recompile
                  </Button>
                </div>
              </>
            ) : (
              <>
                <FileText size={28} className="text-fg-faint" />
                <p className="text-[13px] text-fg-muted">Compile to see the PDF here.</p>
                <Button variant="primary" onClick={compiler.compile}>
                  Compile
                </Button>
              </>
            )}
          </div>
        )}

        {logsOpen && <LogsPanel result={result} error={error} onJump={onJump} onClose={() => setLogsOpen(false)} />}
      </div>
    </div>
  );
}
