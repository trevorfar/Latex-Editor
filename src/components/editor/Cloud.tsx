"use client";

import { useState } from "react";
import { Check, Clock, Cloud, CloudOff, Copy, Eye, Loader2, Lock, Pencil, Users } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/toast";
import { displayName, setDisplayName } from "@/lib/cloud";
import { formatCode } from "@/lib/cloud-types";
import type { CloudState } from "./useCloudSession";

/** Small status chip for the top bar. */
export function CloudChip({ state, onClick }: { state: CloudState; onClick: () => void }) {
  const { status } = state;
  if (status === "off") return null;
  const look =
    status === "editing"
      ? { icon: state.syncing ? <Loader2 size={13} className="spin" /> : <Pencil size={13} />, text: "Editing", cls: "text-accent bg-accent-soft" }
      : status === "waiting"
        ? { icon: <Clock size={13} />, text: `In line #${state.position ?? "?"}`, cls: "text-warning bg-warning-soft" }
        : status === "connecting"
          ? { icon: <Loader2 size={13} className="spin" />, text: "Connecting", cls: "text-fg-muted bg-muted" }
          : { icon: <Eye size={13} />, text: "View only", cls: "text-fg-muted bg-muted" };
  return (
    <button
      onClick={onClick}
      title="Cloud sharing"
      className={`flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium ${look.cls}`}
    >
      {state.offline ? <CloudOff size={13} /> : look.icon}
      <span className="hidden sm:inline">{state.offline ? "Offline" : look.text}</span>
    </button>
  );
}

/** Explains why the editor is read-only and offers the next step. */
export function CloudBanner({ state, onRequest, onLeave }: { state: CloudState; onRequest: () => void; onLeave: () => void }) {
  const { status, holder } = state;
  let body: React.ReactNode = null;
  let action: React.ReactNode = null;
  let tone = "bg-info-soft text-fg";

  if (state.idleWarning && status === "editing") {
    tone = "bg-warning-soft text-fg";
    body = "Still there? You'll lose editing access in under a minute unless you type or click.";
  } else if (status === "locked") {
    body = holder ? (
      <>
        <strong>{holder}</strong> is editing. You&apos;re viewing a read-only copy that updates as they save.
      </>
    ) : (
      "Someone else is about to start editing. You're viewing a read-only copy."
    );
    action = (
      <Button size="xs" variant="primary" onClick={onRequest}>
        Join the queue to edit
      </Button>
    );
  } else if (status === "waiting") {
    tone = "bg-warning-soft text-fg";
    body = (
      <>
        You&apos;re <strong>#{state.position}</strong> in line{holder ? <> behind <strong>{holder}</strong></> : null}. You&apos;ll get
        editing access automatically, and it moves on after 10 minutes of inactivity.
      </>
    );
    action = (
      <Button size="xs" onClick={onLeave}>
        Leave queue
      </Button>
    );
  } else if (status === "expired") {
    tone = "bg-warning-soft text-fg";
    body = "You were inactive for 10 minutes, so editing access was released. Your work up to then was saved.";
    action = (
      <Button size="xs" variant="primary" onClick={onRequest}>
        Get editing access
      </Button>
    );
  } else if (state.error && status === "editing") {
    tone = "bg-danger-soft text-fg";
    body = `Cloud save failed: ${state.error}`;
  }
  if (!body) return null;
  return (
    <div className={`flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-3 py-2 text-[13px] ${tone}`}>
      <Lock size={14} className="shrink-0 text-fg-muted" />
      <span className="min-w-0 flex-1">{body}</span>
      {action}
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="mb-1 text-[12px] text-fg-muted">{label}</div>
      <div className="flex gap-2">
        <input readOnly value={value} onFocus={(e) => e.target.select()} className="h-9 min-w-0 flex-1 rounded-md border border-line bg-subtle px-3 font-mono text-[13px]" />
        <Button
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  code: string | null;
  state: CloudState;
  onCreate: (name: string) => Promise<void>;
}

export function ShareDialog({ open, onClose, code, state, onCreate }: ShareDialogProps) {
  const [name, setName] = useState(() => (typeof window === "undefined" ? "" : (displayName() ?? "")));
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim()) return toast("Enter your name first.", "error");
    setBusy(true);
    try {
      await onCreate(name.trim());
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save to the cloud.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={code ? "Share project" : "Save to the cloud"} footer={<Button onClick={onClose}>Done</Button>}>
      {!code ? (
        <div className="flex flex-col gap-4">
          <div className="flex gap-3 rounded-lg bg-subtle p-3 text-[13px] text-fg-muted">
            <Cloud size={18} className="mt-0.5 shrink-0 text-accent" />
            <p>
              Uploads this project and gives you an invite code. Anyone with the code can open it. One person edits at a time; others
              see a live read-only copy and can join a queue. Editing access passes on after 10 minutes of inactivity.
            </p>
          </div>
          <label className="block">
            <span className="mb-1 block text-[12px] text-fg-muted">Your name (shown to collaborators)</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void create()}
              maxLength={40}
              className="h-9 w-full rounded-md border border-line-strong bg-bg px-3 text-sm outline-none focus:border-accent"
              placeholder="e.g. Trevor"
            />
          </label>
          <Button variant="primary" size="md" onClick={() => void create()} disabled={busy}>
            {busy ? <Loader2 size={15} className="spin" /> : <Cloud size={15} />}
            Save to cloud and get a code
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="text-center">
            <div className="text-[12px] text-fg-muted">Invite code</div>
            <div className="mt-1 font-mono text-3xl font-semibold tracking-widest">{formatCode(code)}</div>
          </div>
          <CopyRow label="Invite link" value={`${window.location.origin}/join/${code}`} />
          <CopyRow label="Code" value={formatCode(code)} />
          <label className="block">
            <span className="mb-1 block text-[12px] text-fg-muted">Your name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => name.trim() && setDisplayName(name)}
              maxLength={40}
              className="h-9 w-full rounded-md border border-line-strong bg-bg px-3 text-sm outline-none focus:border-accent"
            />
          </label>
          <div className="flex items-center gap-2 rounded-lg bg-subtle p-3 text-[12.5px] text-fg-muted">
            <Users size={15} className="shrink-0" />
            {state.status === "editing"
              ? `You're editing. ${state.queueLength ? `${state.queueLength} waiting in line.` : "Nobody is waiting."}`
              : state.holder
                ? `${state.holder} is editing. ${state.queueLength} waiting in line.`
                : "Nobody is editing right now."}
          </div>
          <p className="text-[12px] text-fg-faint">
            Anyone with the code can edit, so share it only with people you trust. Cloud projects are deleted after 180 days without
            changes.
          </p>
        </div>
      )}
    </Modal>
  );
}
