"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Sigma } from "lucide-react";
import { displayName, openCloudProject, setDisplayName } from "@/lib/cloud";
import { formatCode, normalizeCode } from "@/lib/cloud-types";
import { Button } from "@/components/ui/Button";

/** Landing page for invite links: ask for a name if needed, then open the project. */
export default function JoinProject({ code: raw }: { code: string }) {
  const router = useRouter();
  const code = normalizeCode(raw);
  const [name, setName] = useState(() => displayName() ?? "");
  const [needName] = useState(() => !displayName());
  const [error, setError] = useState<string | null>(code ? null : "That invite link is broken.");
  const [busy, setBusy] = useState(() => Boolean(code) && !needName);

  const join = async () => {
    if (!code) return;
    if (!name.trim()) return setError("Enter your name.");
    setDisplayName(name);
    setBusy(true);
    try {
      router.replace(`/project/${await openCloudProject(code)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open that project.");
      setBusy(false);
    }
  };

  // Returning users (name already set) go straight in.
  useEffect(() => {
    if (!code || needName) return;
    openCloudProject(code)
      .then((id) => router.replace(`/project/${id}`))
      .catch((err: Error) => {
        setError(err.message);
        setBusy(false);
      });
  }, [code, needName, router]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-subtle p-4">
      <div className="w-full max-w-sm rounded-xl border border-line bg-bg p-6 shadow-pop">
        <div className="mb-4 flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-accent-fg">
            <Sigma size={17} strokeWidth={2.5} />
          </span>
          <span className="font-semibold">Join a shared project</span>
        </div>
        {code && <p className="mb-4 font-mono text-xl tracking-widest">{formatCode(code)}</p>}
        {needName && code && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void join();
            }}
            className="flex flex-col gap-3"
          >
            <label className="text-[13px] text-fg-muted">
              Your name, shown to collaborators
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
                className="mt-1 h-9 w-full rounded-md border border-line-strong bg-bg px-3 text-sm text-fg outline-none focus:border-accent"
              />
            </label>
            <Button type="submit" variant="primary" size="md" disabled={busy}>
              {busy && <Loader2 size={15} className="spin" />} Open project
            </Button>
          </form>
        )}
        {!needName && busy && (
          <p className="flex items-center gap-2 text-[13px] text-fg-muted">
            <Loader2 size={15} className="spin" /> Opening…
          </p>
        )}
        {error && <p className="mt-3 text-[13px] text-danger">{error}</p>}
        <Link href="/" className="mt-4 block text-[13px] text-accent hover:underline">
          Go to your projects
        </Link>
      </div>
    </div>
  );
}
