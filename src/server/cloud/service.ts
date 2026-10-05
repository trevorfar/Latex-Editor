import "server-only";
import { getKv, type Kv } from "./kv";
import { EMPTY_PRESENCE, stepPresence, type PresenceState } from "./presence";
import { normalizePath } from "@/lib/paths";
import { COMPILERS } from "@/lib/types";
import { randomCode, type CloudMeta, type PresenceRequest, type PresenceResponse, type SaveRequest } from "@/lib/cloud-types";

/** Unused projects disappear after this long, keeping the free tier tidy. Every save resets it. */
const PROJECT_TTL_S = 180 * 24 * 60 * 60;
const PRESENCE_TTL_S = 24 * 60 * 60;
const MAX_PROJECT_BYTES = (Number(process.env.CLOUD_MAX_PROJECT_MB) || 25) * 1024 * 1024;

const keys = (code: string) => ({
  meta: `tb:${code}:meta`,
  files: `tb:${code}:files`,
  presence: `tb:${code}:presence`,
});

export class CloudError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function kvOrThrow(): Kv {
  const kv = getKv();
  if (!kv) throw new CloudError(503, "Cloud saving isn't set up on this server (no Upstash Redis credentials).");
  return kv;
}

function cleanName(name: unknown): string {
  return String(name ?? "").trim().slice(0, 40) || "Someone";
}

function validateMeta(meta: SaveRequest["meta"]): SaveRequest["meta"] {
  if (!meta || typeof meta.name !== "string" || !COMPILERS.some((c) => c.id === meta.compiler)) throw new CloudError(400, "Bad project data.");
  const mainFile = normalizePath(meta.mainFile);
  if (!mainFile) throw new CloudError(400, "Bad main file.");
  const folders = (Array.isArray(meta.folders) ? meta.folders : []).map((f) => normalizePath(String(f))).filter((f): f is string => !!f);
  return { name: meta.name.slice(0, 120) || "Untitled", mainFile, compiler: meta.compiler, folders };
}

export async function getMeta(code: string): Promise<CloudMeta> {
  const raw = await kvOrThrow().get(keys(code).meta);
  if (!raw) throw new CloudError(404, "No project with that code. Check it, or it may have expired.");
  return JSON.parse(raw) as CloudMeta;
}

async function readPresence(kv: Kv, code: string): Promise<{ raw: string | null; state: PresenceState }> {
  const raw = await kv.get(keys(code).presence);
  return { raw, state: raw ? (JSON.parse(raw) as PresenceState) : EMPTY_PRESENCE };
}

export async function presence(code: string, req: PresenceRequest): Promise<PresenceResponse> {
  const kv = kvOrThrow();
  const meta = await getMeta(code);
  const clean: PresenceRequest = { ...req, name: cleanName(req.name), tabId: String(req.tabId).slice(0, 64) };
  for (let attempt = 0; attempt < 6; attempt++) {
    const { raw, state } = await readPresence(kv, code);
    const { next, res } = stepPresence(state, clean, Date.now(), meta.version);
    if (await kv.cas(keys(code).presence, raw, JSON.stringify(next), PRESENCE_TTL_S)) return res;
  }
  throw new CloudError(409, "Too many people joining at once. Try again.");
}

export async function createProject(tabId: string, name: string, meta: SaveRequest["meta"]): Promise<string> {
  const kv = kvOrThrow();
  const m = validateMeta(meta);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const k = keys(code);
    const now = Date.now();
    const doc: CloudMeta = { ...m, files: {}, version: 0, createdAt: now, updatedAt: now, updatedBy: cleanName(name) };
    if (!(await kv.cas(k.meta, null, JSON.stringify(doc), PROJECT_TTL_S))) continue;
    // The creator starts out holding the editing lock so the upload can follow.
    const state: PresenceState = { holder: { id: tabId, name: cleanName(name), lastSeen: now, lastActive: now }, queue: [] };
    await kv.cas(k.presence, null, JSON.stringify(state), PRESENCE_TTL_S);
    return code;
  }
  throw new CloudError(500, "Couldn't allocate a code. Try again.");
}

export async function getFiles(code: string, paths: string[]): Promise<Record<string, string | null>> {
  const values = await kvOrThrow().hget(keys(code).files, paths.slice(0, 500));
  return Object.fromEntries(paths.map((p, i) => [p, values[i] ?? null]));
}

/** Applies a save from the tab holding the lock. Returns the new version. */
export async function save(code: string, req: SaveRequest): Promise<number> {
  const kv = kvOrThrow();
  const { state } = await readPresence(kv, code);
  if (state.holder?.id !== req.tabId) {
    throw new CloudError(423, "You no longer hold the editing lock, so this change wasn't saved.");
  }
  const meta = await getMeta(code);
  const m = validateMeta(req.meta);

  const files = { ...meta.files };
  const put: Record<string, string> = {};
  for (const [rawPath, f] of Object.entries(req.put ?? {})) {
    const p = normalizePath(rawPath);
    if (!p || p !== rawPath || (f.k !== "t" && f.k !== "b") || typeof f.d !== "string" || typeof f.h !== "string") {
      throw new CloudError(400, `Bad file: ${rawPath}`);
    }
    put[p] = f.d;
    files[p] = { k: f.k, h: f.h.slice(0, 64), s: f.d.length };
  }
  const del = (req.del ?? []).filter((p) => typeof p === "string" && p in files && !(p in put));
  for (const p of del) delete files[p];

  const total = Object.values(files).reduce((n, f) => n + f.s, 0);
  if (total > MAX_PROJECT_BYTES) throw new CloudError(413, `Cloud projects are limited to ${Math.round(MAX_PROJECT_BYTES / 1024 / 1024)} MB.`);

  const next: CloudMeta = { ...meta, ...m, files, version: meta.version + 1, updatedAt: Date.now(), updatedBy: cleanName(req.name) };
  await kv.save({ filesKey: keys(code).files, metaKey: keys(code).meta, put, del, meta: JSON.stringify(next), ttlSeconds: PROJECT_TTL_S });
  return next.version;
}
