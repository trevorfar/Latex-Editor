"use client";

import { deflateSync, inflateSync, strToU8, strFromU8 } from "fflate";
import * as db from "./db";
import {
  MAX_REQUEST_BYTES,
  type CloudFileData,
  type CloudMeta,
  type PresenceRequest,
  type PresenceResponse,
  type SaveRequest,
} from "./cloud-types";
import type { FileKind, ProjectFile, ProjectMeta } from "./types";

// ----- identity -----

const NAME_KEY = "latex-studio:display-name";
const TAB_KEY = "latex-studio:tab-id";

/** Per-tab id: survives reloads (sessionStorage) so a refreshed editor keeps its lock. */
export function tabId(): string {
  let id = sessionStorage.getItem(TAB_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(TAB_KEY, id);
  }
  return id;
}

export function displayName(): string | null {
  try {
    return localStorage.getItem(NAME_KEY);
  } catch {
    return null;
  }
}

export function setDisplayName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name.trim().slice(0, 40));
  } catch {
    // Not persisted.
  }
}

// ----- encoding -----

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function hash(data: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", strToU8(data));
  return toBase64(new Uint8Array(digest)).slice(0, 22);
}

const binaryCache = new WeakMap<Blob, CloudFileData>();
const textCache = new Map<string, { text: string; enc: CloudFileData }>();

/** Deflate + base64. Cached so repeated syncs don't recompress unchanged files. */
export async function encodeFile(file: ProjectFile, text: string | null): Promise<CloudFileData> {
  if (file.kind === "text") {
    const t = text ?? file.content ?? "";
    const cached = textCache.get(file.path);
    if (cached && cached.text === t) return cached.enc;
    const d = toBase64(deflateSync(strToU8(t), { level: 6 }));
    const enc: CloudFileData = { k: "t", d, h: await hash(d), s: d.length };
    textCache.set(file.path, { text: t, enc });
    return enc;
  }
  const blob = file.data ?? new Blob();
  const cached = binaryCache.get(blob);
  if (cached) return cached;
  const d = toBase64(deflateSync(new Uint8Array(await blob.arrayBuffer()), { level: 1 }));
  const enc: CloudFileData = { k: "b", d, h: await hash(d), s: d.length };
  binaryCache.set(blob, enc);
  return enc;
}

export function decodeFile(kind: "t" | "b", d: string): { kind: FileKind; content?: string; data?: Blob } {
  const bytes = inflateSync(fromBase64(d));
  return kind === "t" ? { kind: "text", content: strFromU8(bytes) } : { kind: "binary", data: new Blob([bytes as BlobPart]) };
}

// ----- API -----

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error ?? `Request failed (${res.status})`), { status: res.status });
  return body as T;
}

export function fetchMeta(code: string) {
  return api<CloudMeta>(`/api/cloud/${code}`);
}

export function sendPresence(code: string, req: PresenceRequest) {
  return api<PresenceResponse>(`/api/cloud/${code}/presence`, { method: "POST", body: JSON.stringify(req) });
}

/** Releases the lock while the page unloads. */
export function leaveBeacon(code: string, name: string) {
  const body = JSON.stringify({ tabId: tabId(), name, mode: "leave", active: false } satisfies PresenceRequest);
  navigator.sendBeacon(`/api/cloud/${code}/presence`, body);
}

export async function createCloudProject(project: ProjectMeta, name: string): Promise<string> {
  const { code } = await api<{ code: string }>("/api/cloud", {
    method: "POST",
    body: JSON.stringify({
      tabId: tabId(),
      name,
      meta: { name: project.name, mainFile: project.mainFile, compiler: project.compiler, folders: project.folders },
    }),
  });
  return code;
}

/** Splits work into batches whose summed size stays under the request limit. */
function batches<T>(items: T[], size: (t: T) => number): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let bytes = 0;
  for (const it of items) {
    const s = size(it);
    if (cur.length && bytes + s > MAX_REQUEST_BYTES) {
      out.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(it);
    bytes += s;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Uploads changed files and deletions. Returns the new server version. */
export async function pushChanges(
  code: string,
  name: string,
  meta: SaveRequest["meta"],
  put: Record<string, CloudFileData>,
  del: string[],
  keepalive = false,
): Promise<number> {
  const entries = Object.entries(put);
  for (const [, f] of entries) {
    if (f.s > MAX_REQUEST_BYTES) throw new Error("A file is larger than 3 MB after compression, which the cloud can't store.");
  }
  const groups = entries.length ? batches(entries, ([, f]) => f.s) : [[]];
  let version = 0;
  for (let i = 0; i < groups.length; i++) {
    const body: SaveRequest = { tabId: tabId(), name, meta, put: Object.fromEntries(groups[i]), del: i === 0 ? del : [] };
    ({ version } = await api<{ version: number }>(`/api/cloud/${code}/files`, {
      method: "PUT",
      body: JSON.stringify(body),
      keepalive: keepalive && JSON.stringify(body).length < 60_000,
    }));
  }
  return version;
}

/** Downloads the given files (batched by size). */
export async function fetchFiles(code: string, meta: CloudMeta, paths: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const group of batches(paths, (p) => meta.files[p]?.s ?? 0)) {
    const { files } = await api<{ files: Record<string, string | null> }>(`/api/cloud/${code}/files`, {
      method: "POST",
      body: JSON.stringify({ paths: group }),
    });
    for (const [p, d] of Object.entries(files)) if (d) out[p] = d;
  }
  return out;
}

/** Opens (or creates) the local copy of a cloud project. Contents download when the editor opens. */
export async function openCloudProject(code: string): Promise<string> {
  const meta = await fetchMeta(code);
  const existing = (await db.listProjects()).find((p) => p.cloud?.code === code);
  if (existing) return existing.id;
  const project = await db.createProject(
    { name: meta.name, mainFile: meta.mainFile, compiler: meta.compiler, folders: meta.folders, cloud: { code, version: -1, hashes: {} } },
    [],
  );
  return project.id;
}
