"use client";

import { useEffect, useImperativeHandle, useLayoutEffect, useRef, type Ref } from "react";
import "pdfjs-dist/web/pdf_viewer.css";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { EventBus, PDFLinkService, PDFViewer as PDFViewerType } from "pdfjs-dist/web/pdf_viewer.mjs";
import type { PdfPageText } from "@/lib/text-sync";

type PdfJs = typeof import("pdfjs-dist");
type ViewerModule = typeof import("pdfjs-dist/web/pdf_viewer.mjs");

let libPromise: Promise<{ pdfjs: PdfJs; viewer: ViewerModule }> | null = null;

function loadPdfJs() {
  libPromise ??= (async () => {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
    // pdf_viewer.mjs reads the core library from this global at import time.
    (globalThis as unknown as { pdfjsLib: PdfJs }).pdfjsLib = pdfjs;
    const viewer = await import("pdfjs-dist/web/pdf_viewer.mjs");
    return { pdfjs, viewer };
  })();
  return libPromise;
}

interface Buffer {
  scroll: HTMLDivElement;
  eventBus: EventBus;
  linkService: PDFLinkService;
  viewer: PDFViewerType;
  doc: PDFDocumentProxy | null;
}

export interface PdfClick {
  page: number;
  /** Top-left origin, PDF points. */
  x: number;
  y: number;
  /** Words around the clicked word, and the index of the clicked word among them. */
  words: string[];
  anchor: number;
}

export interface PdfViewerHandle {
  zoomIn(): void;
  zoomOut(): void;
  setScale(value: string): void;
  goToPage(page: number): void;
  /** Scrolls to and flashes a rectangle (top-left origin, PDF points). */
  reveal(rect: { page: number; x: number; y: number; w: number; h: number }): void;
  getText(): Promise<PdfPageText[]>;
  currentPage(): number;
  pageHeights(): number[];
}

export interface PdfViewerProps {
  data: Uint8Array | null;
  initialScale: string;
  onPageChange?: (page: number, total: number) => void;
  onScaleChange?: (scale: number, value: string) => void;
  onDoubleClick?: (click: PdfClick) => void;
  ref?: Ref<PdfViewerHandle>;
}

const AUTO_SCALES = new Set(["page-width", "page-fit", "auto", "page-actual"]);

function wordsAround(target: HTMLElement, clientX: number): { words: string[]; anchor: number } {
  const layer = target.closest(".textLayer");
  if (!layer) return { words: [], anchor: 0 };
  const spans = [...layer.querySelectorAll<HTMLElement>("span")].filter((s) => !s.querySelector("span"));
  const idx = spans.indexOf(target.closest("span") as HTMLElement);
  if (idx === -1) return { words: [], anchor: 0 };
  const split = (s: string) => s.match(/[\p{L}\p{N}]+/gu) ?? [];
  const before = spans.slice(Math.max(0, idx - 4), idx).flatMap((s) => split(s.textContent ?? ""));
  const own = split(spans[idx].textContent ?? "");
  const after = spans.slice(idx + 1, idx + 5).flatMap((s) => split(s.textContent ?? ""));
  // Which word inside the clicked span? Estimate from the click's horizontal position.
  const rect = spans[idx].getBoundingClientRect();
  const frac = rect.width > 0 ? Math.min(0.999, Math.max(0, (clientX - rect.left) / rect.width)) : 0;
  const ownIndex = Math.floor(frac * Math.max(1, own.length));
  const words = [...before, ...own, ...after].map((w) => w.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()).filter((w) => w.length > 1 || /\d/.test(w));
  return { words: words.slice(Math.max(0, before.length + ownIndex - 6)), anchor: Math.min(6, before.length + ownIndex) };
}

export function PdfViewer({ data, initialScale, onPageChange, onScaleChange, onDoubleClick, ref }: PdfViewerProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const scrollRefs = useRef<(HTMLDivElement | null)[]>([null, null]);
  const buffers = useRef<Buffer[] | null>(null);
  const active = useRef(0);
  const textCache = useRef<Promise<PdfPageText[]> | null>(null);
  const pending = useRef<Uint8Array | null>(null);
  const loading = useRef(false);
  const scaleValue = useRef(initialScale);
  const callbacks = useRef({ onPageChange, onScaleChange, onDoubleClick });
  useLayoutEffect(() => {
    callbacks.current = { onPageChange, onScaleChange, onDoubleClick };
  });

  const activeBuffer = () => buffers.current?.[active.current] ?? null;

  async function ensureBuffers(): Promise<Buffer[]> {
    if (buffers.current) return buffers.current;
    const { viewer: mod } = await loadPdfJs();
    if (buffers.current) return buffers.current;
    const created = scrollRefs.current.map((scroll, i) => {
      const eventBus = new mod.EventBus();
      const linkService = new mod.PDFLinkService({ eventBus, externalLinkTarget: mod.LinkTarget.BLANK });
      const viewer = new mod.PDFViewer({
        container: scroll!,
        eventBus,
        linkService,
        removePageBorders: true,
        l10n: new mod.GenericL10n(undefined),
        enableAutoLinking: true,
      });
      linkService.setViewer(viewer);
      eventBus.on("pagechanging", (e: { pageNumber: number }) => {
        if (active.current === i) callbacks.current.onPageChange?.(e.pageNumber, viewer.pagesCount);
      });
      eventBus.on("scalechanging", (e: { scale: number; presetValue?: string }) => {
        if (active.current !== i) return;
        scaleValue.current = e.presetValue ?? String(e.scale);
        callbacks.current.onScaleChange?.(e.scale, scaleValue.current);
      });
      return { scroll: scroll!, eventBus, linkService, viewer, doc: null } as Buffer;
    });
    buffers.current = created;
    return created;
  }

  async function load(bytes: Uint8Array) {
    const { pdfjs } = await loadPdfJs();
    const bufs = await ensureBuffers();
    let doc: PDFDocumentProxy;
    try {
      doc = await pdfjs.getDocument({
        data: bytes.slice(),
        cMapUrl: "/pdfjs/cmaps/",
        cMapPacked: true,
        standardFontDataUrl: "/pdfjs/standard_fonts/",
        wasmUrl: "/pdfjs/wasm/",
      }).promise;
    } catch (err) {
      console.error("PDF load failed", err);
      return;
    }

    const from = bufs[active.current];
    const to = bufs[1 - active.current];
    const firstLoad = !from.doc;
    const keepTop = from.scroll.scrollTop;
    const keepLeft = from.scroll.scrollLeft;
    const scale = firstLoad ? scaleValue.current : from.viewer.currentScaleValue || scaleValue.current;

    await new Promise<void>((resolve) => {
      const onInit = () => {
        to.eventBus.off("pagesinit", onInit);
        to.viewer.currentScaleValue = scale;
        to.scroll.scrollTop = keepTop;
        to.scroll.scrollLeft = keepLeft;
        resolve();
      };
      to.eventBus.on("pagesinit", onInit);
      to.viewer.setDocument(doc);
      to.linkService.setDocument(doc, null);
    });

    // Wait briefly for the visible pages to paint so the swap doesn't flash.
    await new Promise<void>((resolve) => {
      let rendered = 0;
      const done = () => {
        to.eventBus.off("pagerendered", onRendered);
        clearTimeout(timer);
        resolve();
      };
      const onRendered = () => {
        if (++rendered >= Math.min(2, doc.numPages)) done();
      };
      const timer = setTimeout(done, 600);
      to.eventBus.on("pagerendered", onRendered);
    });

    to.scroll.style.visibility = "visible";
    to.scroll.style.zIndex = "1";
    from.scroll.style.visibility = "hidden";
    from.scroll.style.zIndex = "0";
    active.current = 1 - active.current;

    const old = from.doc;
    from.viewer.setDocument(null as unknown as PDFDocumentProxy);
    from.linkService.setDocument(null, null);
    from.doc = null;
    to.doc = doc;
    void old?.loadingTask.destroy();
    textCache.current = null;
    callbacks.current.onPageChange?.(to.viewer.currentPageNumber, doc.numPages);
    callbacks.current.onScaleChange?.(to.viewer.currentScale, scaleValue.current);
  }

  // Serialise loads; when several PDFs arrive quickly only the newest is shown.
  useEffect(() => {
    if (!data) return;
    pending.current = data;
    if (loading.current) return;
    loading.current = true;
    void (async () => {
      while (pending.current) {
        const next = pending.current;
        pending.current = null;
        await load(next);
      }
      loading.current = false;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Refit "page-width"/"page-fit" when the pane is resized.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        for (const b of buffers.current ?? []) {
          if (b.doc && AUTO_SCALES.has(scaleValue.current)) b.viewer.currentScaleValue = scaleValue.current;
        }
      });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  // Ctrl/Cmd + wheel zooms around the pointer instead of zooming the page.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const b = activeBuffer();
      if (!b?.doc) return;
      const factor = Math.exp(-e.deltaY / (e.deltaMode === 1 ? 20 : 300));
      b.viewer.updateScale({ scaleFactor: factor, origin: [e.clientX, e.clientY] });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    return () => {
      for (const b of buffers.current ?? []) void b.doc?.loadingTask.destroy();
    };
  }, []);

  const onDblClick = (e: React.MouseEvent) => {
    const b = activeBuffer();
    if (!b?.doc) return;
    const target = e.target as HTMLElement;
    const pageEl = target.closest<HTMLElement>(".page");
    const pageNumber = Number(pageEl?.dataset.pageNumber);
    if (!pageEl || !pageNumber) return;
    const view = b.viewer.getPageView(pageNumber - 1);
    const rect = pageEl.getBoundingClientRect();
    const [px, py] = view.viewport.convertToPdfPoint(e.clientX - rect.left, e.clientY - rect.top) as [number, number];
    const viewBox = view.viewport.viewBox as number[];
    const { words, anchor } = wordsAround(target, e.clientX);
    callbacks.current.onDoubleClick?.({ page: pageNumber, x: px - viewBox[0], y: viewBox[3] - py, words, anchor });
  };

  useImperativeHandle(ref, () => ({
    zoomIn() {
      activeBuffer()?.viewer.increaseScale();
    },
    zoomOut() {
      activeBuffer()?.viewer.decreaseScale();
    },
    setScale(value: string) {
      scaleValue.current = value;
      const b = activeBuffer();
      if (b?.doc) b.viewer.currentScaleValue = value;
    },
    goToPage(page: number) {
      const b = activeBuffer();
      if (b?.doc && page >= 1 && page <= b.viewer.pagesCount) b.viewer.currentPageNumber = page;
    },
    currentPage() {
      return activeBuffer()?.viewer.currentPageNumber ?? 1;
    },
    pageHeights() {
      const b = activeBuffer();
      if (!b?.doc) return [];
      return Array.from({ length: b.viewer.pagesCount }, (_, i) => (b.viewer.getPageView(i).viewport.viewBox as number[])[3]);
    },
    reveal({ page, x, y, w, h }) {
      const b = activeBuffer();
      if (!b?.doc || page < 1 || page > b.viewer.pagesCount) return;
      const view = b.viewer.getPageView(page - 1);
      const vb = view.viewport.viewBox as number[];
      const [x1, y1] = view.viewport.convertToViewportPoint(vb[0] + x, vb[3] - y) as [number, number];
      const [x2, y2] = view.viewport.convertToViewportPoint(vb[0] + x + w, vb[3] - (y + h)) as [number, number];
      const left = Math.min(x1, x2);
      const top = Math.min(y1, y2);
      const pageRect = (view.div as HTMLElement).getBoundingClientRect();
      const scrollRect = b.scroll.getBoundingClientRect();
      b.scroll.scrollTo({
        top: b.scroll.scrollTop + (pageRect.top - scrollRect.top) + top - b.scroll.clientHeight * 0.3,
        left: Math.max(0, b.scroll.scrollLeft + (pageRect.left - scrollRect.left) + left - 40),
        behavior: "smooth",
      });
      const marker = document.createElement("div");
      marker.className = "pdf-sync-marker";
      Object.assign(marker.style, {
        left: `${left - 3}px`,
        top: `${top - 2}px`,
        width: `${Math.abs(x2 - x1) + 6}px`,
        height: `${Math.abs(y2 - y1) + 4}px`,
      });
      (view.div as HTMLElement).appendChild(marker);
      setTimeout(() => marker.remove(), 2400);
    },
    getText() {
      const b = activeBuffer();
      const doc = b?.doc;
      if (!doc) return Promise.resolve([]);
      textCache.current ??= (async () => {
        const pages: PdfPageText[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const content = await page.getTextContent();
          pages.push({
            items: content.items
              .filter((it): it is Extract<typeof it, { str: string }> => "str" in it)
              .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height })),
          });
        }
        return pages;
      })();
      return textCache.current;
    },
  }));

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-pdf" onDoubleClick={onDblClick}>
      {[0, 1].map((i) => (
        <div
          key={i}
          ref={(el) => {
            scrollRefs.current[i] = el;
          }}
          className="pdf-scroll"
          style={{ visibility: i === 0 ? "visible" : "hidden", zIndex: i === 0 ? 1 : 0 }}
        >
          <div className="pdfViewer" />
        </div>
      ))}
    </div>
  );
}
