"use client";

import { useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  FileCode2,
  FileImage,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  BookOpen,
  MoreHorizontal,
  Star,
  Upload,
  File as FileIcon,
  Pencil,
  Trash2,
  Download,
} from "lucide-react";
import { basename, dirname, extname, isImagePath, isInFolder, isTexPath, joinPath, normalizePath } from "@/lib/paths";
import type { ProjectStore, StoreSnapshot } from "@/lib/project-store";
import { ContextMenu, type MenuEntry } from "@/components/ui/Menu";
import { useDialogs } from "@/components/ui/dialogs";
import { toast } from "@/components/ui/toast";
import { filesFromZip } from "@/lib/zip";

interface Node {
  name: string;
  path: string;
  folder: boolean;
  children: Node[];
}

function buildTree(snapshot: StoreSnapshot): Node[] {
  const root: Node = { name: "", path: "", folder: true, children: [] };
  const folders = new Map<string, Node>([["", root]]);
  for (const f of snapshot.folders) {
    const node: Node = { name: basename(f), path: f, folder: true, children: [] };
    folders.set(f, node);
  }
  for (const f of snapshot.folders) folders.get(dirname(f))?.children.push(folders.get(f)!);
  for (const f of snapshot.files) {
    folders.get(dirname(f.path))?.children.push({ name: basename(f.path), path: f.path, folder: false, children: [] });
  }
  const sort = (n: Node) => {
    n.children.sort((a, b) => (a.folder === b.folder ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.folder ? -1 : 1));
    n.children.forEach(sort);
  };
  sort(root);
  return root.children;
}

function iconFor(path: string) {
  const ext = extname(path);
  if (isTexPath(path) || ["sty", "cls"].includes(ext)) return <FileCode2 size={15} className="text-accent" />;
  if (ext === "bib") return <BookOpen size={15} className="text-info" />;
  if (isImagePath(path) || ext === "pdf" || ext === "eps") return <FileImage size={15} className="text-warning" />;
  if (["txt", "md", "csv", "dat"].includes(ext)) return <FileText size={15} className="text-fg-muted" />;
  return <FileIcon size={15} className="text-fg-muted" />;
}

/** Reads files from a drop, including folder trees (webkitGetAsEntry). */
async function readDrop(dt: DataTransfer): Promise<{ path: string; file: File }[]> {
  const out: { path: string; file: File }[] = [];
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];
  if (entries.length === 0) {
    return [...dt.files].map((file) => ({ path: file.name, file }));
  }
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      out.push({ path: prefix + entry.name, file });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      let batch: FileSystemEntry[];
      do {
        batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
      } while (batch.length > 0);
    }
  };
  for (const e of entries) await walk(e, "");
  return out;
}

interface FileTreeProps {
  store: ProjectStore;
  snapshot: StoreSnapshot;
  onOpen: (path: string) => void;
}

export function FileTree({ store, snapshot, onOpen }: FileTreeProps) {
  const tree = useMemo(() => buildTree(snapshot), [snapshot]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const uploadFolder = useRef("");
  const dialogs = useDialogs();
  const { project, currentPath } = snapshot;

  const validateName = (folder: string, current?: string) => (name: string) => {
    if (name.includes("/") && !normalizePath(name)) return "Invalid name";
    const p = normalizePath(joinPath(folder, name));
    if (!p) return "Invalid name";
    if (p !== current && store.exists(p)) return "A file or folder with that name already exists";
    return null;
  };

  const newFile = async (folder: string) => {
    const name = await dialogs.prompt({
      title: "New file",
      label: folder ? `In ${folder}/` : "In the project root",
      initial: "untitled.tex",
      selectLength: 8,
      confirmLabel: "Create",
      validate: validateName(folder),
    });
    if (!name) return;
    const path = normalizePath(joinPath(folder, name))!;
    await store.createFile(path, "");
    onOpen(path);
  };

  const newFolder = async (folder: string) => {
    const name = await dialogs.prompt({ title: "New folder", label: folder ? `In ${folder}/` : undefined, confirmLabel: "Create", validate: validateName(folder) });
    if (!name) return;
    await store.createFolder(normalizePath(joinPath(folder, name))!);
    setCollapsed((c) => {
      const n = new Set(c);
      n.delete(folder);
      return n;
    });
  };

  const rename = async (node: Node) => {
    const folder = dirname(node.path);
    const dot = node.name.lastIndexOf(".");
    const name = await dialogs.prompt({
      title: `Rename ${node.folder ? "folder" : "file"}`,
      initial: node.name,
      selectLength: !node.folder && dot > 0 ? dot : undefined,
      confirmLabel: "Rename",
      validate: validateName(folder, node.path),
    });
    if (!name) return;
    const to = normalizePath(joinPath(folder, name))!;
    if (!(await store.move(node.path, to))) toast("Something already exists at that path.", "error");
  };

  const remove = async (node: Node) => {
    const count = node.folder ? snapshot.files.filter((f) => isInFolder(f.path, node.path)).length : 1;
    const ok = await dialogs.confirm({
      title: `Delete ${node.folder ? "folder" : "file"}?`,
      message: node.folder ? `"${node.path}" and the ${count} file${count === 1 ? "" : "s"} inside it will be deleted.` : `"${node.path}" will be deleted.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok) await store.remove(node.path);
  };

  const download = (path: string) => {
    const f = store.fileByPath(path);
    if (!f) return;
    const blob = f.kind === "text" ? new Blob([store.getText(path) ?? ""], { type: "text/plain" }) : (f.data ?? new Blob());
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = basename(path);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const upload = async (items: { path: string; file: File }[], folder: string) => {
    if (items.length === 0) return;
    const expanded: { path: string; file: Blob }[] = [];
    for (const item of items) {
      if (extname(item.path) === "zip") {
        const extract = await dialogs.confirm({
          title: "Extract zip?",
          message: `Add the contents of "${item.path}" to ${folder ? `"${folder}/"` : "the project"}? Choose Cancel to upload the .zip file itself.`,
          confirmLabel: "Extract",
        });
        if (extract) {
          for (const f of filesFromZip(new Uint8Array(await item.file.arrayBuffer()))) {
            expanded.push({ path: f.path, file: f.kind === "text" ? new Blob([f.content ?? ""]) : f.data! });
          }
          continue;
        }
      }
      const p = normalizePath(item.path);
      if (p) expanded.push({ path: p, file: item.file });
    }
    const overwrite = expanded.filter((i) => store.fileByPath(joinPath(folder, i.path)));
    if (overwrite.length > 0) {
      const ok = await dialogs.confirm({
        title: "Replace files?",
        message: `${overwrite.length} file${overwrite.length === 1 ? "" : "s"} already exist${overwrite.length === 1 ? "s" : ""} (${overwrite
          .slice(0, 3)
          .map((o) => o.path)
          .join(", ")}${overwrite.length > 3 ? ", …" : ""}). Replace?`,
        confirmLabel: "Replace",
      });
      if (!ok) return;
    }
    await store.upload(expanded, folder);
    toast(`Uploaded ${expanded.length} file${expanded.length === 1 ? "" : "s"}.`, "success");
  };

  const entriesFor = (node: Node | null): MenuEntry[] => {
    const folder = node ? (node.folder ? node.path : dirname(node.path)) : "";
    const entries: MenuEntry[] = [];
    if (node && !node.folder) {
      if (isTexPath(node.path) && node.path !== project.mainFile) {
        entries.push({ label: "Set as main document", icon: <Star size={14} />, onSelect: () => void store.setMainFile(node.path) });
      }
      entries.push({ label: "Download", icon: <Download size={14} />, onSelect: () => download(node.path) });
    }
    if (node) {
      entries.push(
        { label: "Rename", icon: <Pencil size={14} />, onSelect: () => void rename(node) },
        { label: "Delete", icon: <Trash2 size={14} />, danger: true, onSelect: () => void remove(node) },
        { separator: true },
      );
    }
    entries.push(
      { label: "New file", icon: <FilePlus2 size={14} />, onSelect: () => void newFile(folder) },
      { label: "New folder", icon: <FolderPlus size={14} />, onSelect: () => void newFolder(folder) },
      {
        label: "Upload files",
        icon: <Upload size={14} />,
        onSelect: () => {
          uploadFolder.current = folder;
          uploadRef.current?.click();
        },
      },
    );
    return entries;
  };

  // ----- drag and drop -----
  const onDragStart = (e: React.DragEvent, node: Node) => {
    e.dataTransfer.setData("application/x-texbench-path", node.path);
    e.dataTransfer.effectAllowed = "move";
  };

  const dropFolderFor = (node: Node | null) => (node ? (node.folder ? node.path : dirname(node.path)) : "");

  const onDragOver = (e: React.DragEvent, node: Node | null) => {
    const internal = e.dataTransfer.types.includes("application/x-texbench-path");
    const external = e.dataTransfer.types.includes("Files");
    if (!internal && !external) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = internal ? "move" : "copy";
    setDropTarget(dropFolderFor(node));
  };

  const onDrop = async (e: React.DragEvent, node: Node | null) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    const folder = dropFolderFor(node);
    const from = e.dataTransfer.getData("application/x-texbench-path");
    if (from) {
      if (folder === from || isInFolder(folder, from) || dirname(from) === folder) return;
      const to = joinPath(folder, basename(from));
      if (!(await store.move(from, to))) toast(`"${to}" already exists.`, "error");
      return;
    }
    await upload(await readDrop(e.dataTransfer), folder);
  };

  const renderNode = (node: Node, depth: number) => {
    const isOpen = node.folder && !collapsed.has(node.path);
    const active = !node.folder && node.path === currentPath;
    const isDrop = node.folder && dropTarget === node.path;
    return (
      <li key={node.path}>
        <div
          draggable
          onDragStart={(e) => onDragStart(e, node)}
          onDragOver={(e) => onDragOver(e, node)}
          onDragLeave={() => setDropTarget(null)}
          onDrop={(e) => void onDrop(e, node)}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, entries: entriesFor(node) });
          }}
          onClick={() => {
            if (node.folder) {
              setCollapsed((c) => {
                const n = new Set(c);
                if (n.has(node.path)) n.delete(node.path);
                else n.add(node.path);
                return n;
              });
            } else onOpen(node.path);
          }}
          className={`group flex h-7 cursor-pointer items-center gap-1.5 rounded-md pr-1 text-[13px] select-none ${
            active ? "bg-accent-soft font-medium text-fg" : "text-fg-muted hover:bg-muted hover:text-fg"
          } ${isDrop ? "ring-1 ring-accent" : ""}`}
          style={{ paddingLeft: 6 + depth * 14 }}
          title={node.path}
        >
          {node.folder ? (
            <>
              <ChevronRight size={13} className={`shrink-0 text-fg-faint transition-transform ${isOpen ? "rotate-90" : ""}`} />
              {isOpen ? <FolderOpen size={15} className="shrink-0 text-fg-faint" /> : <Folder size={15} className="shrink-0 text-fg-faint" />}
            </>
          ) : (
            <span className="ml-[19px] shrink-0">{iconFor(node.path)}</span>
          )}
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          {!node.folder && node.path === project.mainFile && (
            <span title="Main document" className="shrink-0 rounded bg-accent-soft px-1 text-[10px] font-semibold text-accent">
              MAIN
            </span>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setMenu({ x: r.left, y: r.bottom + 2, entries: entriesFor(node) });
            }}
            className="shrink-0 rounded p-0.5 text-fg-faint opacity-0 group-hover:opacity-100 hover:bg-hover hover:text-fg focus:opacity-100 [@media(pointer:coarse)]:opacity-100"
            aria-label={`Actions for ${node.name}`}
          >
            <MoreHorizontal size={14} />
          </button>
        </div>
        {node.folder && isOpen && node.children.length > 0 && <ul>{node.children.map((c) => renderNode(c, depth + 1))}</ul>}
      </li>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-line px-2">
        <span className="flex-1 truncate text-[11px] font-semibold tracking-wide text-fg-faint uppercase">Files</span>
        <IconBtn label="New file" onClick={() => void newFile("")}>
          <FilePlus2 size={15} />
        </IconBtn>
        <IconBtn label="New folder" onClick={() => void newFolder("")}>
          <FolderPlus size={15} />
        </IconBtn>
        <IconBtn
          label="Upload files"
          onClick={() => {
            uploadFolder.current = "";
            uploadRef.current?.click();
          }}
        >
          <Upload size={15} />
        </IconBtn>
      </div>
      <div
        className={`min-h-0 flex-1 overflow-auto p-1.5 ${dropTarget === "" ? "bg-accent-soft/50" : ""}`}
        onDragOver={(e) => onDragOver(e, null)}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDropTarget(null);
        }}
        onDrop={(e) => void onDrop(e, null)}
        onContextMenu={(e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, entries: entriesFor(null) });
          }
        }}
      >
        <ul>{tree.map((n) => renderNode(n, 0))}</ul>
        {tree.length === 0 && <p className="px-2 py-4 text-center text-[12px] text-fg-faint">No files yet. Drop files here or create one.</p>}
      </div>
      <input
        ref={uploadRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])].map((file) => ({ path: file.name, file }));
          e.target.value = "";
          void upload(files, uploadFolder.current);
        }}
      />
      {menu && <ContextMenu x={menu.x} y={menu.y} entries={menu.entries} onClose={() => setMenu(null)} />}
    </div>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={label} aria-label={label} className="rounded-md p-1.5 text-fg-muted hover:bg-muted hover:text-fg">
      {children}
    </button>
  );
}
