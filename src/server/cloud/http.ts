import "server-only";
import { CloudError } from "./service";
import { normalizeCode } from "@/lib/cloud-types";

const hits = new Map<string, number[]>();

/** Best-effort per-instance limiter (slows down code guessing). */
export function limit(request: Request, bucket: string, perMinute: number) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 10_000) hits.clear();
  if (recent.length > perMinute) throw new CloudError(429, "Too many requests. Wait a minute and try again.");
}

export function codeParam(raw: string): string {
  const code = normalizeCode(raw);
  if (!code) throw new CloudError(404, "That doesn't look like a project code.");
  return code;
}

export async function handle(fn: () => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await fn(), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof CloudError) return Response.json({ error: err.message }, { status: err.status });
    console.error(err);
    return Response.json({ error: "Cloud request failed." }, { status: 500 });
  }
}
