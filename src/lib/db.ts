"use client";

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { ProjectFile, ProjectMeta } from "./types";
import { isInFolder } from "./paths";

interface OutputRecord {
  projectId: string;
  pdf: Blob;
  synctex?: Blob;
  compiledAt: number;
}

interface LatexDB extends DBSchema {
  projects: { key: string; value: ProjectMeta; indexes: { updatedAt: number } };
  files: { key: string; value: ProjectFile; indexes: { projectId: string } };
  outputs: { key: string; value: OutputRecord };
}

let dbPromise: Promise<IDBPDatabase<LatexDB>> | null = null;

function db() {
  if (!dbPromise) {
    dbPromise = openDB<LatexDB>("latex-studio", 1, {
      upgrade(database) {
        const projects = database.createObjectStore("projects", { keyPath: "id" });
        projects.createIndex("updatedAt", "updatedAt");
        const files = database.createObjectStore("files", { keyPath: "id" });
        files.createIndex("projectId", "projectId");
        database.createObjectStore("outputs", { keyPath: "projectId" });
      },
    });
  }
  return dbPromise;
}

export function newId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 20);
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const all = await (await db()).getAll("projects");
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id: string): Promise<ProjectMeta | undefined> {
  return (await db()).get("projects", id);
}

export async function putProject(project: ProjectMeta): Promise<void> {
  await (await db()).put("projects", project);
}

export async function touchProject(id: string, patch: Partial<ProjectMeta> = {}): Promise<ProjectMeta | undefined> {
  const d = await db();
  const tx = d.transaction("projects", "readwrite");
  const project = await tx.store.get(id);
  if (!project) return undefined;
  const next = { ...project, ...patch, updatedAt: Date.now() };
  await tx.store.put(next);
  await tx.done;
  return next;
}

export async function getFiles(projectId: string): Promise<ProjectFile[]> {
  const files = await (await db()).getAllFromIndex("files", "projectId", projectId);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export async function putFile(file: ProjectFile): Promise<void> {
  await (await db()).put("files", file);
}

export async function putFiles(files: ProjectFile[]): Promise<void> {
  const tx = (await db()).transaction("files", "readwrite");
  await Promise.all([...files.map((f) => tx.store.put(f)), tx.done]);
}

export async function deleteFiles(ids: string[]): Promise<void> {
  const tx = (await db()).transaction("files", "readwrite");
  await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
}

export async function createProject(
  meta: Omit<ProjectMeta, "id" | "createdAt" | "updatedAt">,
  files: { path: string; kind: ProjectFile["kind"]; content?: string; data?: Blob }[],
): Promise<ProjectMeta> {
  const now = Date.now();
  const project: ProjectMeta = { ...meta, id: newId(), createdAt: now, updatedAt: now };
  const d = await db();
  const tx = d.transaction(["projects", "files"], "readwrite");
  await tx.objectStore("projects").put(project);
  for (const f of files) {
    await tx.objectStore("files").put({
      id: newId(),
      projectId: project.id,
      path: f.path,
      kind: f.kind,
      content: f.kind === "text" ? (f.content ?? "") : undefined,
      data: f.kind === "binary" ? f.data : undefined,
      size: f.kind === "text" ? new Blob([f.content ?? ""]).size : (f.data?.size ?? 0),
      updatedAt: now,
    });
  }
  await tx.done;
  return project;
}

export async function deleteProject(id: string): Promise<void> {
  const d = await db();
  const fileIds = await d.getAllKeysFromIndex("files", "projectId", id);
  const tx = d.transaction(["projects", "files", "outputs"], "readwrite");
  await tx.objectStore("projects").delete(id);
  for (const fid of fileIds) await tx.objectStore("files").delete(fid);
  await tx.objectStore("outputs").delete(id);
  await tx.done;
}

export async function duplicateProject(id: string, name: string): Promise<ProjectMeta | undefined> {
  const project = await getProject(id);
  if (!project) return undefined;
  const files = await getFiles(id);
  return createProject(
    { name, mainFile: project.mainFile, compiler: project.compiler, folders: project.folders, lastFile: project.lastFile },
    files.map((f) => ({ path: f.path, kind: f.kind, content: f.content, data: f.data })),
  );
}

/** Renames a file or every file under a folder (when `isFolder`). Returns the updated files. */
export async function movePaths(
  projectId: string,
  from: string,
  to: string,
  isFolder: boolean,
): Promise<ProjectFile[]> {
  const files = await getFiles(projectId);
  const changed: ProjectFile[] = [];
  for (const f of files) {
    if (isFolder ? isInFolder(f.path, from) : f.path === from) {
      changed.push({ ...f, path: isFolder ? to + f.path.slice(from.length) : to, updatedAt: Date.now() });
    }
  }
  await putFiles(changed);
  return changed;
}

export async function saveOutput(projectId: string, pdf: Blob, synctex?: Blob): Promise<void> {
  await (await db()).put("outputs", { projectId, pdf, synctex, compiledAt: Date.now() });
}

export async function getOutput(projectId: string): Promise<OutputRecord | undefined> {
  return (await db()).get("outputs", projectId);
}

/** Approximate bytes used by this origin, when the browser exposes it. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usage, quota };
}

export async function requestPersistentStorage(): Promise<void> {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch {
    // Not supported; projects still save, the browser may just evict them under pressure.
  }
}
