import { gunzipSync } from "fflate";

/** Rectangle in PDF points measured from the page's top-left corner. */
export interface TopLeftRect {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Box {
  tag: number;
  line: number;
  h: number;
  v: number;
  W: number;
  H: number;
  D: number;
  /** Index of the enclosing box, -1 at page level. */
  parent: number;
  hbox: boolean;
}

interface Mark {
  tag: number;
  line: number;
  h: number;
  v: number;
  parent: number;
}

interface Page {
  boxes: Box[];
  marks: Mark[];
}

const SP_PER_BP = 65781.76;
const RECORD = /^([[(vhxkg$])(\d+),(\d+)(?:,-?\d+)?:(-?\d+),(-?\d+)(?::(-?\d+)(?:,(-?\d+),(-?\d+))?)?/;

export class SyncTex {
  private inputs = new Map<number, string>();
  private pages = new Map<number, Page>();
  private unit = 1;
  private mag = 1000;
  private xOffset = 0;
  private yOffset = 0;

  static fromGzip(gz: Uint8Array): SyncTex | null {
    try {
      return new SyncTex(new TextDecoder().decode(gunzipSync(gz)));
    } catch {
      return null;
    }
  }

  constructor(text: string) {
    let page: Page | null = null;
    const stack: number[] = [];
    for (const line of text.split("\n")) {
      if (!line) continue;
      const c = line[0];
      if (c === "{") {
        page = { boxes: [], marks: [] };
        this.pages.set(Number(line.slice(1)), page);
        stack.length = 0;
        continue;
      }
      if (c === "}") {
        page = null;
        continue;
      }
      if (!page) {
        if (line.startsWith("Input:")) {
          const rest = line.slice(6);
          const i = rest.indexOf(":");
          this.inputs.set(Number(rest.slice(0, i)), rest.slice(i + 1));
        } else if (line.startsWith("Unit:")) this.unit = Number(line.slice(5)) || 1;
        else if (line.startsWith("Magnification:")) this.mag = Number(line.slice(14)) || 1000;
        else if (line.startsWith("X Offset:")) this.xOffset = Number(line.slice(9)) || 0;
        else if (line.startsWith("Y Offset:")) this.yOffset = Number(line.slice(9)) || 0;
        continue;
      }
      if (c === "]" || c === ")") {
        stack.pop();
        continue;
      }
      const m = line.match(RECORD);
      if (!m) continue;
      const parent = stack.length ? stack[stack.length - 1] : -1;
      const [, kind, tag, ln, h, v, W, H, D] = m;
      if (kind === "[" || kind === "(" || kind === "v" || kind === "h") {
        page.boxes.push({
          tag: Number(tag),
          line: Number(ln),
          h: Number(h),
          v: Number(v),
          W: Number(W ?? 0),
          H: Number(H ?? 0),
          D: Number(D ?? 0),
          parent,
          hbox: kind === "(" || kind === "h",
        });
        if (kind === "[" || kind === "(") stack.push(page.boxes.length - 1);
      } else {
        page.marks.push({ tag: Number(tag), line: Number(ln), h: Number(h), v: Number(v), parent });
      }
    }
  }

  private bp(sp: number): number {
    return (sp * this.unit * (this.mag / 1000)) / SP_PER_BP;
  }

  private x(sp: number) {
    return this.bp(sp) + this.xOffset / SP_PER_BP;
  }

  private y(sp: number) {
    return this.bp(sp) + this.yOffset / SP_PER_BP;
  }

  /** Tags of SyncTeX inputs that correspond to `file` (a project-relative path). */
  private tagsFor(file: string): number[] {
    const tags: number[] = [];
    for (const [tag, p] of this.inputs) {
      const clean = p.replace(/^\.\//, "");
      if (clean === file || clean.endsWith(`/${file}`) || clean === `${file}.tex` || clean.endsWith(`/${file}.tex`)) tags.push(tag);
    }
    return tags;
  }

  /** Maps a SyncTeX input to one of the project's paths. */
  private projectPath(tag: number, projectFiles: string[]): string | null {
    const p = this.inputs.get(tag);
    if (!p) return null;
    const clean = p.replace(/^\.\//, "").replace(/\/\.\//g, "/");
    let best: string | null = null;
    for (const f of projectFiles) {
      if ((clean === f || clean.endsWith(`/${f}`)) && (!best || f.length > best.length)) best = f;
    }
    return best;
  }

  /** Source line -> PDF rectangles (top-left origin, points). */
  forward(file: string, line: number): TopLeftRect | null {
    const tags = new Set(this.tagsFor(file));
    if (tags.size === 0) return null;

    // Find the closest line at or after the requested one that produced output.
    let bestLine = Infinity;
    for (const page of this.pages.values()) {
      for (const r of [...page.marks, ...page.boxes]) {
        if (tags.has(r.tag) && r.line >= line && r.line < bestLine) bestLine = r.line;
      }
    }
    if (bestLine === Infinity) {
      bestLine = -Infinity;
      for (const page of this.pages.values()) {
        for (const r of page.marks) if (tags.has(r.tag) && r.line > bestLine) bestLine = r.line;
      }
      if (bestLine === -Infinity) return null;
    }

    const pageNumbers = [...this.pages.keys()].sort((a, b) => a - b);
    for (const n of pageNumbers) {
      const page = this.pages.get(n)!;
      const marks = page.marks.filter((r) => tags.has(r.tag) && r.line === bestLine);
      const boxes = page.boxes.filter((b) => b.hbox && tags.has(b.tag) && b.line === bestLine);
      if (marks.length === 0 && boxes.length === 0) continue;
      // Use the enclosing line boxes of the marks: they carry the line height.
      const rects: { x: number; y: number; w: number; h: number }[] = [];
      const seen = new Set<number>();
      for (const m of marks) {
        let p = m.parent;
        while (p !== -1 && !page.boxes[p].hbox) p = page.boxes[p].parent;
        if (p !== -1 && !seen.has(p)) {
          seen.add(p);
          const b = page.boxes[p];
          rects.push({ x: this.x(b.h), y: this.y(b.v - b.H), w: this.bp(b.W), h: this.bp(b.H + b.D) });
        } else if (p === -1) {
          rects.push({ x: this.x(m.h), y: this.y(m.v) - 10, w: 40, h: 12 });
        }
      }
      for (const b of boxes) rects.push({ x: this.x(b.h), y: this.y(b.v - b.H), w: this.bp(b.W), h: this.bp(b.H + b.D) });
      const first = rects.slice(0, 6);
      const x = Math.min(...first.map((r) => r.x));
      const y = Math.min(...first.map((r) => r.y));
      const x2 = Math.max(...first.map((r) => r.x + r.w));
      const y2 = Math.max(...first.map((r) => r.y + r.h));
      return { page: n, x, y, w: Math.max(8, x2 - x), h: Math.max(8, y2 - y) };
    }
    return null;
  }

  /** PDF point (top-left origin, points) -> source location. */
  inverse(pageNumber: number, x: number, y: number, projectFiles: string[]): { path: string; line: number } | null {
    const page = this.pages.get(pageNumber);
    if (!page) return null;

    // Smallest hbox containing the point.
    let boxIndex = -1;
    let boxArea = Infinity;
    page.boxes.forEach((b, i) => {
      if (!b.hbox) return;
      const bx = this.x(b.h);
      const by = this.y(b.v - b.H);
      const bw = this.bp(b.W);
      const bh = this.bp(b.H + b.D);
      if (x >= bx && x <= bx + bw && y >= by && y <= by + bh) {
        const area = Math.max(bw, 0.1) * Math.max(bh, 0.1);
        if (area < boxArea) {
          boxArea = area;
          boxIndex = i;
        }
      }
    });

    const inBox = (m: Mark) => {
      for (let p = m.parent; p !== -1; p = page.boxes[p].parent) if (p === boxIndex) return true;
      return false;
    };
    const candidates = boxIndex === -1 ? page.marks : page.marks.filter(inBox);
    let best: Mark | Box | null = null;
    let bestDist = Infinity;
    for (const m of candidates) {
      if (!this.projectPath(m.tag, projectFiles)) continue;
      const dx = this.x(m.h) - x;
      const dy = (this.y(m.v) - y) * (boxIndex === -1 ? 1 : 0.2);
      const d = dx * dx + dy * dy;
      // Prefer marks to the left of the click on the same line (the word being clicked).
      const penalty = dx > 0 ? 1.5 : 1;
      if (d * penalty < bestDist) {
        bestDist = d * penalty;
        best = m;
      }
    }
    if (!best && boxIndex !== -1) best = page.boxes[boxIndex];
    if (!best) return null;
    const path = this.projectPath(best.tag, projectFiles);
    return path ? { path, line: best.line } : null;
  }
}
