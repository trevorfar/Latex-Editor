"use client";

import type { Text } from "@codemirror/state";
import * as db from "./db";
import { dirname, isInFolder, isTexPath, kindForPath, joinPath } from "./paths";
import type { CloudLink, Compiler, FileKind, ProjectFile, ProjectMeta } from "./types";

export interface StoreSnapshot {
  project: ProjectMeta;
  files: ProjectFile[];
  /** All folders: explicit ones plus those implied by file paths. */
  folders: string[];
  currentPath: string | null;
  saveState: "saved" | "saving" | "unsaved" | "error";
  /** Cloud projects are read-only unless this tab holds the editing lock. */
  readOnly: boolean;
}

type Listener = () => void;

export class ProjectStore {
  private snapshot: StoreSnapshot;
  private listeners = new Set<Listener>();
  private contentListeners = new Set<(path: string) => void>();
  private replacedListeners = new Set<(fileId: string) => void>();
  /** Live CodeMirror documents, newer than ProjectFile.content. Keyed by file id. */
  private liveDocs = new Map<string, Text>();
  private dirty = new Set<string>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private contentVersion = 0;

  private constructor(project: ProjectMeta, files: ProjectFile[]) {
    const current =
      (project.lastFile && files.some((f) => f.path === project.lastFile) && project.lastFile) ||
      (files.some((f) => f.path === project.mainFile) ? project.mainFile : files.find((f) => f.kind === "text")?.path) ||
      null;
    this.snapshot = {
      project,
      files,
      folders: computeFolders(project.folders, files),
      currentPath: current,
      saveState: "saved",
      readOnly: false,
    };
  }

  static async load(id: string): Promise<ProjectStore | null> {
    const project = await db.getProject(id);
    if (!project) return null;
    const files = await db.getFiles(id);
    return new ProjectStore(project, files);
  }

  // ----- subscription -----

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };

  getSnapshot = () => this.snapshot;

  /** Fires on every text edit (without re-rendering snapshot subscribers). */
  onContentChange(l: (path: string) => void) {
    this.contentListeners.add(l);
    return () => {
      this.contentListeners.delete(l);
    };
  }

  /** Fires when a file's contents are replaced wholesale (e.g. re-uploaded), so editors drop cached state. */
  onFileReplaced(l: (fileId: string) => void) {
    this.replacedListeners.add(l);
    return () => {
      this.replacedListeners.delete(l);
    };
  }

  get version() {
    return this.contentVersion;
  }

  private set(patch: Partial<StoreSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    if (patch.files || patch.project) {
      this.snapshot.folders = computeFolders(this.snapshot.project.folders, this.snapshot.files);
    }
    this.listeners.forEach((l) => l());
  }

  private bumpContent(path: string) {
    this.contentVersion++;
    this.contentListeners.forEach((l) => l(path));
  }

  // ----- reading -----

  get project() {
    return this.snapshot.project;
  }

  fileByPath(path: string): ProjectFile | undefined {
    return this.snapshot.files.find((f) => f.path === path);
  }

  getText(path: string): string | null {
    const f = this.fileByPath(path);
    if (!f || f.kind !== "text") return null;
    const live = this.liveDocs.get(f.id);
    return live ? live.toString() : (f.content ?? "");
  }

  /** All text files with their latest contents. */
  textFiles(): { path: string; text: string }[] {
    return this.snapshot.files
      .filter((f) => f.kind === "text")
      .map((f) => ({ path: f.path, text: this.getText(f.path) ?? "" }));
  }

  /** Every file as a Blob, ready for the compile request. */
  compileFiles(): { path: string; blob: Blob }[] {
    return this.snapshot.files.map((f) => ({
      path: f.path,
      blob: f.kind === "text" ? new Blob([this.getText(f.path) ?? ""], { type: "text/plain" }) : (f.data ?? new Blob()),
    }));
  }

  // ----- editing -----

  setLiveDoc(fileId: string, doc: Text) {
    if (this.snapshot.readOnly) return;
    const file = this.snapshot.files.find((f) => f.id === fileId);
    if (!file) return;
    this.liveDocs.set(fileId, doc);
    this.dirty.add(fileId);
    if (this.snapshot.saveState !== "unsaved") this.set({ saveState: "unsaved" });
    this.scheduleSave();
    this.bumpContent(file.path);
  }

  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flush(), 700);
  }

  /** Writes pending edits to IndexedDB. */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.dirty.size === 0) return;
    const ids = [...this.dirty];
    this.dirty.clear();
    const now = Date.now();
    const updated: ProjectFile[] = [];
    const files = this.snapshot.files.map((f) => {
      if (!ids.includes(f.id)) return f;
      const content = this.liveDocs.get(f.id)?.toString() ?? f.content ?? "";
      const next = { ...f, content, size: new Blob([content]).size, updatedAt: now };
      updated.push(next);
      return next;
    });
    this.set({ files, saveState: "saving" });
    try {
      await db.putFiles(updated);
      const project = await db.touchProject(this.project.id);
      this.set({ saveState: this.dirty.size ? "unsaved" : "saved", ...(project ? { project } : {}) });
    } catch {
      ids.forEach((id) => this.dirty.add(id));
      this.set({ saveState: "error" });
    }
  }

  // ----- navigation -----

  open(path: string) {
    if (!this.fileByPath(path) || this.snapshot.currentPath === path) return;
    this.set({ currentPath: path });
    void db.touchProject(this.project.id, { lastFile: path }).then((p) => p && (this.snapshot = { ...this.snapshot, project: p }));
  }

  // ----- project settings -----

  setReadOnly(readOnly: boolean) {
    if (this.snapshot.readOnly !== readOnly) this.set({ readOnly });
  }

  get readOnly() {
    return this.snapshot.readOnly;
  }

  async setCloud(cloud: CloudLink | undefined) {
    const project = await db.touchProject(this.project.id, { cloud });
    if (project) this.set({ project });
  }

  /** Replaces the project with the cloud copy. Files keep their ids so open editors stay put. */
  async applyRemote(
    meta: Pick<ProjectMeta, "name" | "mainFile" | "compiler" | "folders">,
    incoming: { path: string; kind: FileKind; content?: string; data?: Blob }[],
    cloud: CloudLink,
  ) {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const existing = new Map(this.snapshot.files.map((f) => [f.path, f]));
    const now = Date.now();
    const changedIds: string[] = [];
    const files: ProjectFile[] = incoming.map((f) => {
      const old = existing.get(f.path);
      const id = old?.id ?? db.newId();
      const same =
        old && old.kind === f.kind && (f.kind === "text" ? (this.getText(f.path) ?? "") === f.content : old.data === f.data);
      if (old && !same) changedIds.push(id);
      return f.kind === "text"
        ? { id, projectId: this.project.id, path: f.path, kind: "text", content: f.content ?? "", size: new Blob([f.content ?? ""]).size, updatedAt: now }
        : { id, projectId: this.project.id, path: f.path, kind: "binary", data: f.data, size: f.data?.size ?? 0, updatedAt: now };
    });
    const keep = new Set(files.map((f) => f.path));
    const removed = this.snapshot.files.filter((f) => !keep.has(f.path));
    await db.deleteFiles(removed.map((f) => f.id));
    await db.putFiles(files);
    for (const id of changedIds) this.liveDocs.delete(id);
    for (const f of removed) this.liveDocs.delete(f.id);
    this.dirty.clear();
    const project = await db.touchProject(this.project.id, { ...meta, cloud });
    const currentPath =
      this.snapshot.currentPath && keep.has(this.snapshot.currentPath)
        ? this.snapshot.currentPath
        : keep.has(meta.mainFile)
          ? meta.mainFile
          : (files.find((f) => f.kind === "text")?.path ?? null);
    this.set({ files: files.sort((a, b) => a.path.localeCompare(b.path)), currentPath, saveState: "saved", ...(project ? { project } : {}) });
    changedIds.forEach((id) => this.replacedListeners.forEach((l) => l(id)));
    if (changedIds.length || removed.length || incoming.length !== existing.size) this.bumpContent(meta.mainFile);
  }

  async updateProject(patch: Partial<Pick<ProjectMeta, "name" | "mainFile" | "compiler" | "folders">>) {
    if (this.snapshot.readOnly) return;
    const project = await db.touchProject(this.project.id, patch);
    if (project) this.set({ project });
  }

  setCompiler(compiler: Compiler) {
    return this.updateProject({ compiler });
  }

  setMainFile(path: string) {
    return this.updateProject({ mainFile: path });
  }

  // ----- file operations -----

  exists(path: string): boolean {
    return this.snapshot.files.some((f) => f.path === path) || this.snapshot.folders.includes(path);
  }

  async createFile(path: string, content: string | Blob = ""): Promise<ProjectFile> {
    if (this.snapshot.readOnly) throw new Error("This project is read-only right now.");
    const kind = kindForPath(path);
    let file: ProjectFile;
    if (kind === "text") {
      const text = typeof content === "string" ? content : await content.text();
      file = { id: db.newId(), projectId: this.project.id, path, kind, content: text, size: new Blob([text]).size, updatedAt: Date.now() };
    } else {
      const data = typeof content === "string" ? new Blob([content]) : content;
      file = { id: db.newId(), projectId: this.project.id, path, kind, data, size: data.size, updatedAt: Date.now() };
    }
    // Replace a file at the same path (uploads overwrite).
    const existing = this.fileByPath(path);
    if (existing) {
      file.id = existing.id;
      this.liveDocs.delete(existing.id);
      this.dirty.delete(existing.id);
      this.replacedListeners.forEach((l) => l(existing.id));
    }
    await db.putFile(file);
    const files = [...this.snapshot.files.filter((f) => f.path !== path), file].sort((a, b) => a.path.localeCompare(b.path));
    this.set({ files });
    void db.touchProject(this.project.id);
    this.bumpContent(path);
    return file;
  }

  async createFolder(path: string) {
    if (this.snapshot.readOnly) throw new Error("This project is read-only right now.");
    if (this.snapshot.folders.includes(path)) return;
    await this.updateProject({ folders: [...this.project.folders, path] });
  }

  /** Moves a file or folder. Returns false when the destination exists. */
  async move(from: string, to: string): Promise<boolean> {
    if (this.snapshot.readOnly) return false;
    if (from === to) return true;
    if (this.exists(to)) return false;
    const isFolder = this.snapshot.folders.includes(from) && !this.fileByPath(from);
    await this.flush();
    const changed = await db.movePaths(this.project.id, from, to, isFolder);
    const byId = new Map(changed.map((f) => [f.id, f]));
    const files = this.snapshot.files.map((f) => byId.get(f.id) ?? f).sort((a, b) => a.path.localeCompare(b.path));

    const remap = (p: string) => (isFolder ? (isInFolder(p, from) || p === from ? to + p.slice(from.length) : p) : p === from ? to : p);
    const folders = this.project.folders.map(remap);
    const mainFile = remap(this.project.mainFile);
    const currentPath = this.snapshot.currentPath ? remap(this.snapshot.currentPath) : null;
    const project = await db.touchProject(this.project.id, { folders, mainFile, lastFile: currentPath ?? undefined });
    this.set({ files, currentPath, ...(project ? { project } : {}) });
    this.bumpContent(to);
    return true;
  }

  async remove(path: string) {
    if (this.snapshot.readOnly) throw new Error("This project is read-only right now.");
    const isFolder = this.snapshot.folders.includes(path) && !this.fileByPath(path);
    const doomed = this.snapshot.files.filter((f) => (isFolder ? isInFolder(f.path, path) : f.path === path));
    await db.deleteFiles(doomed.map((f) => f.id));
    for (const f of doomed) {
      this.liveDocs.delete(f.id);
      this.dirty.delete(f.id);
    }
    const files = this.snapshot.files.filter((f) => !doomed.includes(f));
    const folders = isFolder ? this.project.folders.filter((p) => p !== path && !isInFolder(p, path)) : this.project.folders;
    let currentPath = this.snapshot.currentPath;
    if (currentPath && doomed.some((f) => f.path === currentPath)) {
      currentPath = files.find((f) => f.path === this.project.mainFile)?.path ?? files.find((f) => f.kind === "text")?.path ?? null;
    }
    let mainFile = this.project.mainFile;
    if (doomed.some((f) => f.path === mainFile)) mainFile = files.find((f) => isTexPath(f.path))?.path ?? mainFile;
    const project = await db.touchProject(this.project.id, { folders, mainFile });
    this.set({ files, currentPath, ...(project ? { project } : {}) });
    this.bumpContent(path);
  }

  /** Adds dropped/picked files under `folder`, keeping their relative paths. */
  async upload(items: { path: string; file: Blob }[], folder: string) {
    let last: ProjectFile | null = null;
    for (const item of items) {
      last = await this.createFile(joinPath(folder, item.path), item.file);
    }
    return last;
  }

  /** Suggests a free path like "untitled-2.tex" in `folder`. */
  freePath(folder: string, name: string): string {
    if (!this.exists(joinPath(folder, name))) return joinPath(folder, name);
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    for (let i = 2; ; i++) {
      const candidate = joinPath(folder, `${stem}-${i}${ext}`);
      if (!this.exists(candidate)) return candidate;
    }
  }
}

function computeFolders(explicit: string[], files: ProjectFile[]): string[] {
  const set = new Set<string>();
  const add = (p: string) => {
    while (p) {
      set.add(p);
      p = dirname(p);
    }
  };
  explicit.forEach(add);
  files.forEach((f) => add(dirname(f.path)));
  return [...set].sort();
}

