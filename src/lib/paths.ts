import type { FileKind } from "./types";

const TEXT_EXTENSIONS = new Set([
  "tex", "ltx", "latex", "sty", "cls", "bib", "bst", "bbx", "cbx", "def", "cfg", "clo",
  "dtx", "ins", "txt", "md", "csv", "dat", "tsv", "json", "xml", "yaml", "yml", "lua",
  "py", "m", "r", "c", "h", "cpp", "java", "js", "ts", "sh", "tikz", "pgf", "asy",
  "gnuplot", "plt", "latexmkrc", "ist", "gst", "mk", "makefile", "glo", "nlo", "lbx",
  "dbx", "rtx", "fd", "inc", "sql", "html", "css", "svg", "toml", "ini", "log",
]);

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]);

export function extname(path: string): string {
  const base = basename(path);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return base.startsWith(".") ? base.slice(1).toLowerCase() : "";
  return base.slice(dot + 1).toLowerCase();
}

export function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

export function stripExtension(path: string): string {
  const base = basename(path);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? path : path.slice(0, path.length - (base.length - dot));
}

export function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

export function kindForPath(path: string): FileKind {
  const ext = extname(path);
  if (!ext) return "text";
  return TEXT_EXTENSIONS.has(ext) ? "text" : "binary";
}

export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(path));
}

export function isTexPath(path: string): boolean {
  const ext = extname(path);
  return ext === "tex" || ext === "ltx" || ext === "latex";
}

export function isBibPath(path: string): boolean {
  return extname(path) === "bib";
}

/** Files LaTeX can include with \includegraphics. */
export function isGraphicPath(path: string): boolean {
  return ["png", "jpg", "jpeg", "pdf", "eps"].includes(extname(path));
}

/**
 * Normalises a user-entered path: forward slashes, no leading/trailing slashes,
 * no empty or dot segments. Returns null when the path is unusable.
 */
export function normalizePath(input: string): string | null {
  const parts = input.replace(/\\/g, "/").split("/").map((p) => p.trim());
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") return null;
    if (/[\u0000-\u001f<>:"|?*]/.test(part)) return null;
    out.push(part);
  }
  if (out.length === 0) return null;
  return out.join("/");
}

export function isInFolder(path: string, folder: string): boolean {
  return folder === "" || path.startsWith(folder + "/");
}

export function mimeForPath(path: string): string {
  switch (extname(path)) {
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    case "bmp": return "image/bmp";
    case "svg": return "image/svg+xml";
    case "pdf": return "application/pdf";
    case "eps": return "application/postscript";
    default: return kindForPath(path) === "text" ? "text/plain" : "application/octet-stream";
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
