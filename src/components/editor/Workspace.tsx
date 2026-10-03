"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Group, Panel, Separator, useDefaultLayout, usePanelRef } from "react-resizable-panels";
import { ChevronLeft, ChevronRight, Loader2, X } from "lucide-react";
import { ProjectStore } from "@/lib/project-store";
import { useResolvedTheme, useSettings, watchSystemTheme } from "@/lib/settings";
import { extractBibEntries, extractBibItems, extractCommands, extractEnvironments, extractIncludes, extractLabels, wordCount, type WordCountResult } from "@/lib/latex/scan";
import type { ProjectIndex } from "@/lib/latex/completions";
import { findInPdf, findInSource, sourceLineWords } from "@/lib/text-sync";
import { isBibPath, isTexPath } from "@/lib/paths";
import { projectToZip } from "@/lib/zip";
import { requestPersistentStorage } from "@/lib/db";
import { CodeEditor, type CodeEditorHandle, type EditorDiagnostic, type GotoRequest } from "./CodeEditor";
import { FileTree } from "./FileTree";
import { Outline } from "./Outline";
import { FormatBar } from "./FormatBar";
import { BinaryPreview } from "./BinaryPreview";
import { PdfPane, downloadPdf, safeFileName } from "./PdfPane";
import type { PdfClick, PdfViewerHandle } from "./PdfViewer";
import { TopBar, type ViewMode } from "./TopBar";
import { SettingsDialog, ShortcutsDialog, WordCountDialog } from "./dialogs";
import { useCompiler } from "./useCompiler";
import { DialogProvider, useDialogs } from "@/components/ui/dialogs";
import { Toaster, toast } from "@/components/ui/toast";

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export default function Workspace({ id }: { id: string }) {
  const [store, setStore] = useState<ProjectStore | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void ProjectStore.load(id).then((s) => !cancelled && setStore(s));
    void requestPersistentStorage();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => watchSystemTheme(), []);

  if (store === undefined) {
    return (
      <div className="flex h-dvh items-center justify-center text-fg-muted">
        <Loader2 className="spin" size={22} />
      </div>
    );
  }
  if (store === null) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-[15px] font-medium">Project not found</p>
        <p className="max-w-sm text-[13px] text-fg-muted">Projects are stored in the browser that created them. This one isn&apos;t in this browser.</p>
        <Link href="/" className="text-[13px] font-medium text-accent hover:underline">
          Back to projects
        </Link>
      </div>
    );
  }
  return (
    <DialogProvider>
      <WorkspaceInner store={store} />
      <Toaster />
    </DialogProvider>
  );
}

function WorkspaceInner({ store }: { store: ProjectStore }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const settings = useSettings();
  const theme = useResolvedTheme();
  const mobile = useMediaQuery("(max-width: 767px)");
  const dialogs = useDialogs();
  const [logsOpen, setLogsOpen] = useState(false);
  // Open the logs automatically when a compile fails with no PDF to show.
  const compiler = useCompiler(store, settings, (result, hasPdf) => {
    if (result.header.status !== "success" && !hasPdf) setLogsOpen(true);
  });

  const editorRef = useRef<CodeEditorHandle>(null);
  const viewerRef = useRef<PdfViewerHandle>(null);
  const [goto, setGoto] = useState<GotoRequest | null>(null);
  const [cursorLine, setCursorLine] = useState(1);
  const [mobileView, setMobileView] = useState<"code" | "pdf">("code");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [desktopView, setDesktopView] = useState<ViewMode>("both");
  const [dialog, setDialog] = useState<null | "settings" | "shortcuts" | "wordcount">(null);
  const [words, setWords] = useState<{ result: WordCountResult; files: string[] } | null>(null);

  const sidebarPanel = usePanelRef();
  const editorPanel = usePanelRef();
  const pdfPanel = usePanelRef();
  const layout = useDefaultLayout({ id: "texbench-workspace", storage: typeof window !== "undefined" ? localStorage : undefined });
  const sideLayout = useDefaultLayout({ id: "texbench-sidebar", storage: typeof window !== "undefined" ? localStorage : undefined });

  const { project, currentPath } = snapshot;
  const currentFile = snapshot.files.find((f) => f.path === currentPath) ?? null;

  useEffect(() => {
    document.title = `${project.name} · TeXbench`;
  }, [project.name]);

  // Persist edits when the tab is hidden or closed.
  useEffect(() => {
    const flush = () => void store.flush();
    const onVisibility = () => document.visibilityState === "hidden" && flush();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [store]);

  const diagnostics = useMemo(() => {
    const map = new Map<string, EditorDiagnostic[]>();
    const parsed = compiler.result?.parsed;
    if (!parsed) return map;
    for (const e of [...parsed.errors, ...parsed.warnings, ...parsed.typesetting]) {
      if (!e.inProject || !e.file || !e.line) continue;
      const list = map.get(e.file) ?? [];
      list.push({
        line: e.line,
        severity: e.level === "error" ? "error" : e.level === "warning" ? "warning" : "info",
        message: e.hint ? `${e.message}\n\n${e.hint}` : e.message,
      });
      map.set(e.file, list);
    }
    return map;
  }, [compiler.result]);

  // Project-wide data for autocomplete, recomputed lazily when content changes.
  const indexCache = useRef<{ version: number; files: unknown; index: ProjectIndex } | null>(null);
  const getIndex = useCallback((): ProjectIndex => {
    const snap = store.getSnapshot();
    if (indexCache.current && indexCache.current.version === store.version && indexCache.current.files === snap.files) {
      return indexCache.current.index;
    }
    const texts = store.textFiles();
    const index: ProjectIndex = { labels: [], bibEntries: [], commands: [], environments: [], files: snap.files.map((f) => f.path) };
    for (const { path, text } of texts) {
      if (isBibPath(path)) index.bibEntries.push(...extractBibEntries(text));
      else {
        index.labels.push(...extractLabels(text));
        index.commands.push(...extractCommands(text));
        index.environments.push(...extractEnvironments(text));
        for (const key of extractBibItems(text)) index.bibEntries.push({ key, type: "bibitem" });
      }
    }
    indexCache.current = { version: store.version, files: snap.files, index };
    return index;
  }, [store]);

  const jumpTo = useCallback(
    (path: string, line: number) => {
      if (!store.fileByPath(path)) return;
      store.open(path);
      setGoto({ path, line, nonce: Date.now() + Math.random() });
      if (mobile) setMobileView("code");
    },
    [store, mobile],
  );

  // ----- source <-> PDF -----
  const syncToPdf = useCallback(async () => {
    const viewer = viewerRef.current;
    if (!viewer || !currentFile || !isTexPath(currentFile.path) || !compiler.pdf) return;
    if (mobile) setMobileView("pdf");
    if (compiler.synctex) {
      const rect = compiler.synctex.forward(currentFile.path, cursorLine);
      if (rect) return viewer.reveal(rect);
    }
    const lines = (store.getText(currentFile.path) ?? "").split("\n");
    let query = sourceLineWords(lines[cursorLine - 1] ?? "");
    for (let d = 1; query.length < 4 && d < 8; d++) query = [...query, ...sourceLineWords(lines[cursorLine - 1 + d] ?? "")];
    const pages = await viewer.getText();
    const hit = findInPdf(pages, query, viewer.currentPage());
    if (!hit) return toast("Couldn't find this line in the PDF.");
    const height = viewer.pageHeights()[hit.page - 1] ?? 792;
    viewer.reveal({ page: hit.page, x: hit.x, y: height - hit.y - hit.h, w: hit.w, h: hit.h + 2 });
  }, [compiler.pdf, compiler.synctex, currentFile, cursorLine, mobile, store]);

  const onInverseSync = useCallback(
    (click: PdfClick) => {
      const files = store.getSnapshot().files.map((f) => f.path);
      if (compiler.synctex) {
        const hit = compiler.synctex.inverse(click.page, click.x, click.y, files);
        if (hit) return jumpTo(hit.path, hit.line);
      }
      const hit = findInSource(
        store.textFiles().filter((f) => isTexPath(f.path)),
        click.words,
        click.anchor,
      );
      if (hit) jumpTo(hit.path, hit.line);
      else toast("Couldn't locate that text in the source.");
    },
    [compiler.synctex, jumpTo, store],
  );

  // ----- actions -----
  const renameProject = async () => {
    const name = await dialogs.prompt({ title: "Rename project", initial: project.name, confirmLabel: "Rename" });
    if (name) await store.updateProject({ name });
  };

  const downloadZip = async () => {
    await store.flush();
    const files = store.getSnapshot().files.map((f) => (f.kind === "text" ? { ...f, content: store.getText(f.path) ?? "" } : f));
    const blob = await projectToZip(files);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeFileName(project.name)}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const doDownloadPdf = () => {
    if (compiler.pdf) downloadPdf(compiler.pdf, project.name);
    else toast("Compile first to create a PDF.");
  };

  const openWordCount = () => {
    const known = new Set(snapshot.files.map((f) => f.path));
    const visited: string[] = [];
    const visit = (p: string) => {
      if (visited.includes(p) || visited.length > 200) return;
      visited.push(p);
      for (const inc of extractIncludes(store.getText(p) ?? "", known)) visit(inc);
    };
    visit(project.mainFile);
    // Included files have no \begin{document}; count the main file's body plus included files whole.
    const main = wordCount(store.getText(project.mainFile) ?? "");
    const rest = visited.slice(1).map((p) => wordCount(`\\begin{document}${store.getText(p) ?? ""}\\end{document}`));
    const total = rest.reduce(
      (acc, r) => ({
        words: acc.words + r.words,
        headers: acc.headers + r.headers,
        mathInline: acc.mathInline + r.mathInline,
        mathDisplay: acc.mathDisplay + r.mathDisplay,
        figures: acc.figures + r.figures,
        tables: acc.tables + r.tables,
        characters: acc.characters + r.characters,
      }),
      main,
    );
    setWords({ result: total, files: visited });
    setDialog("wordcount");
  };

  const setViewMode = (mode: ViewMode) => {
    if (mobile) {
      setMobileView(mode === "pdf" ? "pdf" : "code");
      return;
    }
    setDesktopView(mode);
    if (mode === "code") {
      editorPanel.current?.expand();
      pdfPanel.current?.collapse();
    } else if (mode === "pdf") {
      pdfPanel.current?.expand();
      editorPanel.current?.collapse();
    } else {
      editorPanel.current?.expand();
      pdfPanel.current?.expand();
    }
  };

  const toggleSidebar = () => {
    if (mobile) return setDrawerOpen((o) => !o);
    const p = sidebarPanel.current;
    if (!p) return;
    if (p.isCollapsed()) p.expand();
    else p.collapse();
  };

  // Global shortcuts (the editor handles its own when focused).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === "s" || e.key === "Enter")) {
        e.preventDefault();
        void compiler.compile();
      }
      const target = e.target as HTMLElement;
      const typing = target.closest("input, textarea, select, .cm-editor, [contenteditable]");
      if (!typing && e.key === "?" && !mod) setDialog("shortcuts");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [compiler]);

  const openFile = (path: string) => {
    store.open(path);
    if (mobile) {
      setDrawerOpen(false);
      setMobileView("code");
    }
  };

  // ----- panes -----
  const sidebar = (
    <Group orientation="vertical" defaultLayout={sideLayout.defaultLayout} onLayoutChanged={sideLayout.onLayoutChanged} className="h-full bg-panel">
      <Panel id="files" defaultSize="62%" minSize="80px">
        <FileTree store={store} snapshot={snapshot} onOpen={openFile} />
      </Panel>
      <Separator className="pane-separator pane-separator-vertical" />
      <Panel id="outline" defaultSize="38%" minSize="36px">
        <Outline
          store={store}
          path={currentPath}
          cursorLine={cursorLine}
          onJump={(line) => {
            if (currentPath) jumpTo(currentPath, line);
            if (mobile) setDrawerOpen(false);
          }}
        />
      </Panel>
    </Group>
  );

  const editorPane = (
    <div className="relative flex h-full min-h-0 flex-col bg-bg">
      {settings.showFormatBar && currentFile?.kind === "text" && <FormatBar getView={() => editorRef.current?.view() ?? null} />}
      <div className="relative min-h-0 flex-1">
        <CodeEditor
          ref={editorRef}
          store={store}
          file={currentFile}
          settings={settings}
          theme={theme}
          diagnostics={diagnostics}
          goto={goto}
          getIndex={getIndex}
          onCompile={() => void compiler.compile()}
          onCursorLine={setCursorLine}
          onSyncToPdf={() => void syncToPdf()}
        />
        {currentFile?.kind === "binary" && (
          <div className="absolute inset-0 z-10">
            <BinaryPreview file={currentFile} />
          </div>
        )}
        {!currentFile && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-bg text-[13px] text-fg-faint">Select a file to edit.</div>
        )}
      </div>
    </div>
  );

  const pdfPane = (
    <PdfPane
      compiler={compiler}
      projectName={project.name}
      logsOpen={logsOpen}
      setLogsOpen={setLogsOpen}
      viewerRef={viewerRef}
      viewer={() => viewerRef.current}
      onInverseSync={onInverseSync}
      onJump={(file, line) => {
        jumpTo(file, line);
      }}
    />
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg text-fg">
      <TopBar
        snapshot={snapshot}
        settings={settings}
        compiling={compiler.compiling}
        hasPdf={Boolean(compiler.pdf)}
        mobile={mobile}
        viewMode={mobile ? mobileView : desktopView}
        onViewMode={setViewMode}
        onToggleSidebar={toggleSidebar}
        onCompile={() => void compiler.compile()}
        onCancel={compiler.cancel}
        onCompiler={(c) => void store.setCompiler(c)}
        onRename={() => void renameProject()}
        onDownloadPdf={doDownloadPdf}
        onDownloadZip={() => void downloadZip()}
        onWordCount={openWordCount}
        onSettings={() => setDialog("settings")}
        onShortcuts={() => setDialog("shortcuts")}
      />

      {mobile ? (
        <div className="relative min-h-0 flex-1">
          <div className={`absolute inset-0 ${mobileView === "code" ? "" : "pointer-events-none invisible"}`}>{editorPane}</div>
          <div className={`absolute inset-0 ${mobileView === "pdf" ? "" : "pointer-events-none invisible"}`}>{pdfPane}</div>
          {drawerOpen && (
            <div className="fixed inset-0 z-40 flex">
              <div className="pop-in flex h-full w-[82%] max-w-xs flex-col border-r border-line bg-panel shadow-pop">
                <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-3">
                  <span className="truncate text-[14px] font-medium">{project.name}</span>
                  <button onClick={() => setDrawerOpen(false)} className="rounded-md p-1.5 text-fg-muted hover:bg-muted" aria-label="Close">
                    <X size={18} />
                  </button>
                </div>
                <div className="min-h-0 flex-1">{sidebar}</div>
              </div>
              <button className="flex-1 bg-black/40" aria-label="Close files" onClick={() => setDrawerOpen(false)} />
            </div>
          )}
        </div>
      ) : (
        <Group
          orientation="horizontal"
          className="min-h-0 flex-1"
          defaultLayout={layout.defaultLayout}
          onLayoutChanged={layout.onLayoutChanged}
        >
          <Panel id="sidebar" panelRef={sidebarPanel} collapsible collapsedSize="0%" minSize="160px" maxSize="40%" defaultSize="17%">
            {sidebar}
          </Panel>
          <Separator className="pane-separator" />
          <Panel
            id="editor"
            panelRef={editorPanel}
            collapsible
            minSize="220px"
            defaultSize="41%"
            onResize={(size) => setDesktopView((v) => (size.inPixels < 1 ? "pdf" : v === "pdf" ? "both" : v))}
          >
            {editorPane}
          </Panel>
          <Separator className="pane-separator">
            <div className="absolute top-1/2 left-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col gap-1">
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => void syncToPdf()}
                title="Show this line in the PDF (Ctrl+Alt+→)"
                aria-label="Show this line in the PDF"
                className="flex h-7 w-5 items-center justify-center rounded border border-line bg-bg text-fg-muted shadow-sm hover:border-accent hover:text-accent"
              >
                <ChevronRight size={14} />
              </button>
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => toast("Double-click anywhere in the PDF to jump to that spot in the code.")}
                title="Double-click the PDF to jump to the code"
                aria-label="How to jump from the PDF to the code"
                className="flex h-7 w-5 items-center justify-center rounded border border-line bg-bg text-fg-muted shadow-sm hover:border-accent hover:text-accent"
              >
                <ChevronLeft size={14} />
              </button>
            </div>
          </Separator>
          <Panel
            id="pdf"
            panelRef={pdfPanel}
            collapsible
            minSize="220px"
            defaultSize="42%"
            onResize={(size) => setDesktopView((v) => (size.inPixels < 1 ? "code" : v === "code" ? "both" : v))}
          >
            {pdfPane}
          </Panel>
        </Group>
      )}

      <SettingsDialog open={dialog === "settings"} onClose={() => setDialog(null)} />
      <ShortcutsDialog open={dialog === "shortcuts"} onClose={() => setDialog(null)} />
      <WordCountDialog open={dialog === "wordcount"} onClose={() => setDialog(null)} result={words?.result ?? null} files={words?.files ?? []} />
    </div>
  );
}
