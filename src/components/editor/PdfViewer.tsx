"use client";

import { useEffect, useImperativeHandle, useLayoutEffect, useRef, type Ref } from "react";
import "pdfjs-dist/web/pdf_viewer.css";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { EventBus, PDFLinkService, PDFViewer as PDFViewerType } from "pdfjs-dist/web/pdf_viewer.mjs";
import type { PdfPageText } from "@/lib/text-sync";
import type { CommentRect } from "@/lib/cloud-types";
import { locateQuote, type ViewBox } from "@/lib/comment-anchor";

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

/** A comment highlight to draw. The quote is searched for again in each new PDF. */
export interface PdfHighlight {
  id: string;
  quote: string;
  rects: CommentRect[];
  tone: "open" | "active" | "draft";
  /** Draw `rects` as given instead of searching for the quote. */
  fixed?: boolean;
}

/** Where each highlight ended up in the current PDF; `found` is false when its text has gone. */
export type HighlightPositions = Record<string, { rects: CommentRect[]; found: boolean }>;

/** Text the user selected in the PDF. */
export interface PdfSelection {
  quote: string;
  rects: CommentRect[];
  /** Bottom-right of the selection, relative to the viewer, for placing a button. */
  anchor: { x: number; y: number };
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
  /** Scrolls to a highlight and flashes it. */
  revealHighlight(id: string): void;
  clearSelection(): void;
}

export interface PdfViewerProps {
  data: Uint8Array | null;
  initialScale: string;
  onPageChange?: (page: number, total: number) => void;
  onScaleChange?: (scale: number, value: string) => void;
  onDoubleClick?: (click: PdfClick) => void;
  highlights?: PdfHighlight[];
  onHighlightClick?: (id: string) => void;
  onHighlightsLocated?: (positions: HighlightPositions) => void;
  onSelectText?: (selection: PdfSelection | null) => void;
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

const NO_HIGHLIGHTS: PdfHighlight[] = [];

function viewBoxes(viewer: PDFViewerType): ViewBox[] {
  return Array.from({ length: viewer.pagesCount }, (_, i) => viewer.getPageView(i)?.viewport.viewBox as ViewBox);
}

export function PdfViewer({
  data,
  initialScale,
  onPageChange,
  onScaleChange,
  onDoubleClick,
  highlights = NO_HIGHLIGHTS,
  onHighlightClick,
  onHighlightsLocated,
  onSelectText,
  ref,
}: PdfViewerProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const scrollRefs = useRef<(HTMLDivElement | null)[]>([null, null]);
  const buffers = useRef<Buffer[] | null>(null);
  const active = useRef(0);
  const textCache = useRef(new WeakMap<PDFDocumentProxy, Promise<PdfPageText[]>>());
  const highlightsRef = useRef(highlights);
  /** Highlights resolved against the current PDF. */
  const placed = useRef<{ id: string; tone: PdfHighlight["tone"]; rects: CommentRect[] }[]>([]);
  const locateRun = useRef(0);
  const pending = useRef<Uint8Array | null>(null);
  const loading = useRef(false);
  const scaleValue = useRef(initialScale);
  const callbacks = useRef({ onPageChange, onScaleChange, onDoubleClick, onHighlightClick, onHighlightsLocated, onSelectText });
  useLayoutEffect(() => {
    callbacks.current = { onPageChange, onScaleChange, onDoubleClick, onHighlightClick, onHighlightsLocated, onSelectText };
  });

  function textOf(doc: PDFDocumentProxy): Promise<PdfPageText[]> {
    let text = textCache.current.get(doc);
    if (!text) {
      text = (async () => {
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
      textCache.current.set(doc, text);
    }
    return text;
  }

  /** Draws the highlights into one page. pdf.js clears page children on re-render, so this runs after each render. */
  function paintPage(b: Buffer, index: number) {
    const view = b.viewer.getPageView(index);
    const div = view?.div as HTMLElement | undefined;
    if (!div) return;
    let layer = div.querySelector<HTMLElement>(":scope > .cmt-layer");
    const mine = placed.current.flatMap((h) => h.rects.filter((r) => r.page === index + 1).map((r) => ({ h, r })));
    if (!mine.length) return layer?.remove();
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "cmt-layer";
      div.appendChild(layer);
    }
    const vb = view.viewport.viewBox as ViewBox;
    const W = vb[2] - vb[0] || 1;
    const H = vb[3] - vb[1] || 1;
    layer.replaceChildren(
      ...mine.map(({ h, r }) => {
        const el = document.createElement("div");
        el.className = `cmt-hl cmt-hl-${h.tone}`;
        el.style.left = `${(r.x / W) * 100}%`;
        el.style.top = `${(r.y / H) * 100}%`;
        el.style.width = `${(r.w / W) * 100}%`;
        el.style.height = `${(r.h / H) * 100}%`;
        return el;
      }),
    );
  }

  function paintAll(b: Buffer) {
    if (!b.doc) return;
    for (let i = 0; i < b.viewer.pagesCount; i++) paintPage(b, i);
  }

  /** Finds every highlight's quote in the buffer's PDF, then repaints. */
  async function locate(b: Buffer) {
    const doc = b.doc;
    const list = highlightsRef.current;
    const run = ++locateRun.current;
    if (!doc) return;
    const needsText = list.some((h) => !h.fixed);
    const pages = needsText ? await textOf(doc) : [];
    if (run !== locateRun.current || b.doc !== doc) return;
    const boxes = viewBoxes(b.viewer);
    const positions: HighlightPositions = {};
    placed.current = list.map((h) => {
      const found = h.fixed ? h.rects : locateQuote(pages, boxes, h.quote, h.rects);
      positions[h.id] = { rects: found ?? h.rects, found: Boolean(found) };
      return { id: h.id, tone: h.tone, rects: found ?? h.rects };
    });
    paintAll(b);
    callbacks.current.onHighlightsLocated?.(positions);
  }

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
      eventBus.on("pagerendered", (e: { pageNumber: number }) => {
        const b = buffers.current?.[i];
        if (b) paintPage(b, e.pageNumber - 1);
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
    to.doc = doc;
    await locate(to);

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
    void old?.loadingTask.destroy();
    // Any selection was in the old copy of the PDF.
    callbacks.current.onSelectText?.(null);
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

  // Re-place highlights whenever the list changes.
  useEffect(() => {
    highlightsRef.current = highlights;
    const b = buffers.current?.[active.current];
    if (b?.doc) void locate(b);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlights]);

  /** Converts a viewport point inside a page element to top-left PDF points. */
  function toPdf(b: Buffer, pageNumber: number, pageEl: HTMLElement, clientX: number, clientY: number): [number, number] {
    const view = b.viewer.getPageView(pageNumber - 1);
    const rect = pageEl.getBoundingClientRect();
    const [px, py] = view.viewport.convertToPdfPoint(clientX - rect.left, clientY - rect.top) as [number, number];
    const vb = view.viewport.viewBox as ViewBox;
    return [px - vb[0], vb[3] - py];
  }

  function readSelection(): PdfSelection | null {
    const b = activeBuffer();
    const wrap = wrapRef.current;
    const sel = window.getSelection();
    if (!b?.doc || !wrap || !sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    if (!b.scroll.contains(range.commonAncestorContainer)) return null;
    const quote = sel.toString().replace(/\s+/g, " ").trim();
    if (!quote) return null;
    const pages = [...b.scroll.querySelectorAll<HTMLElement>(".page")].map((el) => ({ el, box: el.getBoundingClientRect(), n: Number(el.dataset.pageNumber) }));
    const client = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
    // Drop pdf.js's oversized end-of-content helper and other outliers.
    const heights = client.map((r) => r.height).sort((a, b) => a - b);
    const median = heights[Math.floor(heights.length / 2)] ?? 0;
    const rects: CommentRect[] = [];
    let last: DOMRect | null = null;
    for (const r of client) {
      if (r.height > median * 2.5) continue;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const page = pages.find((p) => cx >= p.box.left && cx <= p.box.right && cy >= p.box.top && cy <= p.box.bottom);
      if (!page?.n) continue;
      const [x1, y1] = toPdf(b, page.n, page.el, r.left, r.top);
      const [x2, y2] = toPdf(b, page.n, page.el, r.right, r.bottom);
      rects.push({ page: page.n, x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) });
      last = r;
    }
    if (!rects.length || !last) return null;
    const box = wrap.getBoundingClientRect();
    return {
      quote: quote.slice(0, 1000),
      rects: rects.slice(0, 200),
      anchor: { x: Math.min(box.width - 8, Math.max(8, last.right - box.left)), y: Math.min(box.height - 8, Math.max(8, last.bottom - box.top)) },
    };
  }

  /** A plain click on a highlight selects its comment. Highlights don't take pointer events, so text stays selectable. */
  const onClick = (e: React.MouseEvent) => {
    const b = activeBuffer();
    if (!b?.doc || !placed.current.length || !window.getSelection()?.isCollapsed) return;
    const pageEl = (e.target as HTMLElement).closest<HTMLElement>(".page");
    const pageNumber = Number(pageEl?.dataset.pageNumber);
    if (!pageEl || !pageNumber) return;
    const [x, y] = toPdf(b, pageNumber, pageEl, e.clientX, e.clientY);
    let hit: { id: string; area: number } | null = null;
    for (const h of placed.current) {
      if (h.tone === "draft") continue;
      for (const r of h.rects) {
        if (r.page === pageNumber && x >= r.x - 1 && x <= r.x + r.w + 1 && y >= r.y - 1 && y <= r.y + r.h + 1 && (!hit || r.w * r.h < hit.area)) {
          hit = { id: h.id, area: r.w * r.h };
        }
      }
    }
    if (hit) callbacks.current.onHighlightClick?.(hit.id);
  };

  function revealRect({ page, x, y, w, h }: CommentRect) {
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
  }

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

  // Report text selections inside the PDF (mouse and touch), and follow them while scrolling.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let had = false;
    const report = () => {
      const sel = readSelection();
      if (sel || had) callbacks.current.onSelectText?.(sel);
      had = Boolean(sel);
    };
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(report, 180);
    };
    const onScroll = () => had && report();
    document.addEventListener("selectionchange", later);
    wrap.addEventListener("scroll", onScroll, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", later);
      wrap.removeEventListener("scroll", onScroll, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    reveal(rect) {
      revealRect(rect);
    },
    revealHighlight(id: string) {
      const rects = placed.current.find((h) => h.id === id)?.rects;
      if (!rects?.length) return;
      const same = rects.filter((r) => r.page === rects[0].page);
      const x = Math.min(...same.map((r) => r.x));
      const y = Math.min(...same.map((r) => r.y));
      const right = Math.max(...same.map((r) => r.x + r.w));
      const bottom = Math.max(...same.map((r) => r.y + r.h));
      revealRect({ page: rects[0].page, x, y, w: right - x, h: bottom - y });
    },
    clearSelection() {
      window.getSelection()?.removeAllRanges();
    },
    getText() {
      const doc = activeBuffer()?.doc;
      return doc ? textOf(doc) : Promise.resolve([]);
    },
  }));

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-pdf" onDoubleClick={onDblClick} onClick={onClick}>
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
