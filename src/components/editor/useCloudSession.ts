"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  decodeFile,
  displayName,
  encodeFile,
  fetchFiles,
  fetchMeta,
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

const WAIT_POLL_MS = 2000;
const PUSH_DELAY_MS = 500;

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
  const pendingPush = useRef<Promise<void>>(Promise.resolve());
  const pushAgain = useRef(false);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const beatTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMeta = useRef<string | null>(null);
  const busy = useRef<Promise<void>>(Promise.resolve());
  const beatRef = useRef<(override?: PresenceMode) => Promise<void>>(() => Promise.resolve());

  const lockedPath = useRef<string | null>(null);
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
    const editingPath = status.current === "editing" && !store.readOnly ? lockedPath.current : null;
    if (!editingPath) store.setReadOnly(true);
    try {
      const dirty = await diff();
      const meta = await fetchMeta(code);
      const link = store.project.cloud ?? { code, version: -1, hashes: {} };
      const need = Object.keys(meta.files).filter((p) => link.hashes[p] !== meta.files[p].h || !store.fileByPath(p));
      const data = await fetchFiles(code, meta, need);
      if ((await fetchMeta(code)).version !== meta.version) {
        throw new Error("Project changed during download; retrying on the next sync.");
      }
      const missing = need.filter((p) => !data[p]);
      // Never record a file as synced without its contents; retry on the next poll instead.
      if (missing.length) throw new Error(`Couldn't download ${missing.length} file(s) from the cloud.`);
      const preserveLocal = status.current === "editing";
      const files = Object.entries(meta.files).filter(([path]) => !preserveLocal || !dirty.del.includes(path)).map(([path, entry]) => {
        if (dirty.put[path] && status.current === "editing") {
          const local = store.fileByPath(path);
          if (local) return local.kind === "binary" ? { path, kind: "binary" as const, data: local.data } : { path, kind: "text" as const, content: store.getText(path) ?? "" };
        }
        if (data[path]) return { path, ...decodeFile(entry.k, data[path]) };
        const local = store.fileByPath(path);
        return local?.kind === "binary" ? { path, kind: "binary" as const, data: local.data } : { path, kind: "text" as const, content: store.getText(path) ?? "" };
      });
      if (preserveLocal) {
        for (const [path, entry] of Object.entries(dirty.put)) {
          if (!(path in meta.files)) files.push({ path, ...decodeFile(entry.k, entry.d) });
        }
      }
      const hashes = Object.fromEntries(Object.entries(meta.files).map(([p, e]) => [p, dirty.put[p] && preserveLocal ? link.hashes[p] ?? "" : e.h]));
      if (preserveLocal) {
        for (const path of dirty.del) if (link.hashes[path]) hashes[path] = link.hashes[path];
      }
      await store.applyRemote(
        preserveLocal && dirty.metaKey !== lastMeta.current ? dirty.meta : { name: meta.name, mainFile: meta.mainFile, compiler: meta.compiler, folders: meta.folders },
        files,
        { code, version: meta.version, hashes },
        editingPath,
      );
      lastMeta.current = JSON.stringify({ name: meta.name, mainFile: meta.mainFile, compiler: meta.compiler, folders: meta.folders });
    } finally {
      store.setReadOnly(status.current !== "editing" || lockedPath.current !== store.getSnapshot().currentPath);
    }
  }, [code, store, diff]);

  const push = useCallback(
    async (keepalive = false) => {
      if (!code || status.current !== "editing") return;
      if (pushing.current) {
        pushAgain.current = true;
        await pendingPush.current;
        return;
      }
      pushing.current = true;
      let finishPush!: () => void;
      pendingPush.current = new Promise<void>((resolve) => { finishPush = resolve; });
      try {
        const d = await diff();
        if (!Object.keys(d.put).length && !d.del.length && d.metaKey === lastMeta.current) return;
        patch({ syncing: true });
        const version = await pushChanges(code, name(), d.meta, d.put, d.del, keepalive, lastMeta.current ?? undefined, store.project.cloud?.hashes);
        lastMeta.current = d.metaKey;
        await store.setCloud({ code, version, hashes: d.hashes });
        await pull();
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
        finishPush();
        if (pushAgain.current) {
          pushAgain.current = false;
          if (pushTimer.current) clearTimeout(pushTimer.current);
          pushTimer.current = setTimeout(() => { busy.current = busy.current.then(() => push()); }, PUSH_DELAY_MS);
        }
      }
    },
    [code, diff, patch, store, pull],
  );

  const schedulePush = useCallback(() => {
    if (status.current !== "editing") return;
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => { busy.current = busy.current.then(() => push()); }, PUSH_DELAY_MS);
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
    async (res: PresenceResponse, requestedPath: string | null) => {
      if (requestedPath !== store.getSnapshot().currentPath) return;
      const prev = status.current;
      const link = store.project.cloud;
      if (res.status === "editing") {
        if (prev !== "editing" || lockedPath.current !== store.getSnapshot().currentPath) {
          store.setReadOnly(true);
          if (!link || res.version !== link.version) await pull();
          const previousPath = lockedPath.current;
          lockedPath.current = store.getSnapshot().currentPath;
          if (code && previousPath && previousPath !== lockedPath.current) {
            await sendPresence(code, { tabId: tabId(), name: name(), mode: "leave", active: false, path: previousPath });
          }
          status.current = "editing";
          store.setReadOnly(requestedPath !== store.getSnapshot().currentPath);
          lastInteraction.current = Date.now();
          if (prev === "waiting" || prev === "expired") toast("It's your turn: you can edit now.", "success");
        }
        if (link && res.version !== link.version) await pull();
      } else {
        if (prev === "editing") await rescueUnsynced();
        status.current = res.status === "left" ? "locked" : res.status;
        store.setReadOnly(true);
        if (!link || res.version !== link.version) await pull();
      }
      patch({ status: status.current, holder: res.holder, position: res.position, queueLength: res.queueLength, offline: false });
    },
    [code, patch, pull, rescueUnsynced, store],
  );

  const beat = useCallback(
    (override?: PresenceMode) => {
      if (!code) return Promise.resolve();
      // Serialise beats so a manual request never interleaves with the timer.
      busy.current = busy.current.then(async () => {
        if (beatTimer.current) clearTimeout(beatTimer.current);
        const switched = lockedPath.current !== store.getSnapshot().currentPath;
        const mode: PresenceMode = override === "leave" ? "leave" : switched ? "queue" : override ?? (status.current === "editing" ? "edit" : status.current === "waiting" ? "queue" : "view");
        const active = interacted.current || override === "queue";
        interacted.current = false;
        try {
          if (status.current === "editing") {
            await push();
            if (switched) {
              const unsaved = await diff();
              if (Object.keys(unsaved.put).length || unsaved.del.length) {
                throw new Error("Waiting for unsaved changes before switching editing access.");
              }
            }
          }
          const requestedPath = store.getSnapshot().currentPath;
          if (switched && lockedPath.current) {
            await sendPresence(code, { tabId: tabId(), name: name(), mode: "leave", active: false, path: lockedPath.current });
            lockedPath.current = null;
            status.current = "connecting";
          }
          const res = await sendPresence(code, { tabId: tabId(), name: name(), mode, active, path: requestedPath ?? undefined });
          await handle(res, requestedPath);
          if (requestedPath === store.getSnapshot().currentPath) lockedPath.current = requestedPath;
          else await sendPresence(code, { tabId: tabId(), name: name(), mode: "leave", active: false, path: requestedPath ?? undefined });
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
    [code, diff, handle, patch, push, store],
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
        // The lease expires if the tab closes before its final save completes.
      }
    };
    window.addEventListener("pagehide", onHide);
    const offContent = store.onContentChange(schedulePush);
    let observedPath = store.getSnapshot().currentPath;
    const offSnapshot = store.subscribe(() => {
      const nextPath = store.getSnapshot().currentPath;
      if (nextPath !== observedPath) {
        observedPath = nextPath;
        store.setReadOnly(true);
        void beat("queue");
      } else schedulePush();
    });

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
