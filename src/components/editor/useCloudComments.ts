"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { displayName, fetchComments, sendComment } from "@/lib/cloud";
import type { CloudComment, CommentAction } from "@/lib/cloud-types";
import { toast } from "@/components/ui/toast";

const POLL_MS = 4000;
const NONE: CloudComment[] = [];

export interface CommentsState {
  enabled: boolean;
  comments: CloudComment[];
  loaded: boolean;
  /** Resolves true when the server accepted the change. */
  act(action: CommentAction): Promise<boolean>;
}

/** Shared comments for a cloud project, kept fresh by polling. Independent of the editing lock. */
export function useCloudComments(code: string | null): CommentsState {
  // Tagged with the project code so switching projects never shows another project's comments.
  const [data, setData] = useState<{ code: string; comments: CloudComment[] } | null>(null);
  const version = useRef<{ code: string; version: number } | null>(null);

  const refresh = useCallback(async () => {
    if (!code) return;
    try {
      const since = version.current?.code === code ? version.current.version : undefined;
      const doc = await fetchComments(code, since);
      if (doc.comments) {
        version.current = { code, version: doc.version };
        setData({ code, comments: doc.comments });
      } else setData((d) => (d?.code === code ? d : { code, comments: [] }));
    } catch {
      // Offline or rate-limited: try again on the next poll.
    }
  }, [code]);

  useEffect(() => {
    if (!code) return;
    void refresh();
    const timer = setInterval(() => document.visibilityState === "visible" && void refresh(), POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [code, refresh]);

  const act = useCallback(
    async (action: CommentAction) => {
      if (!code) return false;
      try {
        const doc = await sendComment(code, displayName() || "Anonymous", action);
        version.current = { code, version: doc.version };
        setData({ code, comments: doc.comments });
        return true;
      } catch (err) {
        toast(err instanceof Error ? err.message : "Couldn't update the comment.", "error");
        void refresh();
        return false;
      }
    },
    [code, refresh],
  );

  const mine = data && data.code === code ? data : null;
  return { enabled: Boolean(code), comments: mine?.comments ?? NONE, loaded: Boolean(mine), act };
}
