"use client";

import { useEffect, useRef } from "react";
import { Download, FileQuestion } from "lucide-react";
import type { ProjectFile } from "@/lib/types";
import { basename, extname, formatBytes, isImagePath, mimeForPath } from "@/lib/paths";

export function BinaryPreview({ file }: { file: ProjectFile }) {
  const ext = extname(file.path);
  const isPdf = ext === "pdf";
  const previewable = isImagePath(file.path) || isPdf;
  const mediaRef = useRef<HTMLImageElement & HTMLIFrameElement>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);

  // Object URLs are created and revoked alongside the element that shows them.
  useEffect(() => {
    if (!file.data) return;
    const u = URL.createObjectURL(new Blob([file.data], { type: mimeForPath(file.path) }));
    if (mediaRef.current) mediaRef.current.src = u;
    if (linkRef.current) linkRef.current.href = u;
    return () => URL.revokeObjectURL(u);
  }, [file]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-subtle">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-bg px-3 text-[13px]">
        <span className="min-w-0 flex-1 truncate font-medium">{file.path}</span>
        <span className="text-fg-faint">{formatBytes(file.size)}</span>
        <a
          ref={linkRef}
          download={basename(file.path)}
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-fg-muted hover:bg-muted hover:text-fg"
        >
          <Download size={14} /> Download
        </a>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
        {previewable && isPdf ? (
          <iframe ref={mediaRef} title={file.path} className="h-full w-full rounded-md border border-line bg-white" />
        ) : previewable ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={mediaRef}
            alt={file.path}
            className="max-h-full max-w-full rounded-md border border-line shadow-pop"
            style={{ background: "repeating-conic-gradient(#0000000d 0% 25%, transparent 0% 50%) 50% / 16px 16px" }}
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-center text-fg-muted">
            <FileQuestion size={36} className="text-fg-faint" />
            <p className="text-[13px]">This file can&apos;t be previewed.</p>
            <p className="text-[12px] text-fg-faint">It&apos;s still sent to the compiler, so \input or \includegraphics can use it.</p>
          </div>
        )}
      </div>
    </div>
  );
}
