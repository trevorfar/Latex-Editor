"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  decodeFile,
  displayName,
  encodeFile,
  fetchFiles,
  fetchMeta,
  leaveBeacon,
  pushChanges,
  sendPresence,
  tabId,
} from "@/lib/cloud";
import { HEARTBEAT_MS, IDLE_LIMIT_MS, type CloudFileData, type PresenceMode, type PresenceResponse } from "@/lib/cloud-types";
import type { ProjectStore } from "@/lib/project-store";
import * as db from "@/lib/db";
import { toast } from "@/components/ui/toast";

export type CloudStatus = "off" | "connecting" | "editing" | "waiting" | "locked" | "expired";

export interface CloudState {
  status: CloudStatus;
  /** Who holds the lock, when it isn't you. */
  holder: string | null;
  position: number | null;
  queueLength: number;
  syncing: boolean;
  offline: boolean;
  error: string | null;
  /** Less than a minute left before the idle timeout. */
  idleWarning: boolean;
}

const WAIT_POLL_MS = 8000;
const PUSH_DELAY_MS = 1500;

export function useCloudSession(store: ProjectStore, code: string | null) {
  const [state, setState] = useState<CloudState>({
    status: code ? "connecting" : "off",
    holder: null,
    position: null,
    queueLength: 0,
    syncing: false,
    offline: false,
    error: null,
    idleWarning: false,
  });
  const status = useRef<CloudStatus>(code ? "connecting" : "off");
  const interacted = useRef(true);
  const lastInteraction = useRef(0);
  const pushing = useRef(false);
  const pushAgain = useRef(false);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const beatTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMeta = useRef<string | null>(null);
  const busy = useRef<Promise<void>>(Promise.resolve());
  const beatRef = useRef<(override?: PresenceMode) => Promise<void>>(() => Promise.resolve());

  const name = () => displayName() || "Anonymous";
  const patch = useCallback((p: Partial<CloudState>) => setState((s) => ({ ...s, ...p })), []);

  /** Local changes not yet in the cloud: puts, deletions and the hashes after applying them. */
  const diff = useCallback(async () => {
    const snap = store.getSnapshot();
    const link = snap.project.cloud;
    const put: Record<string, CloudFileData> = {};
    const hashes: Record<string, string> = {};
    for (const f of snap.files) {
      const enc = await encodeFile(f, f.kind === "text" ? store.getText(f.path) : null);
      hashes[f.path] = enc.h;
      if (link?.hashes[f.path] !== enc.h) put[f.path] = enc;
    }
    const del = Object.keys(link?.hashes ?? {}).filter((p) => !(p in hashes));
    const { name: projectName, mainFile, compiler, folders } = snap.project;
    const meta = { name: projectName, mainFile, compiler, folders };
    return { put, del, hashes, meta, metaKey: JSON.stringify(meta) };
  }, [store]);

  const pull = useCallback(async () => {
    if (!code) return;
    const meta = await fetchMeta(code);
    const link = store.project.cloud ?? { code, version: -1, hashes: {} };
    const need = Object.keys(meta.files).filter((p) => link.hashes[p] !== meta.files[p].h || !store.fileByPath(p));
    const data = await fetchFiles(code, meta, need);
    const files = Object.entries(meta.files).map(([path, entry]) => {
      if (data[path]) return { path, ...decodeFile(entry.k, data[path]) };
      const local = store.fileByPath(path);
      return local?.kind === "binary" ? { path, kind: "binary" as const, data: local.data } : { path, kind: "text" as const, content: store.getText(path) ?? "" };
    });
    await store.applyRemote(
      { name: meta.name, mainFile: meta.mainFile, compiler: meta.compiler, folders: meta.folders },
      files,
      { code, version: meta.version, hashes: Object.fromEntries(Object.entries(meta.files).map(([p, e]) => [p, e.h])) },
    );
    lastMeta.current = JSON.stringify({ name: meta.name, mainFile: meta.mainFile, compiler: meta.compiler, folders: meta.folders });
  }, [code, store]);

  const push = useCallback(
    async (keepalive = false) => {
      if (!code || status.current !== "editing") return;
      if (pushing.current) {
        pushAgain.current = true;
        return;
      }
      pushing.current = true;
      try {
        const d = await diff();
        if (!Object.keys(d.put).length && !d.del.length && d.metaKey === lastMeta.current) return;
        patch({ syncing: true });
        const version = await pushChanges(code, name(), d.meta, d.put, d.del, keepalive);
        lastMeta.current = d.metaKey;
        await store.setCloud({ code, version, hashes: d.hashes });
        patch({ syncing: false, error: null, offline: false });
      } catch (err) {
        const e = err as Error & { status?: number };
        if (e.status === 423) {
          status.current = "expired";
          patch({ syncing: false, status: "expired" });
          store.setReadOnly(true);
        } else patch({ syncing: false, error: e.status ? e.message : null, offline: !e.status });
      } finally {
        pushing.current = false;
        if (pushAgain.current) {
          pushAgain.current = false;
          void push();
        }
      }
    },
    [code, diff, patch, store],
  );

  const schedulePush = useCallback(() => {
    if (status.current !== "editing") return;
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => void push(), PUSH_DELAY_MS);
  }, [push]);

  /** Keeps a local copy of edits that couldn't reach the cloud before the lock was lost. */
  const rescueUnsynced = useCallback(async () => {
    const d = await diff();
    if (!Object.keys(d.put).length && !d.del.length) return;
    await store.flush();
    const copy = await db.duplicateProject(store.project.id, `${store.project.name} (unsaved changes)`);
    if (copy) toast(`Your unsynced edits were kept in a local copy: "${copy.name}".`, "info", 8000);
  }, [diff, store]);

  const handle = useCallback(
    async (res: PresenceResponse) => {
      const prev = status.current;
      const link = store.project.cloud;
      if (res.status === "editing") {
        if (prev !== "editing") {
          store.setReadOnly(true);
          if (!link || res.version !== link.version) await pull();
          status.current = "editing";
          store.setReadOnly(false);
          lastInteraction.current = Date.now();
          if (prev === "waiting" || prev === "expired") toast("It's your turn: you can edit now.", "success");
        }
      } else {
        if (prev === "editing") await rescueUnsynced();
        status.current = res.status === "left" ? "locked" : res.status;
        store.setReadOnly(true);
        if (!link || res.version !== link.version) await pull();
      }
      patch({ status: status.current, holder: res.holder, position: res.position, queueLength: res.queueLength, offline: false });
    },
    [patch, pull, rescueUnsynced, store],
  );

  const beat = useCallback(
    (override?: PresenceMode) => {
      if (!code) return Promise.resolve();
      // Serialise beats so a manual request never interleaves with the timer.
      busy.current = busy.current.then(async () => {
        if (beatTimer.current) clearTimeout(beatTimer.current);
        const mode: PresenceMode = override ?? (status.current === "editing" ? "edit" : status.current === "waiting" ? "queue" : "view");
        const active = interacted.current || override === "queue";
        interacted.current = false;
        try {
          if (status.current === "editing") await push();
          const res = await sendPresence(code, { tabId: tabId(), name: name(), mode, active });
          await handle(res);
        } catch (err) {
          const e = err as Error & { status?: number };
          patch(e.status ? { error: e.message } : { offline: true });
          if (status.current === "connecting") {
            // Can't reach the cloud: stay usable read-only on the local copy.
            status.current = "locked";
            store.setReadOnly(true);
            patch({ status: "locked" });
          }
        }
        beatTimer.current = setTimeout(() => void beatRef.current(), status.current === "editing" ? HEARTBEAT_MS : WAIT_POLL_MS);
      });
      return busy.current;
    },
    [code, handle, patch, push, store],
  );

  useLayoutEffect(() => {
    beatRef.current = beat;
  });

  // Start/stop the session.
  useEffect(() => {
    if (!code) {
      store.setReadOnly(false);
      return;
    }
    status.current = "connecting";
    store.setReadOnly(true);
    interacted.current = true;
    lastInteraction.current = Date.now();
    void beat("view");

    const onActivity = () => {
      interacted.current = true;
      lastInteraction.current = Date.now();
    };
    window.addEventListener("keydown", onActivity, true);
    window.addEventListener("pointerdown", onActivity, true);
    const idleTimer = setInterval(() => {
      const idle = Date.now() - lastInteraction.current;
      setState((s) => {
        const warn = status.current === "editing" && idle > IDLE_LIMIT_MS - 60_000;
        return s.idleWarning === warn ? s : { ...s, idleWarning: warn };
      });
    }, 5000);
    const onHide = () => {
      if (status.current === "editing") {
        void push(true);
        leaveBeacon(code, name());
      }
    };
    window.addEventListener("pagehide", onHide);
    const offContent = store.onContentChange(schedulePush);
    const offSnapshot = store.subscribe(schedulePush);

    return () => {
      window.removeEventListener("keydown", onActivity, true);
      window.removeEventListener("pointerdown", onActivity, true);
      window.removeEventListener("pagehide", onHide);
      clearInterval(idleTimer);
      offContent();
      offSnapshot();
      if (beatTimer.current) clearTimeout(beatTimer.current);
      if (pushTimer.current) clearTimeout(pushTimer.current);
      // Leaving the editor (e.g. back to the project list): save, then hand the lock on.
      if (status.current === "editing") {
        void push().finally(() => void sendPresence(code, { tabId: tabId(), name: name(), mode: "leave", active: false }).catch(() => undefined));
      }
      status.current = "off";
    };
  }, [code, beat, push, schedulePush, store]);

  const requestEdit = useCallback(() => {
    interacted.current = true;
    return beat("queue");
  }, [beat]);

  const leaveQueue = useCallback(async () => {
    await beat("leave");
  }, [beat]);

  return { ...state, requestEdit, leaveQueue, flush: push };
}
