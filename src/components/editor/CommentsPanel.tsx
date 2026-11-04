"use client";

import { useEffect, useRef, useState } from "react";
import { Check, CodeXml, Loader2, MessageSquarePlus, RotateCcw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useDialogs } from "@/components/ui/dialogs";
import type { CloudComment, CommentRect } from "@/lib/cloud-types";
import type { CommentsState } from "./useCloudComments";
import type { HighlightPositions } from "./PdfViewer";

export interface CommentDraft {
  quote: string;
  rects: CommentRect[];
}

interface CommentsPanelProps {
  comments: CommentsState;
  positions: HighlightPositions;
  draft: CommentDraft | null;
  onDraftDone: () => void;
  activeId: string | null;
  onActivate: (id: string | null) => void;
  onShowSource: (comment: CloudComment) => void;
  onClose: () => void;
}

const COLORS = ["#2c67d1", "#12825a", "#b45309", "#9333ea", "#c93838", "#0e7490", "#be185d", "#4d7c0f"];

function Avatar({ name }: { name: string }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
      style={{ background: COLORS[h % COLORS.length] }}
      aria-hidden
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

function ago(t: number): string {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Plain textarea that submits on Ctrl/Cmd+Enter. */
function Composer({
  placeholder,
  submitLabel,
  autoFocus,
  onSubmit,
  onCancel,
}: {
  placeholder: string;
  submitLabel: string;
  autoFocus?: boolean;
  onSubmit: (body: string) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  const submit = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    const ok = await onSubmit(body.trim());
    setBusy(false);
    if (ok) setBody("");
  };
  return (
    <div className="flex flex-col gap-1.5" onClick={(e) => e.stopPropagation()}>
      <textarea
        ref={ref}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape" && onCancel) onCancel();
        }}
        maxLength={2000}
        rows={2}
        placeholder={placeholder}
        className="min-h-[52px] w-full resize-y rounded-md border border-line-strong bg-bg px-2 py-1.5 text-[13px] outline-none focus:border-accent"
      />
      <div className="flex justify-end gap-1.5">
        {onCancel && (
          <Button size="xs" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button size="xs" variant="primary" onClick={() => void submit()} disabled={!body.trim() || busy}>
          {busy && <Loader2 size={12} className="spin" />}
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

function Quote({ text }: { text: string }) {
  return <p className="line-clamp-2 border-l-2 border-warning pl-2 text-[12px] text-fg-muted italic">{text}</p>;
}

function CommentCard({
  comment,
  active,
  missing,
  onActivate,
  onShowSource,
  act,
}: {
  comment: CloudComment;
  active: boolean;
  missing: boolean;
  onActivate: () => void;
  onShowSource: () => void;
  act: CommentsState["act"];
}) {
  const dialogs = useDialogs();
  const ref = useRef<HTMLDivElement>(null);
  const open = comment.status === "open";
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active]);

  const remove = async () => {
    const ok = await dialogs.confirm({
      title: "Delete comment?",
      message: "This removes the comment and its replies for everyone.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok) await act({ action: "delete", id: comment.id });
  };

  return (
    <div
      ref={ref}
      onClick={onActivate}
      className={`cursor-pointer rounded-lg border bg-bg p-2.5 text-[13px] shadow-sm transition-colors ${
        active ? "border-warning ring-1 ring-warning/50" : "border-line hover:border-line-strong"
      } ${open ? "" : "opacity-80"}`}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <Avatar name={comment.author} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate font-medium">{comment.author}</div>
          <div className="text-[11px] text-fg-faint">{ago(comment.createdAt)}</div>
        </div>
        {open ? (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation();
                void act({ action: "status", id: comment.id, status: "accepted" });
              }}
              title="Accept (resolve)"
              aria-label="Accept comment"
              className="flex h-7 w-7 items-center justify-center rounded-md text-accent hover:bg-accent-soft"
            >
              <Check size={16} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                void act({ action: "status", id: comment.id, status: "rejected" });
              }}
              title="Reject (dismiss)"
              aria-label="Reject comment"
              className="flex h-7 w-7 items-center justify-center rounded-md text-danger hover:bg-danger-soft"
            >
              <X size={16} />
            </button>
          </>
        ) : (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation();
                void act({ action: "status", id: comment.id, status: "open" });
              }}
              title="Reopen"
              aria-label="Reopen comment"
              className="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-muted hover:text-fg"
            >
              <RotateCcw size={14} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                void remove();
              }}
              title="Delete for everyone"
              aria-label="Delete comment"
              className="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-danger-soft hover:text-danger"
            >
              <Trash2 size={14} />
            </button>
          </>
        )}
      </div>

      <Quote text={comment.quote} />
      {missing && <p className="mt-1 text-[11px] text-warning">This text has changed in the PDF. Showing where it used to be.</p>}
      <p className="mt-1.5 break-words whitespace-pre-wrap">{comment.body}</p>

      {comment.replies.length > 0 && (
        <div className="mt-2 flex flex-col gap-2 border-t border-line pt-2">
          {comment.replies.map((r) => (
            <div key={r.id} className="flex gap-2">
              <Avatar name={r.author} />
              <div className="min-w-0 flex-1">
                <div className="text-[12px]">
                  <span className="font-medium">{r.author}</span> <span className="text-[11px] text-fg-faint">{ago(r.createdAt)}</span>
                </div>
                <p className="break-words whitespace-pre-wrap">{r.body}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {!open && (
        <p className={`mt-2 flex items-center gap-1 text-[11.5px] ${comment.status === "accepted" ? "text-accent" : "text-danger"}`}>
          {comment.status === "accepted" ? <Check size={12} /> : <X size={12} />}
          {comment.status === "accepted" ? "Accepted" : "Rejected"} by {comment.resolvedBy}
          {comment.resolvedAt ? ` · ${ago(comment.resolvedAt)}` : ""}
        </p>
      )}

      {active && (
        <div className="mt-2 flex flex-col gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onShowSource();
            }}
            className="flex items-center gap-1 self-start text-[12px] text-fg-muted hover:text-accent"
          >
            <CodeXml size={13} /> Show in source
          </button>
          {open && <Composer placeholder="Reply…" submitLabel="Reply" onSubmit={(body) => act({ action: "reply", id: comment.id, body })} />}
        </div>
      )}
    </div>
  );
}

export function CommentsPanel({ comments, positions, draft, onDraftDone, activeId, onActivate, onShowSource, onClose }: CommentsPanelProps) {
  const [tab, setTab] = useState<"open" | "resolved">("open");
  const open = comments.comments.filter((c) => c.status === "open");
  const resolved = comments.comments.filter((c) => c.status !== "open");

  // Order open comments the way they appear in the document, like margin comments.
  const where = (c: CloudComment) => {
    const r = positions[c.id]?.rects[0] ?? c.rects[0];
    return r ? r.page * 100_000 + r.y : 0;
  };
  const list = tab === "open" ? [...open].sort((a, b) => where(a) - where(b)) : [...resolved].sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0));

  // Jump to the tab that holds the comment someone clicked in the PDF.
  const activeComment = comments.comments.find((c) => c.id === activeId);
  const activeTab = activeComment ? (activeComment.status === "open" ? "open" : "resolved") : null;
  const [followed, setFollowed] = useState(activeId);
  if (followed !== activeId) {
    setFollowed(activeId);
    if (activeTab) setTab(activeTab);
  }

  return (
    <div className="flex h-full w-full flex-col border-l border-line bg-panel">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line px-2">
        {(["open", "resolved"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`h-7 rounded-md px-2 text-[12.5px] ${tab === t ? "bg-muted font-medium text-fg" : "text-fg-muted hover:text-fg"}`}
          >
            {t === "open" ? `Open (${open.length})` : `Resolved (${resolved.length})`}
          </button>
        ))}
        <div className="flex-1" />
        <Button variant="ghost" size="xs" icon onClick={onClose} title="Close comments" aria-label="Close comments">
          <X size={15} />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
        {draft && (
          <div className="rounded-lg border border-info bg-bg p-2.5 shadow-sm">
            <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-info">
              <MessageSquarePlus size={14} /> New comment
            </div>
            <Quote text={draft.quote} />
            <div className="mt-2">
              <Composer
                key={draft.quote}
                autoFocus
                placeholder="Add a comment…  (Ctrl+Enter to post)"
                submitLabel="Comment"
                onCancel={onDraftDone}
                onSubmit={async (body) => {
                  const ok = await comments.act({ action: "add", quote: draft.quote, rects: draft.rects, body });
                  if (ok) {
                    setTab("open");
                    onDraftDone();
                  }
                  return ok;
                }}
              />
            </div>
          </div>
        )}

        {!comments.loaded ? (
          <div className="flex justify-center p-6 text-fg-muted">
            <Loader2 size={18} className="spin" />
          </div>
        ) : list.length === 0 && !draft ? (
          <p className="p-4 text-center text-[12.5px] text-fg-muted">
            {tab === "open" ? "No open comments. Select text in the PDF and click Comment to start a discussion." : "Nothing resolved yet."}
          </p>
        ) : (
          list.map((c) => (
            <CommentCard
              key={c.id}
              comment={c}
              active={c.id === activeId}
              missing={positions[c.id]?.found === false}
              onActivate={() => onActivate(c.id === activeId ? null : c.id)}
              onShowSource={() => onShowSource(c)}
              act={comments.act}
            />
          ))
        )}
      </div>
    </div>
  );
}
