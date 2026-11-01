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
  save(opts: { filesKey: string; metaKey: string; put: Record<string, string>; del: string[]; meta: string; ttlSeconds: number; expectedMeta: string; presenceKey: string; expectedPresence: string }): Promise<boolean>;
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

  async save({ filesKey, metaKey, put, del, meta, ttlSeconds, expectedMeta, presenceKey, expectedPresence }: Parameters<Kv["save"]>[0]) {
    const ok = await this.redis.eval(`
      if redis.call('GET', KEYS[2]) ~= ARGV[1] or redis.call('GET', KEYS[3]) ~= ARGV[2] then return 0 end
      local puts = cjson.decode(ARGV[3])
      for k,v in pairs(puts) do redis.call('HSET', KEYS[1], k, v) end
      for _,k in ipairs(cjson.decode(ARGV[4])) do redis.call('HDEL', KEYS[1], k) end
      redis.call('SET', KEYS[2], ARGV[5], 'EX', ARGV[6])
      redis.call('EXPIRE', KEYS[1], ARGV[6])
      return 1
    `, [filesKey, metaKey, presenceKey], [expectedMeta, expectedPresence, JSON.stringify(put), JSON.stringify(del), meta, ttlSeconds]);
    return Number(ok) === 1;
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

  save({ filesKey, metaKey, put, del, meta, expectedMeta, presenceKey, expectedPresence }: Parameters<Kv["save"]>[0]) {
    return this.locked(async () => {
      if (await this.read<string>(metaKey) !== expectedMeta || await this.read<string>(presenceKey) !== expectedPresence) return false;
      const h = { ...((await this.read<Record<string, string>>(filesKey)) ?? {}), ...put };
      for (const d of del) delete h[d];
      await this.write(filesKey, h);
      await this.write(metaKey, meta);
      return true;
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
