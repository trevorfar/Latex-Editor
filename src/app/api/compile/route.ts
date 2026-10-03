import { runCompile, selectBackend } from "@/server/compile";
import type { CompileInputFile } from "@/server/compile/types";
import { COMPILERS, type CompileRequestMeta, type CompileResponseHeader } from "@/lib/types";
import { kindForPath, normalizePath } from "@/lib/paths";

export const maxDuration = 120;

const MAX_FILES = 1000;
const MAX_TOTAL_BYTES = (Number(process.env.LATEX_MAX_UPLOAD_MB) || 50) * 1024 * 1024;
const RATE_LIMIT_PER_MINUTE = Number(process.env.LATEX_RATE_LIMIT) || 40;

// Best-effort per-instance limiter; enough to stop a runaway client loop.
const hits = new Map<string, number[]>();
function rateLimited(key: string): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > RATE_LIMIT_PER_MINUTE;
}

function jsonError(status: number, message: string) {
  return Response.json({ error: message }, { status });
}

export async function GET() {
  return Response.json({ backend: await selectBackend() });
}

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (rateLimited(ip)) return jsonError(429, "Too many compiles. Wait a few seconds.");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(400, "Expected multipart form data.");
  }

  let meta: CompileRequestMeta;
  try {
    meta = JSON.parse(String(form.get("meta")));
  } catch {
    return jsonError(400, "Missing compile metadata.");
  }
  if (!COMPILERS.some((c) => c.id === meta.compiler)) return jsonError(400, "Unknown compiler.");
  if (typeof meta.projectId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(meta.projectId)) return jsonError(400, "Bad project id.");
  if (!Array.isArray(meta.paths) || meta.paths.length > MAX_FILES) return jsonError(400, "Too many files.");

  const files: CompileInputFile[] = [];
  let total = 0;
  for (let i = 0; i < meta.paths.length; i++) {
    const p = normalizePath(String(meta.paths[i]));
    const entry = form.get(`file:${i}`);
    if (!p || p !== meta.paths[i] || !(entry instanceof Blob)) return jsonError(400, `Bad file entry: ${meta.paths[i]}`);
    total += entry.size;
    if (total > MAX_TOTAL_BYTES) return jsonError(413, "Project is too large to compile.");
    files.push({ path: p, data: new Uint8Array(await entry.arrayBuffer()), isText: kindForPath(p) === "text" });
  }
  if (!files.some((f) => f.path === meta.mainFile)) return jsonError(400, `Main file "${meta.mainFile}" is not in the project.`);

  const backend = await selectBackend();
  const started = Date.now();
  const result = await runCompile(
    {
      projectId: meta.projectId,
      compiler: meta.compiler,
      mainFile: meta.mainFile,
      stopOnFirstError: Boolean(meta.stopOnFirstError),
      files,
    },
    backend,
  );

  const header: CompileResponseHeader = {
    status: result.status,
    backend,
    compiler: meta.compiler,
    durationMs: Date.now() - started,
    log: result.log,
    output: result.output,
    message: result.message,
    pdfSize: result.pdf?.length ?? 0,
    synctexSize: result.synctex?.length ?? 0,
  };

  // Body: [u32 header length][JSON header][PDF bytes][synctex.gz bytes]
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const body = new Uint8Array(4 + headerBytes.length + header.pdfSize + header.synctexSize);
  new DataView(body.buffer).setUint32(0, headerBytes.length);
  body.set(headerBytes, 4);
  if (result.pdf) body.set(result.pdf, 4 + headerBytes.length);
  if (result.synctex) body.set(result.synctex, 4 + headerBytes.length + header.pdfSize);

  return new Response(body, {
    headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-store" },
  });
}
