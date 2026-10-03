/**
 * Approximate source <-> PDF mapping by matching words. Used when the compile backend
 * returns no SyncTeX data (the remote service), and as a fallback when SyncTeX misses.
 */

export interface PdfTextItem {
  str: string;
  /** PDF user-space coordinates (origin bottom-left), baseline position. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PdfPageText {
  items: PdfTextItem[];
}

export interface PdfRect {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function normalizeWord(w: string): string {
  return w.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function splitWords(text: string): string[] {
  return (text.match(/[\p{L}\p{N}]+/gu) ?? []).map(normalizeWord).filter((w) => w.length > 1 || /\d/.test(w));
}

/** Prose words of a LaTeX source line: no comments, commands or inline math. */
export function sourceLineWords(line: string): string[] {
  const text = line
    .replace(/(^|[^\\])%.*$/, "$1")
    .replace(/\\(?:label|ref|eqref|cite\w*|includegraphics|input|include|usepackage|documentclass|begin|end|url|href|cref|Cref|autoref|pageref|bibliography\w*)\*?(?:\[[^\]]*\])?(?:\{[^}]*\})?/g, " ")
    .replace(/(?<!\\)\$[^$]*(?<!\\)\$/g, " ")
    .replace(/\\[a-zA-Z@]+\*?/g, " ")
    .replace(/\\./g, " ");
  return splitWords(text);
}

interface PageWord {
  word: string;
  item: number;
}

function pageWords(page: PdfPageText): PageWord[] {
  const out: PageWord[] = [];
  page.items.forEach((item, i) => {
    for (const w of splitWords(item.str)) out.push({ word: w, item: i });
  });
  return out;
}

/** Number of query words matched in order starting at `start`, allowing small gaps. */
function alignScore(hay: string[], start: number, query: string[]): number {
  let score = 0;
  let h = start;
  for (let q = 0; q < query.length && h < hay.length; q++) {
    if (hay[h] === query[q]) {
      score++;
      h++;
      continue;
    }
    // Allow one skipped word on either side (hyphenation, ligature splits, stripped markup).
    if (hay[h + 1] === query[q]) {
      score += 0.8;
      h += 2;
    } else if (q + 1 < query.length && hay[h] === query[q + 1]) {
      score += 0.8;
      q++;
      h++;
    }
  }
  return score;
}

/**
 * Finds where a source line most likely appears in the PDF.
 * `hintPage` breaks ties toward the page the user is looking at.
 */
export function findInPdf(pages: PdfPageText[], query: string[], hintPage = 1): PdfRect | null {
  if (query.length === 0) return null;
  const q = query.slice(0, 12);
  let best: { score: number; page: number; item: number; dist: number } | null = null;
  pages.forEach((page, p) => {
    const words = pageWords(page);
    const hay = words.map((w) => w.word);
    for (let i = 0; i < hay.length; i++) {
      if (hay[i] !== q[0] && hay[i] !== q[1]) continue;
      const score = alignScore(hay, i, hay[i] === q[0] ? q : q.slice(1));
      const dist = Math.abs(p + 1 - hintPage);
      if (!best || score > best.score || (score === best.score && dist < best.dist)) {
        best = { score, page: p + 1, item: words[i].item, dist };
      }
    }
  });
  const found = best as { score: number; page: number; item: number } | null;
  if (!found || found.score < Math.min(2, q.length)) return null;
  const item = pages[found.page - 1].items[found.item];
  return { page: found.page, x: item.x, y: item.y, w: Math.max(item.w, 20), h: Math.max(item.h, 8) };
}

export interface SourceHit {
  path: string;
  line: number;
}

/**
 * Finds the source line for words clicked in the PDF.
 * `context` are the words around the click and `anchor` the index of the clicked word within them.
 */
export function findInSource(files: { path: string; text: string }[], context: string[], anchor: number): SourceHit | null {
  if (context.length === 0) return null;
  let best: { score: number; hit: SourceHit } | null = null;
  for (const file of files) {
    const lines = file.text.split("\n");
    const words: string[] = [];
    const lineOf: number[] = [];
    lines.forEach((l, i) => {
      for (const w of sourceLineWords(l)) {
        words.push(w);
        lineOf.push(i + 1);
      }
    });
    // Try a few starting offsets so one unmatched leading word (e.g. hyphenated) doesn't sink the match.
    for (let o = 0; o < Math.min(3, context.length); o++) {
      const sub = context.slice(o);
      for (let i = 0; i < words.length; i++) {
        if (words[i] !== sub[0]) continue;
        const score = alignScore(words, i, sub);
        if (!best || score > best.score) {
          const target = Math.max(0, Math.min(words.length - 1, i + anchor - o));
          best = { score, hit: { path: file.path, line: lineOf[target] } };
        }
      }
    }
  }
  const found = best as { score: number; hit: SourceHit } | null;
  return found && found.score >= Math.min(3, context.length) ? found.hit : null;
}
