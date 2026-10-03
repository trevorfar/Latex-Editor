"use client";

import { strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import type { FileKind, ProjectFile } from "./types";
import { basename, isTexPath, kindForPath, normalizePath } from "./paths";

export interface ImportedFile {
  path: string;
  kind: FileKind;
  content?: string;
  data?: Blob;
}

export async function projectToZip(files: ProjectFile[]): Promise<Blob> {
  const entries: Zippable = {};
  for (const f of files) {
    entries[f.path] =
      f.kind === "text" ? strToU8(f.content ?? "") : new Uint8Array(await (f.data ?? new Blob()).arrayBuffer());
  }
  const zipped = zipSync(entries, { level: 6 });
  return new Blob([zipped as BlobPart], { type: "application/zip" });
}

const IGNORED = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|\.git)(\/|$)/;

export function filesFromZip(bytes: Uint8Array): ImportedFile[] {
  const raw = unzipSync(bytes);
  const entries = Object.entries(raw).filter(([name]) => !name.endsWith("/") && !IGNORED.test(name));

  // Zips of a folder wrap everything in one top-level directory; drop it.
  const firstSegments = new Set(entries.map(([name]) => name.split("/")[0]));
  const strip = firstSegments.size === 1 && entries.every(([name]) => name.includes("/"));

  const decoder = new TextDecoder("utf-8");
  const out: ImportedFile[] = [];
  for (const [name, data] of entries) {
    const path = normalizePath(strip ? name.slice(name.indexOf("/") + 1) : name);
    if (!path) continue;
    const kind = kindForPath(path);
    if (kind === "text") out.push({ path, kind, content: decoder.decode(data) });
    else out.push({ path, kind, data: new Blob([data as BlobPart]) });
  }
  return out;
}

/** Picks the root document: a .tex file with \documentclass, preferring main.tex and shallow paths. */
export function detectMainFile(files: { path: string; content?: string }[]): string | null {
  const candidates = files.filter((f) => isTexPath(f.path) && /^[^%\n]*\\documentclass/m.test(f.content ?? ""));
  if (candidates.length === 0) {
    return files.find((f) => isTexPath(f.path))?.path ?? null;
  }
  const score = (p: string) =>
    (basename(p) === "main.tex" ? 0 : basename(p) === "thesis.tex" || basename(p) === "report.tex" ? 1 : 2) * 10 +
    p.split("/").length;
  return candidates.sort((a, b) => score(a.path) - score(b.path))[0].path;
}
