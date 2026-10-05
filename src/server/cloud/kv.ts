import "server-only";
import { Redis } from "@upstash/redis";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Minimal key-value surface the cloud feature needs.
 * Production: Upstash Redis (free tier). Local dev without credentials: JSON files in .data/cloud.
 */
export interface Kv {
  get(key: string): Promise<string | null>;
  /** Writes `value` only if the key currently holds `expected` (null = missing). */
  cas(key: string, expected: string | null, value: string, ttlSeconds: number): Promise<boolean>;
  hget(key: string, fields: string[]): Promise<(string | null)[]>;
  /** Atomically-enough applies a save: hash puts/deletes plus a new value for `metaKey`. */
  save(opts: { filesKey: string; metaKey: string; put: Record<string, string>; del: string[]; meta: string; ttlSeconds: number }): Promise<void>;
}

const CAS_SCRIPT = `
local cur = redis.call('GET', KEYS[1])
if (cur == false and ARGV[1] == '') or cur == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2], 'EX', tonumber(ARGV[3]))
  return 1
end
return 0`;

class UpstashKv implements Kv {
  constructor(private redis: Redis) {}

  get(key: string) {
    return this.redis.get<string>(key);
  }

  async cas(key: string, expected: string | null, value: string, ttl: number) {
    const ok = await this.redis.eval(CAS_SCRIPT, [key], [expected ?? "", value, String(ttl)]);
    return Number(ok) === 1;
  }

  async hget(key: string, fields: string[]) {
    if (fields.length === 0) return [];
    // With automaticDeserialization off, Upstash returns HMGET's raw array (one value per field).
    const res = (await this.redis.hmget(key, ...fields)) as unknown;
    if (Array.isArray(res)) return fields.map((_, i) => (res[i] as string | null) ?? null);
    const obj = (res ?? {}) as Record<string, string | null>;
    return fields.map((f) => obj[f] ?? null);
  }

  async save({ filesKey, metaKey, put, del, meta, ttlSeconds }: Parameters<Kv["save"]>[0]) {
    const p = this.redis.pipeline();
    if (Object.keys(put).length) p.hset(filesKey, put);
    if (del.length) p.hdel(filesKey, ...del);
    p.set(metaKey, meta, { ex: ttlSeconds });
    p.expire(filesKey, ttlSeconds);
    await p.exec();
  }
}

/** Single-process file store for local development. */
class FileKv implements Kv {
  private dir = path.join(process.cwd(), ".data", "cloud");
  private queue: Promise<unknown> = Promise.resolve();

  private file(key: string) {
    return path.join(/*turbopackIgnore: true*/ this.dir, `${key.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
  }

  private async read<T>(key: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(this.file(key), "utf8")) as T;
    } catch {
      return null;
    }
  }

  private async write(key: string, value: unknown) {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.file(key), JSON.stringify(value));
  }

  /** Serialises all operations so compare-and-set is atomic within this process. */
  private locked<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  get(key: string) {
    return this.locked(() => this.read<string>(key));
  }

  cas(key: string, expected: string | null, value: string) {
    return this.locked(async () => {
      if ((await this.read<string>(key)) !== expected) return false;
      await this.write(key, value);
      return true;
    });
  }

  hget(key: string, fields: string[]) {
    return this.locked(async () => {
      const h = (await this.read<Record<string, string>>(key)) ?? {};
      return fields.map((f) => h[f] ?? null);
    });
  }

  save({ filesKey, metaKey, put, del, meta }: Parameters<Kv["save"]>[0]) {
    return this.locked(async () => {
      const h = { ...((await this.read<Record<string, string>>(filesKey)) ?? {}), ...put };
      for (const d of del) delete h[d];
      await this.write(filesKey, h);
      await this.write(metaKey, meta);
    });
  }
}

let kv: Kv | null | undefined;

/** Null when the cloud isn't configured (production without Upstash credentials). */
export function getKv(): Kv | null {
  if (kv !== undefined) return kv;
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (url && token) kv = new UpstashKv(new Redis({ url, token, automaticDeserialization: false }));
  else kv = process.env.NODE_ENV === "production" && process.env.VERCEL ? null : new FileKv();
  return kv;
}
