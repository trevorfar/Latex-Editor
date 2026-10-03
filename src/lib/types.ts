export type Compiler = "pdflatex" | "xelatex" | "lualatex";

export const COMPILERS: { id: Compiler; label: string }[] = [
  { id: "pdflatex", label: "pdfLaTeX" },
  { id: "xelatex", label: "XeLaTeX" },
  { id: "lualatex", label: "LuaLaTeX" },
];

export interface ProjectMeta {
  id: string;
  name: string;
  /** Path of the root document, e.g. "main.tex". */
  mainFile: string;
  compiler: Compiler;
  /** Folders that exist even when empty. Folders holding files are implied by file paths. */
  folders: string[];
  createdAt: number;
  updatedAt: number;
  /** Last file open in the editor. */
  lastFile?: string;
}

export type FileKind = "text" | "binary";

export interface ProjectFile {
  id: string;
  projectId: string;
  path: string;
  kind: FileKind;
  /** Text files only. */
  content?: string;
  /** Binary files only. */
  data?: Blob;
  size: number;
  updatedAt: number;
}

/** Sent as the `meta` field of the multipart compile request. */
export interface CompileRequestMeta {
  projectId: string;
  compiler: Compiler;
  mainFile: string;
  stopOnFirstError: boolean;
  /** Paths of the files, index-aligned with the `file:<i>` form fields. */
  paths: string[];
}

export type CompileStatus = "success" | "failure" | "error";

export interface CompileResponseHeader {
  /** success: PDF without errors. failure: LaTeX errors (a PDF may still exist). error: the compile could not run. */
  status: CompileStatus;
  backend: "local" | "remote";
  compiler: Compiler;
  durationMs: number;
  /** The main .log file. Null when the backend does not return one (remote success). */
  log: string | null;
  /** latexmk console output, when available. */
  output: string | null;
  message?: string;
  pdfSize: number;
  synctexSize: number;
}
