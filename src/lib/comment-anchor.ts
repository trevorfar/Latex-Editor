import type { CommentRect } from "./cloud-types";
import type { PdfPageText } from "./text-sync";

/** A page's viewBox: [x0, y0, x1, y1] in PDF user space. */
export type ViewBox = number[];

const strip = (s: string) => s.replace(/[\s­]+/g, "");

interface CharRef {
  item: number;
  index: number;
}

/** Whitespace-free text of a page plus where each character came from. */
function pageChars(page: PdfPageText): { text: string; refs: CharRef[] } {
  let text = "";
  const refs: CharRef[] = [];
  page.items.forEach((item, i) => {
    for (let j = 0; j < item.str.length; j++) {
      const ch = item.str[j];
      if (/[\s­]/.test(ch)) continue;
      text += ch;
      refs.push({ item: i, index: j });
    }
  });
  return { text, refs };
}

/** Rectangles (top-left origin) covering chars [from, to) of a page. Adjacent pieces on one line are merged. */
function rectsFor(page: PdfPageText, pageNumber: number, vb: ViewBox, refs: CharRef[], from: number, to: number): CommentRect[] {
  const spans = new Map<number, { lo: number; hi: number }>();
  for (let k = from; k < to; k++) {
    const { item, index } = refs[k];
    const s = spans.get(item);
    if (s) s.hi = Math.max(s.hi, index);
    else spans.set(item, { lo: index, hi: index });
  }
  const out: CommentRect[] = [];
  for (const [i, { lo, hi }] of [...spans].sort((a, b) => a[0] - b[0])) {
    const it = page.items[i];
    const len = Math.max(1, it.str.length);
    const h = Math.max(it.h, 4);
    const rect: CommentRect = {
      page: pageNumber,
      x: it.x - vb[0] + (it.w * lo) / len,
      y: vb[3] - it.y - h * 0.82,
      w: Math.max(2, (it.w * (hi - lo + 1)) / len),
      h: h * 1.08,
    };
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.y - rect.y) < h * 0.3 && rect.x - (prev.x + prev.w) < h && rect.x >= prev.x) {
      prev.w = rect.x + rect.w - prev.x;
      prev.h = Math.max(prev.h, rect.h);
    } else out.push(rect);
  }
  return out;
}

/**
 * Finds the highlighted quote in the current PDF, preferring the occurrence closest to where it was
 * when the comment was made. Returns null when the text no longer exists (it was edited away).
 */
export function locateQuote(pages: PdfPageText[], boxes: ViewBox[], quote: string, hint: CommentRect[]): CommentRect[] | null {
  const needle = strip(quote);
  if (!needle || pages.length === 0) return null;
  const hintPage = Math.min(pages.length, Math.max(1, hint[0]?.page ?? 1));
  const hintY = hint[0]?.y ?? 0;
  let best: { score: number; page: number; at: number; refs: CharRef[] } | null = null;
  for (let p = 1; p <= pages.length; p++) {
    const dist = Math.abs(p - hintPage);
    if (best && dist * 10_000 > best.score) continue;
    const { text, refs } = pageChars(pages[p - 1]);
    for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
      const item = pages[p - 1].items[refs[at].item];
      const y = (boxes[p - 1]?.[3] ?? 0) - item.y;
      const score = dist * 10_000 + Math.abs(y - hintY);
      if (!best || score < best.score) best = { score, page: p, at, refs };
    }
  }
  if (!best) return null;
  return rectsFor(pages[best.page - 1], best.page, boxes[best.page - 1] ?? [0, 0, 612, 792], best.refs, best.at, best.at + needle.length);
}
