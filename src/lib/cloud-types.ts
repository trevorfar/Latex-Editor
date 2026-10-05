import type { Compiler } from "./types";

/** Per-file entry in the cloud manifest. Contents live in a separate hash. */
export interface CloudFileEntry {
  /** "t" text, "b" binary. */
  k: "t" | "b";
  /** Hash of the encoded contents, to skip unchanged files when syncing. */
  h: string;
  /** Encoded size in bytes. */
  s: number;
}

export interface CloudMeta {
  name: string;
  mainFile: string;
  compiler: Compiler;
  folders: string[];
  files: Record<string, CloudFileEntry>;
  /** Increments on every save. */
  version: number;
  createdAt: number;
  updatedAt: number;
  /** Display name of whoever saved last. */
  updatedBy: string;
}

/** A file's contents: deflate-compressed, base64-encoded. */
export interface CloudFileData extends CloudFileEntry {
  d: string;
}

export type PresenceMode = "view" | "queue" | "edit" | "leave";
export type PresenceStatus = "editing" | "waiting" | "locked" | "expired" | "left";

export interface PresenceRequest {
  tabId: string;
  name: string;
  mode: PresenceMode;
  /** The user typed or clicked since the previous request. */
  active: boolean;
}

export interface PresenceResponse {
  status: PresenceStatus;
  /** Name of the current editor, when it's someone else. */
  holder: string | null;
  /** 1-based place in line while waiting. */
  position: number | null;
  queueLength: number;
  version: number;
}

export interface SaveRequest {
  tabId: string;
  name: string;
  meta: Pick<CloudMeta, "name" | "mainFile" | "compiler" | "folders">;
  put: Record<string, CloudFileData>;
  del: string[];
}

export const IDLE_LIMIT_MS = 10 * 60 * 1000;
export const HEARTBEAT_MS = 20 * 1000;
/** Keep each request under Vercel's 4.5 MB body limit. */
export const MAX_REQUEST_BYTES = 3 * 1024 * 1024;

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function normalizeCode(input: string): string | null {
  const c = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return c.length === 8 && [...c].every((ch) => CODE_ALPHABET.includes(ch)) ? c : null;
}

export function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}
