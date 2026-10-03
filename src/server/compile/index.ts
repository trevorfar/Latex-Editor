import "server-only";
import { compileLocal, localAvailable } from "./local";
import { compileRemote } from "./remote";
import type { CompileJob, CompileResult } from "./types";

export type Backend = "local" | "remote";

/** LATEX_BACKEND=local|remote|auto (default auto: local when latexmk is installed). */
export async function selectBackend(): Promise<Backend> {
  const pref = (process.env.LATEX_BACKEND || "auto").toLowerCase();
  if (pref === "local" || pref === "remote") return pref;
  return (await localAvailable()) ? "local" : "remote";
}

export async function runCompile(job: CompileJob, backend: Backend): Promise<CompileResult> {
  return backend === "local" ? compileLocal(job) : compileRemote(job);
}
