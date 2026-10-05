import { IDLE_LIMIT_MS, type PresenceRequest, type PresenceResponse } from "@/lib/cloud-types";

interface Person {
  id: string;
  name: string;
  lastSeen: number;
  lastActive: number;
}

export interface PresenceState {
  holder: Person | null;
  queue: Person[];
}

/** Holder's tab stopped sending heartbeats (closed, crashed, offline). */
const HOLDER_GONE_MS = 70_000;
/** Waiter stopped polling. */
const WAITER_GONE_MS = 70_000;

export const EMPTY_PRESENCE: PresenceState = { holder: null, queue: [] };

/**
 * The editing lock as a pure state transition: one editor at a time, a first-come queue,
 * and automatic hand-off after 10 minutes of inactivity or a vanished tab.
 */
export function stepPresence(
  state: PresenceState,
  req: PresenceRequest,
  now: number,
  version: number,
): { next: PresenceState; res: Omit<PresenceResponse, "version"> & { version: number } } {
  let holder = state.holder;
  if (holder && (now - holder.lastActive > IDLE_LIMIT_MS || now - holder.lastSeen > HOLDER_GONE_MS)) holder = null;
  let queue = state.queue.filter((w) => now - w.lastSeen < WAITER_GONE_MS && w.id !== holder?.id);

  const me = (): Person => ({ id: req.tabId, name: req.name, lastSeen: now, lastActive: now });
  const promote = () => {
    if (!holder && (queue.length === 0 || queue[0].id === req.tabId)) {
      holder = me();
      queue = queue.filter((w) => w.id !== req.tabId);
      return true;
    }
    return false;
  };
  const respond = (status: PresenceResponse["status"]) => {
    const position = queue.findIndex((w) => w.id === req.tabId);
    return {
      next: { holder, queue },
      res: {
        status,
        holder: holder && holder.id !== req.tabId ? holder.name : null,
        position: position === -1 ? null : position + 1,
        queueLength: queue.length,
        version,
      },
    };
  };

  if (req.mode === "leave") {
    if (holder?.id === req.tabId) holder = null;
    queue = queue.filter((w) => w.id !== req.tabId);
    return respond("left");
  }

  if (holder?.id === req.tabId) {
    holder = { ...holder, name: req.name, lastSeen: now, lastActive: req.active ? now : holder.lastActive };
    return respond("editing");
  }

  // The tab thinks it's editing but the lock moved on (idle timeout or missed heartbeats).
  if (req.mode === "edit") return respond("expired");

  if (req.mode === "view") {
    queue = queue.map((w) => (w.id === req.tabId ? { ...w, lastSeen: now } : w));
    if (queue.some((w) => w.id === req.tabId)) return respond(promote() ? "editing" : "waiting");
    // Only a viewer who is actually using the tab picks up a free lock; idle tabs never do.
    return respond(req.active && promote() ? "editing" : "locked");
  }

  // mode === "queue"
  if (!queue.some((w) => w.id === req.tabId)) queue = [...queue, me()];
  else queue = queue.map((w) => (w.id === req.tabId ? { ...w, name: req.name, lastSeen: now } : w));
  return respond(promote() ? "editing" : "waiting");
}
