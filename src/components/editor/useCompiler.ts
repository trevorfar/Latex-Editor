"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { requestCompile } from "@/lib/compile-client";
import { parseLatexLog, summarizeOutput, type LogEntry, type ParsedLog } from "@/lib/log-parser";
import { SyncTex } from "@/lib/synctex";
import type { ProjectStore } from "@/lib/project-store";
import type { Settings } from "@/lib/settings";
import type { CompileResponseHeader } from "@/lib/types";
import * as db from "@/lib/db";

export interface CompileResult {
  header: CompileResponseHeader;
  parsed: ParsedLog;
  /** True when this compile produced the PDF on screen. */
  producedPdf: boolean;
  at: number;
}

export interface CompilerState {
  compiling: boolean;
  result: CompileResult | null;
  pdf: Uint8Array | null;
  synctex: SyncTex | null;
  /** Network or service problem, not a LaTeX error. */
  error: string | null;
  /** Whether a cached PDF from a previous session is being shown. */
  fromCache: boolean;
}

const EMPTY_LOG: ParsedLog = { errors: [], warnings: [], typesetting: [] };

export function useCompiler(
  store: ProjectStore,
  settings: Settings,
  onFinished?: (result: CompileResult, hasPdf: boolean) => void,
) {
  const [state, setState] = useState<CompilerState>({
    compiling: false,
    result: null,
    pdf: null,
    synctex: null,
    error: null,
    fromCache: false,
  });
  const inflight = useRef<AbortController | null>(null);
  const queued = useRef(false);
  const compiledVersion = useRef(-1);
  const settingsRef = useRef(settings);
  const finishedRef = useRef(onFinished);
  useLayoutEffect(() => {
    settingsRef.current = settings;
    finishedRef.current = onFinished;
  });
  const hasPdf = useRef(false);

  const compile = useCallback(async () => {
    if (inflight.current) {
      queued.current = true;
      return;
    }
    const controller = new AbortController();
    inflight.current = controller;
    const version = store.version;
    const { project, files } = store.getSnapshot();
    const projectFiles = files.map((f) => f.path);
    setState((s) => ({ ...s, compiling: true }));
    void store.flush();

    try {
      const out = await requestCompile(
        {
          projectId: project.id,
          compiler: project.compiler,
          mainFile: project.mainFile,
          stopOnFirstError: settingsRef.current.stopOnFirstError,
        },
        store.compileFiles(),
        controller.signal,
      );
      const { header } = out;
      const parsed = header.log
        ? parseLatexLog(header.log, { mainFile: project.mainFile, projectFiles, unwrap: header.backend === "remote" })
        : { ...EMPTY_LOG, errors: [], warnings: [], typesetting: [] };

      if (header.output) {
        for (const e of summarizeOutput(header.output)) (e.level === "error" ? parsed.errors : parsed.warnings).push(e);
      }
      if (header.status !== "success" && parsed.errors.length === 0) {
        const fallback: LogEntry = {
          level: "error",
          message: header.message ?? (header.pdfSize ? "LaTeX reported a problem. See the raw log." : "Compilation failed and no PDF was produced."),
          content: header.output?.slice(-2000) ?? "",
          file: null,
          inProject: false,
          line: null,
        };
        parsed.errors.push(fallback);
      }

      const synctex = out.synctex ? SyncTex.fromGzip(out.synctex) : null;
      compiledVersion.current = version;
      const result: CompileResult = { header, parsed, producedPdf: Boolean(out.pdf), at: Date.now() };
      if (out.pdf) hasPdf.current = true;
      setState((s) => ({
        compiling: false,
        error: header.status === "error" ? (header.message ?? "Compile failed.") : null,
        result,
        pdf: out.pdf ?? s.pdf,
        synctex: out.pdf ? synctex : s.synctex,
        fromCache: out.pdf ? false : s.fromCache,
      }));
      finishedRef.current?.(result, hasPdf.current);
      if (out.pdf) {
        void db.saveOutput(project.id, new Blob([out.pdf as BlobPart], { type: "application/pdf" }));
      }
    } catch (err) {
      if (controller.signal.aborted) {
        setState((s) => ({ ...s, compiling: false }));
      } else {
        setState((s) => ({ ...s, compiling: false, error: err instanceof Error ? err.message : "Compile failed." }));
      }
    } finally {
      inflight.current = null;
      if (queued.current) {
        queued.current = false;
        if (store.version !== compiledVersion.current) void compile();
      }
    }
  }, [store]);

  const cancel = useCallback(() => {
    queued.current = false;
    inflight.current?.abort();
  }, []);

  // Show the last PDF from a previous session immediately, then compile fresh.
  useEffect(() => {
    let cancelled = false;
    void db.getOutput(store.project.id).then(async (cached) => {
      if (cancelled) return;
      if (cached) {
        const pdf = new Uint8Array(await cached.pdf.arrayBuffer());
        if (!cancelled) {
          hasPdf.current = true;
          setState((s) => (s.pdf ? s : { ...s, pdf, fromCache: true }));
        }
      }
      if (!cancelled) void compile();
    });
    return () => {
      cancelled = true;
    };
  }, [store, compile]);

  // Auto-compile after a pause in typing.
  useEffect(() => {
    if (!settings.autoCompile) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = store.onContentChange(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (store.version !== compiledVersion.current) void compile();
      }, settings.autoCompileDelay);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [store, compile, settings.autoCompile, settings.autoCompileDelay]);

  // Recompile when the compiler or main file changes.
  const { compiler, mainFile } = store.getSnapshot().project;
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    void compile();
  }, [compiler, mainFile, compile]);

  return { ...state, compile, cancel };
}
