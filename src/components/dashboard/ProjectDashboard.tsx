"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Copy,
  Download,
  FileUp,
  FolderOpen,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings as SettingsIcon,
  Sigma,
  Trash2,
  FileText,
  Presentation,
  FlaskConical,
  BookOpen,
  ClipboardList,
  Mail,
  UserRound,
  File as FileIcon,
} from "lucide-react";
import * as db from "@/lib/db";
import { TEMPLATES, type Template } from "@/lib/templates";
import type { ProjectMeta } from "@/lib/types";
import { detectMainFile, filesFromZip, projectToZip, type ImportedFile } from "@/lib/zip";
import { extname, kindForPath, normalizePath, formatBytes } from "@/lib/paths";
import { watchSystemTheme } from "@/lib/settings";
import { Button } from "@/components/ui/Button";
import { Dropdown, type MenuEntry } from "@/components/ui/Menu";
import { DialogProvider, useDialogs } from "@/components/ui/dialogs";
import { Toaster, toast } from "@/components/ui/toast";
import { SettingsDialog } from "@/components/editor/dialogs";

const TEMPLATE_ICONS: Record<string, React.ReactNode> = {
  blank: <FileIcon size={18} />,
  article: <FileText size={18} />,
  report: <BookOpen size={18} />,
  lab: <FlaskConical size={18} />,
  homework: <ClipboardList size={18} />,
  beamer: <Presentation size={18} />,
  letter: <Mail size={18} />,
  cv: <UserRound size={18} />,
};

function relativeTime(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: d > 300 ? "numeric" : undefined });
}

export default function ProjectDashboard() {
  return (
    <DialogProvider>
      <Dashboard />
      <Toaster />
    </DialogProvider>
  );
}

function Dashboard() {
  const router = useRouter();
  const dialogs = useDialogs();
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [usage, setUsage] = useState<string | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    void db.listProjects().then(setProjects);
    void db.storageEstimate().then((est) => {
      if (est && est.quota) setUsage(`${formatBytes(est.usage)} used of ${formatBytes(est.quota)} available in this browser`);
    });
  }, []);

  useEffect(() => {
    refresh();
    return watchSystemTheme();
  }, [refresh]);

  const filtered = useMemo(
    () => (projects ?? []).filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase())),
    [projects, query],
  );

  const createFromTemplate = async (template: Template) => {
    const name = await dialogs.prompt({
      title: "New project",
      label: `Template: ${template.name}`,
      initial: template.id === "blank" ? "Untitled project" : template.name,
      confirmLabel: "Create",
    });
    if (!name) return;
    setBusy(true);
    const project = await db.createProject(
      { name, mainFile: template.mainFile, compiler: template.compiler, folders: [] },
      template.files.map((f) => ({ path: f.path, kind: kindForPath(f.path), content: f.content })),
    );
    router.push(`/project/${project.id}`);
  };

  const importFiles = async (list: File[]) => {
    if (list.length === 0) return;
    setBusy(true);
    try {
      let files: ImportedFile[] = [];
      let name = "Imported project";
      if (list.length === 1 && extname(list[0].name) === "zip") {
        files = filesFromZip(new Uint8Array(await list[0].arrayBuffer()));
        name = list[0].name.replace(/\.zip$/i, "");
      } else {
        for (const f of list) {
          const path = normalizePath(f.name);
          if (!path) continue;
          const kind = kindForPath(path);
          files.push(kind === "text" ? { path, kind, content: await f.text() } : { path, kind, data: f });
        }
        name = list[0].name.replace(/\.[^.]+$/, "");
      }
      const main = detectMainFile(files);
      if (!main) {
        toast("No .tex file found in the upload.", "error");
        setBusy(false);
        return;
      }
      const project = await db.createProject({ name, mainFile: main, compiler: guessCompiler(files), folders: [] }, files);
      router.push(`/project/${project.id}`);
    } catch (err) {
      console.error(err);
      toast("Couldn't read that file. Is it a valid .zip?", "error");
      setBusy(false);
    }
  };

  const rename = async (p: ProjectMeta) => {
    const name = await dialogs.prompt({ title: "Rename project", initial: p.name, confirmLabel: "Rename" });
    if (!name) return;
    await db.touchProject(p.id, { name });
    refresh();
  };

  const duplicate = async (p: ProjectMeta) => {
    await db.duplicateProject(p.id, `${p.name} (copy)`);
    toast("Project duplicated.", "success");
    refresh();
  };

  const download = async (p: ProjectMeta) => {
    const blob = await projectToZip(await db.getFiles(p.id));
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${p.name.replace(/[\\/:*?"<>|]+/g, "-")}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const remove = async (p: ProjectMeta) => {
    const ok = await dialogs.confirm({
      title: "Delete project?",
      message: `"${p.name}" and all its files will be permanently deleted from this browser.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await db.deleteProject(p.id);
    refresh();
  };

  const projectMenu = (p: ProjectMeta): MenuEntry[] => [
    { label: "Open", icon: <FolderOpen size={14} />, onSelect: () => router.push(`/project/${p.id}`) },
    { label: "Rename", icon: <Pencil size={14} />, onSelect: () => void rename(p) },
    { label: "Duplicate", icon: <Copy size={14} />, onSelect: () => void duplicate(p) },
    { label: "Download source (.zip)", icon: <Download size={14} />, onSelect: () => void download(p) },
    { separator: true },
    { label: "Delete", icon: <Trash2 size={14} />, danger: true, onSelect: () => void remove(p) },
  ];

  const newMenu: MenuEntry[] = [
    { heading: "Start from" },
    ...TEMPLATES.map((t) => ({ label: t.name, icon: TEMPLATE_ICONS[t.id], onSelect: () => void createFromTemplate(t) })),
    { separator: true },
    { label: "Upload .zip or .tex files", icon: <FileUp size={14} />, onSelect: () => uploadRef.current?.click() },
  ];

  return (
    <div
      className="min-h-dvh bg-subtle"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        void importFiles([...e.dataTransfer.files]);
      }}
    >
      <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-accent-fg">
              <Sigma size={17} strokeWidth={2.5} />
            </span>
            <span className="text-[15px] font-semibold">TeXbench</span>
          </Link>
          <div className="flex-1" />
          <button
            onClick={() => setSettingsOpen(true)}
            className="rounded-md p-2 text-fg-muted hover:bg-muted hover:text-fg"
            aria-label="Settings"
            title="Settings"
          >
            <SettingsIcon size={18} />
          </button>
          <Dropdown
            align="right"
            entries={newMenu}
            trigger={({ onClick, ref }) => (
              <Button ref={ref} onClick={onClick} variant="primary" size="md" disabled={busy}>
                {busy ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}
                New project
              </Button>
            )}
          />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        {projects === null ? (
          <div className="flex justify-center py-20 text-fg-muted">
            <Loader2 className="spin" size={22} />
          </div>
        ) : projects.length === 0 ? (
          <section className="py-8">
            <h1 className="text-2xl font-semibold tracking-tight">Write LaTeX, see the PDF instantly.</h1>
            <p className="mt-2 max-w-xl text-[14px] text-fg-muted">
              Pick a template to start. Your projects are saved in this browser. You can also drop a .zip of an existing project
              (Overleaf exports work) anywhere on this page.
            </p>
          </section>
        ) : (
          <section>
            <div className="mb-3 flex items-center gap-3">
              <h1 className="text-lg font-semibold">Projects</h1>
              <div className="flex-1" />
              <label className="relative w-full max-w-[260px]">
                <Search size={15} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-faint" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search projects"
                  className="h-9 w-full rounded-md border border-line bg-bg pr-3 pl-8 text-[13px] outline-none focus:border-accent"
                />
              </label>
            </div>
            <div className="overflow-hidden rounded-xl border border-line bg-bg">
              <div className="hidden grid-cols-[1fr_140px_110px_44px] items-center gap-3 border-b border-line bg-subtle px-4 py-2 text-[11.5px] font-semibold tracking-wide text-fg-faint uppercase sm:grid">
                <span>Name</span>
                <span>Last modified</span>
                <span>Compiler</span>
                <span />
              </div>
              {filtered.map((p) => (
                <div
                  key={p.id}
                  className="group grid grid-cols-[1fr_44px] items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0 hover:bg-subtle sm:grid-cols-[1fr_140px_110px_44px]"
                >
                  <Link href={`/project/${p.id}`} className="min-w-0">
                    <div className="truncate text-[14px] font-medium group-hover:text-accent">{p.name}</div>
                    <div className="truncate text-[12px] text-fg-faint sm:hidden">
                      {relativeTime(p.updatedAt)} · {p.mainFile}
                    </div>
                    <div className="hidden truncate text-[12px] text-fg-faint sm:block">{p.mainFile}</div>
                  </Link>
                  <span className="hidden text-[13px] text-fg-muted sm:block">{relativeTime(p.updatedAt)}</span>
                  <span className="hidden text-[13px] text-fg-muted sm:block">
                    {p.compiler === "pdflatex" ? "pdfLaTeX" : p.compiler === "xelatex" ? "XeLaTeX" : "LuaLaTeX"}
                  </span>
                  <Dropdown
                    align="right"
                    entries={projectMenu(p)}
                    trigger={({ onClick, ref }) => (
                      <button
                        ref={ref}
                        onClick={onClick}
                        aria-label={`Actions for ${p.name}`}
                        className="justify-self-end rounded-md p-1.5 text-fg-muted hover:bg-muted hover:text-fg"
                      >
                        <MoreHorizontal size={17} />
                      </button>
                    )}
                  />
                </div>
              ))}
              {filtered.length === 0 && <p className="px-4 py-8 text-center text-[13px] text-fg-muted">No projects match “{query}”.</p>}
            </div>
          </section>
        )}

        <section className="mt-8">
          <h2 className="mb-3 text-[13px] font-semibold tracking-wide text-fg-faint uppercase">Start from a template</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                onClick={() => void createFromTemplate(t)}
                disabled={busy}
                className="flex flex-col items-start gap-2 rounded-xl border border-line bg-bg p-4 text-left transition-colors hover:border-accent hover:shadow-pop disabled:opacity-60"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent">{TEMPLATE_ICONS[t.id]}</span>
                <span className="text-[14px] font-medium">{t.name}</span>
                <span className="text-[12.5px] leading-snug text-fg-muted">{t.description}</span>
              </button>
            ))}
            <button
              onClick={() => uploadRef.current?.click()}
              disabled={busy}
              className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-line-strong bg-transparent p-4 text-left transition-colors hover:border-accent disabled:opacity-60"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-fg-muted">
                <FileUp size={18} />
              </span>
              <span className="text-[14px] font-medium">Upload project</span>
              <span className="text-[12.5px] leading-snug text-fg-muted">A .zip (e.g. an Overleaf export) or .tex files.</span>
            </button>
          </div>
        </section>

        {usage && <p className="mt-8 text-center text-[12px] text-fg-faint">{usage}</p>}
      </main>

      <input
        ref={uploadRef}
        type="file"
        multiple
        accept=".zip,.tex,.bib,.sty,.cls,.png,.jpg,.jpeg,.pdf"
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          void importFiles(files);
        }}
      />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

/** fontspec / unicode-math need XeLaTeX or LuaLaTeX. */
function guessCompiler(files: ImportedFile[]): ProjectMeta["compiler"] {
  const tex = files.filter((f) => f.content).map((f) => f.content!).join("\n");
  if (/\\usepackage(\[[^\]]*\])?\{[^}]*\b(fontspec|unicode-math|polyglossia)\b/.test(tex)) {
    return /\\directlua|luacode/.test(tex) ? "lualatex" : "xelatex";
  }
  return "pdflatex";
}
