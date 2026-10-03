"use client";

import type { CompileRequestMeta, CompileResponseHeader } from "./types";

export interface CompileOutput {
  header: CompileResponseHeader;
  pdf: Uint8Array | null;
  synctex: Uint8Array | null;
}

export async function requestCompile(
  meta: Omit<CompileRequestMeta, "paths">,
  files: { path: string; blob: Blob }[],
  signal?: AbortSignal,
): Promise<CompileOutput> {
  const form = new FormData();
  form.set("meta", JSON.stringify({ ...meta, paths: files.map((f) => f.path) } satisfies CompileRequestMeta));
  files.forEach((f, i) => form.set(`file:${i}`, f.blob, "file"));

  const res = await fetch("/api/compile", { method: "POST", body: form, signal });
  if (!res.ok) {
    let message = `Compile request failed (HTTP ${res.status}).`;
    try {
      message = (await res.json()).error ?? message;
    } catch {
      if (res.status === 413) message = "The project is too large to send to the compiler.";
    }
    throw new Error(message);
  }

  const buf = new Uint8Array(await res.arrayBuffer());
  const headerLength = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(0);
  const header = JSON.parse(new TextDecoder().decode(buf.subarray(4, 4 + headerLength))) as CompileResponseHeader;
  const pdfStart = 4 + headerLength;
  const pdf = header.pdfSize ? buf.slice(pdfStart, pdfStart + header.pdfSize) : null;
  const synctexStart = pdfStart + header.pdfSize;
  const synctex = header.synctexSize ? buf.slice(synctexStart, synctexStart + header.synctexSize) : null;
  return { header, pdf, synctex };
}
