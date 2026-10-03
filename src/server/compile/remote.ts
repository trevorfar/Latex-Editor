import "server-only";
import type { CompileJob, CompileResult } from "./types";

/**
 * LaTeX-On-HTTP (https://github.com/YtoTech/latex-on-http). The public instance is the default;
 * set LATEX_REMOTE_URL to a self-hosted one (docker image yoarch/latex-on-http) for production.
 */
const REMOTE_URL = (process.env.LATEX_REMOTE_URL || "https://latex.ytotech.com").replace(/\/+$/, "");
const TIMEOUT_MS = Number(process.env.LATEX_TIMEOUT_MS) || 90_000;

type Attempt =
  | { kind: "pdf"; pdf: Uint8Array }
  | { kind: "latex-error"; log: string | null; output: string | null }
  | { kind: "error"; message: string };

const decoder = new TextDecoder();

async function attempt(job: CompileJob, haltOnError: boolean): Promise<Attempt> {
  const main = job.files.find((f) => f.path === job.mainFile);
  if (!main) return { kind: "error", message: `Main file "${job.mainFile}" is missing.` };

  const resources = [
    { main: true, content: decoder.decode(main.data) },
    ...job.files
      .filter((f) => f !== main)
      .map((f) =>
        f.isText
          ? { path: f.path, content: decoder.decode(f.data) }
          : { path: f.path, file: Buffer.from(f.data).toString("base64") },
      ),
  ];

  let res: Response;
  try {
    res = await fetch(`${REMOTE_URL}/builds/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        compiler: job.compiler,
        resources,
        options: {
          compiler: { halt_on_error: haltOnError, bibliography: true },
          response: { log_files_on_failure: true },
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return {
      kind: "error",
      message: timedOut
        ? `The compile service didn't respond within ${Math.round(TIMEOUT_MS / 1000)}s.`
        : `Couldn't reach the compile service (${REMOTE_URL}).`,
    };
  }

  const type = res.headers.get("content-type") ?? "";
  if (res.ok && type.includes("application/pdf")) {
    return { kind: "pdf", pdf: new Uint8Array(await res.arrayBuffer()) };
  }

  const text = await res.text();
  try {
    const body = JSON.parse(text) as {
      error?: string;
      logs?: string;
      log_files?: Record<string, string>;
    };
    if (body.error === "COMPILATION_ERROR") {
      const logs = body.log_files ?? {};
      const logName = Object.keys(logs).find((k) => k.endsWith(".log"));
      return { kind: "latex-error", log: logName ? logs[logName] : null, output: body.logs ?? null };
    }
    if (res.status === 429) return { kind: "error", message: "The compile service is rate limiting requests. Wait a moment and try again." };
    return { kind: "error", message: `Compile service error: ${body.error ?? res.status}` };
  } catch {
    return { kind: "error", message: `Compile service returned HTTP ${res.status}.` };
  }
}

export async function compileRemote(job: CompileJob): Promise<CompileResult> {
  // Halting on the first error is the only way to learn whether errors exist:
  // the service returns logs only when compilation fails.
  const first = await attempt(job, true);
  if (first.kind === "pdf") {
    return { status: "success", pdf: first.pdf, log: null, output: null, synctex: null };
  }
  if (first.kind === "error") {
    return { status: "error", message: first.message, pdf: null, log: null, output: null, synctex: null };
  }

  let pdf: Uint8Array | null = null;
  if (!job.stopOnFirstError) {
    // Try again without halting, to show whatever LaTeX manages to typeset.
    const second = await attempt(job, false);
    if (second.kind === "pdf") pdf = second.pdf;
  }
  return { status: "failure", pdf, log: first.log, output: first.output, synctex: null };
}
