import type { CompileStatus, Compiler } from "@/lib/types";

export interface CompileInputFile {
  path: string;
  data: Uint8Array;
  isText: boolean;
}

export interface CompileJob {
  projectId: string;
  compiler: Compiler;
  mainFile: string;
  stopOnFirstError: boolean;
  files: CompileInputFile[];
}

export interface CompileResult {
  status: CompileStatus;
  log: string | null;
  output: string | null;
  message?: string;
  pdf: Uint8Array | null;
  synctex: Uint8Array | null;
}
