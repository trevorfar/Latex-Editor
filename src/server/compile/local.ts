import "server-only";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CompileJob, CompileResult } from "./types";

const CACHE_DIR = process.env.LATEX_CACHE_DIR || path.join(os.tmpdir(), "latex-studio");
const TIMEOUT_MS = Number(process.env.LATEX_TIMEOUT_MS) || 90_000;
const MAX_CONCURRENT = Number(process.env.LATEX_MAX_CONCURRENT) || 3;
const MANIFEST = ".latex-studio-files.json";
const OUTPUT_LIMIT = 512 * 1024;
const STALE_MS = 24 * 60 * 60 * 1000;

function binary(name: string): string {
  const dir = process.env.LATEX_BIN_DIR;
  return dir ? path.join(dir, name) : name;
}

let availability: Promise<boolean> | null = null;

/** True when latexmk can be run on this server. Cached for the process lifetime. */
export function localAvailable(): Promise<boolean> {
  availability ??= new Promise((resolve) => {
    try {
      const child = spawn(binary("latexmk"), ["-v"], { stdio: "ignore" });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve(false);
      }, 5000);
      child.on("error", () => {
        clearTimeout(timer);
        resolve(false);
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        resolve(code === 0);
      });
    } catch {
      resolve(false);
    }
  });
  return availability;
}

// Per-project serialisation (compiles share a build directory) plus a global cap.
const projectLocks = new Map<string, Promise<unknown>>();
let running = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) await new Promise<void>((r) => waiting.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

function withProjectLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = projectLocks.get(id) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  projectLocks.set(id, next);
  next.finally(() => {
    if (projectLocks.get(id) === next) projectLocks.delete(id);
  }).catch(() => undefined);
  return next;
}

/** Files a project must never write: latexmk rc files would run arbitrary Perl. */
function isForbidden(p: string): boolean {
  const base = path.posix.basename(p).toLowerCase();
  return base === "latexmkrc" || base === ".latexmkrc" || base === MANIFEST;
}

function safeJoin(root: string, rel: string): string | null {
  if (!rel || rel.includes("\0") || path.posix.isAbsolute(rel) || rel.split("/").includes("..")) return null;
  const full = path.join(root, rel);
  return full.startsWith(root + path.sep) ? full : null;
}

async function syncFiles(dir: string, job: CompileJob): Promise<void> {
  await mkdir(dir, { recursive: true });
  let previous: string[] = [];
  try {
    previous = JSON.parse(await readFile(path.join(dir, MANIFEST), "utf8"));
  } catch {
    // First compile in this directory.
  }
  const current = new Set<string>();
  for (const f of job.files) {
    if (isForbidden(f.path)) continue;
    const full = safeJoin(dir, f.path);
    if (!full) continue;
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, f.data);
    current.add(f.path);
  }
  // Remove files the user deleted or renamed since the last compile.
  for (const p of previous) {
    if (current.has(p)) continue;
    const full = safeJoin(dir, p);
    if (full) await rm(full, { force: true });
  }
  await writeFile(path.join(dir, MANIFEST), JSON.stringify([...current]));
}

function run(cmd: string, args: string[], cwd: string): Promise<{ code: number | null; output: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const binDir = process.env.LATEX_BIN_DIR;
    const child = spawn(cmd, args, {
      cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PATH: binDir ? `${binDir}${path.delimiter}${process.env.PATH ?? ""}` : process.env.PATH,
        // Long log lines instead of TeX's 79-column wrapping: simpler, more reliable parsing.
        max_print_line: "10000",
        error_line: "254",
        half_error_line: "238",
        // Projects may only write inside the build directory and read relative paths.
        openout_any: "p",
        openin_any: process.env.LATEX_OPENIN_ANY || "p",
      },
    });
    let output = "";
    const collect = (chunk: Buffer) => {
      if (output.length < OUTPUT_LIMIT) output += chunk.toString("utf8");
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: -1, output: output + `\n${err.message}`, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output, timedOut });
    });
  });
}

async function mtime(p: string): Promise<number | null> {
  try {
    return (await stat(p)).mtimeMs;
  } catch {
    return null;
  }
}

async function readIfExists(p: string): Promise<Buffer | null> {
  try {
    return await readFile(p);
  } catch {
    return null;
  }
}

let lastSweep = 0;
async function sweepStaleBuilds(): Promise<void> {
  if (Date.now() - lastSweep < 60 * 60 * 1000) return;
  lastSweep = Date.now();
  try {
    for (const name of await readdir(/*turbopackIgnore: true*/ CACHE_DIR)) {
      const dir = path.join(CACHE_DIR, name);
      const s = await stat(dir);
      if (Date.now() - s.mtimeMs > STALE_MS) await rm(dir, { recursive: true, force: true });
    }
  } catch {
    // Cache dir may not exist yet.
  }
}

const ENGINE_FLAG = { pdflatex: "-pdf", xelatex: "-pdfxe", lualatex: "-pdflua" } as const;

export function compileLocal(job: CompileJob): Promise<CompileResult> {
  const dir = path.join(CACHE_DIR, job.projectId);
  return withProjectLock(job.projectId, () =>
    withSlot(async () => {
      void sweepStaleBuilds();
      await syncFiles(dir, job);

      const jobname = path.posix.basename(job.mainFile).replace(/\.[^.]+$/, "");
      const pdfPath = path.join(dir, `${jobname}.pdf`);
      const synctexPath = path.join(dir, `${jobname}.synctex.gz`);
      const pdfBefore = await mtime(pdfPath);

      const args = (force: boolean) => [
        "-norc",
        ENGINE_FLAG[job.compiler],
        "-interaction=nonstopmode",
        "-file-line-error",
        "-synctex=1",
        // Default is TeX Live's restricted shell escape (only whitelisted tools such as epstopdf).
        ...(process.env.LATEX_SHELL_ESCAPE === "1" ? ["-shell-escape"] : []),
        job.stopOnFirstError ? "-halt-on-error" : "-f",
        ...(force ? ["-g"] : []),
        job.mainFile,
      ];
      let { code, output, timedOut } = await run(binary("latexmk"), args(false), dir);
      // latexmk declines to rerun when sources are unchanged since a failed run; force a
      // fresh run so the log and PDF reflect this request.
      if (!timedOut && code !== 0 && (await mtime(pdfPath)) === pdfBefore) {
        ({ code, output, timedOut } = await run(binary("latexmk"), args(true), dir));
      }
      // A PDF that wasn't rewritten is only trustworthy when latexmk reports success (up to date).
      const regenerated = (await mtime(pdfPath)) !== pdfBefore;
      const pdfValid = code === 0 || regenerated;

      const [pdf, synctex, logBuf] = await Promise.all([
        pdfValid ? readIfExists(pdfPath) : null,
        pdfValid ? readIfExists(synctexPath) : null,
        readIfExists(path.join(dir, `${jobname}.log`)),
      ]);
      const log = logBuf ? logBuf.toString("utf8") : null;

      if (timedOut) {
        return {
          status: "error",
          message: `Compile timed out after ${Math.round(TIMEOUT_MS / 1000)}s. Check for infinite loops, or very large images.`,
          log,
          output,
          pdf: null,
          synctex: null,
        };
      }
      if (!pdf && !log) {
        return { status: "error", message: "LaTeX did not run. See the raw output for details.", log, output, pdf: null, synctex: null };
      }
      return {
        status: code === 0 && pdf ? "success" : "failure",
        log,
        output,
        pdf: pdf ? new Uint8Array(pdf) : null,
        synctex: pdf && synctex ? new Uint8Array(synctex) : null,
      };
    }),
  );
}
