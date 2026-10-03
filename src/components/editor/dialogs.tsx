"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { updateSettings, useSettings, type Settings } from "@/lib/settings";
import type { WordCountResult } from "@/lib/latex/scan";

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-fg">{label}</div>
        {hint && <div className="text-[12px] text-fg-faint">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={value}
      aria-label={label}
      onClick={() => onChange(!value)}
      className={`relative h-5 w-9 rounded-full transition-colors ${value ? "bg-accent" : "bg-line-strong"}`}
    >
      <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${value ? "translate-x-4" : ""}`} />
    </button>
  );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-md border border-line bg-subtle p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded px-2.5 py-1 text-[12px] ${value === o.value ? "bg-bg font-medium text-fg shadow-sm" : "text-fg-muted hover:text-fg"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useSettings();
  const set = (patch: Partial<Settings>) => updateSettings(patch);
  const [backend, setBackend] = useState<string | null>(null);

  useEffect(() => {
    if (!open || backend) return;
    fetch("/api/compile")
      .then((r) => r.json())
      .then((j: { backend: string }) => setBackend(j.backend))
      .catch(() => setBackend("unknown"));
  }, [open, backend]);

  return (
    <Modal open={open} onClose={onClose} title="Settings" width="max-w-lg" footer={<Button onClick={onClose}>Done</Button>}>
      <div className="divide-y divide-line">
        <Row label="Theme">
          <Segmented
            value={s.theme}
            onChange={(theme) => set({ theme })}
            options={[
              { value: "system", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
        </Row>
        <Row label="Font size">
          <select
            value={s.fontSize}
            onChange={(e) => set({ fontSize: Number(e.target.value) })}
            className="h-8 rounded-md border border-line-strong bg-bg px-2 text-[13px] outline-none focus:border-accent"
          >
            {[11, 12, 13, 14, 15, 16, 18, 20, 22].map((n) => (
              <option key={n} value={n}>
                {n}px
              </option>
            ))}
          </select>
        </Row>
        <Row label="Keybindings">
          <Segmented
            value={s.keymap}
            onChange={(keymap) => set({ keymap })}
            options={[
              { value: "default", label: "Default" },
              { value: "vim", label: "Vim" },
            ]}
          />
        </Row>
        <Row label="Wrap long lines">
          <Toggle label="Wrap long lines" value={s.lineWrapping} onChange={(lineWrapping) => set({ lineWrapping })} />
        </Row>
        <Row label="Spell check" hint="Uses your browser's dictionary">
          <Toggle label="Spell check" value={s.spellcheck} onChange={(spellcheck) => set({ spellcheck })} />
        </Row>
        <Row label="Autocomplete" hint="Commands, environments, labels, citations, files">
          <Toggle label="Autocomplete" value={s.autocomplete} onChange={(autocomplete) => set({ autocomplete })} />
        </Row>
        <Row label="Formatting toolbar">
          <Toggle label="Formatting toolbar" value={s.showFormatBar} onChange={(showFormatBar) => set({ showFormatBar })} />
        </Row>
        <Row label="Auto-compile" hint="Recompile after you pause typing">
          <div className="flex items-center gap-2">
            {s.autoCompile && (
              <select
                value={s.autoCompileDelay}
                onChange={(e) => set({ autoCompileDelay: Number(e.target.value) })}
                className="h-8 rounded-md border border-line-strong bg-bg px-2 text-[12px] outline-none focus:border-accent"
                aria-label="Auto-compile delay"
              >
                {[600, 1200, 2000, 3500].map((ms) => (
                  <option key={ms} value={ms}>
                    after {ms / 1000}s
                  </option>
                ))}
              </select>
            )}
            <Toggle label="Auto-compile" value={s.autoCompile} onChange={(autoCompile) => set({ autoCompile })} />
          </div>
        </Row>
        <Row label="Stop on first error" hint="Otherwise LaTeX tries to finish the PDF despite errors">
          <Toggle label="Stop on first error" value={s.stopOnFirstError} onChange={(stopOnFirstError) => set({ stopOnFirstError })} />
        </Row>
        <div className="pt-3 text-[12px] text-fg-faint">
          Compiler backend: {backend === "local" ? "TeX Live on this server" : backend === "remote" ? "remote compile service" : "checking…"}. Projects are
          saved in this browser.
        </div>
      </div>
    </Modal>
  );
}

export function WordCountDialog({ open, onClose, result, files }: { open: boolean; onClose: () => void; result: WordCountResult | null; files: string[] }) {
  const rows: [string, number][] = result
    ? [
        ["Words in text", result.words],
        ["Headers", result.headers],
        ["Inline math", result.mathInline],
        ["Display math", result.mathDisplay],
        ["Figures", result.figures],
        ["Tables", result.tables],
      ]
    : [];
  return (
    <Modal open={open} onClose={onClose} title="Word count" footer={<Button onClick={onClose}>Close</Button>}>
      {result && (
        <>
          <div className="mb-4 text-center">
            <div className="text-4xl font-semibold tabular-nums">{result.words.toLocaleString()}</div>
            <div className="text-[12px] text-fg-faint">words</div>
          </div>
          <dl className="divide-y divide-line rounded-md border border-line">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between px-3 py-2 text-[13px]">
                <dt className="text-fg-muted">{k}</dt>
                <dd className="font-medium tabular-nums">{v.toLocaleString()}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-[12px] text-fg-faint">
            Counts body text after \begin{"{document}"}, excluding commands and math, across {files.length} file{files.length === 1 ? "" : "s"}:{" "}
            {files.join(", ")}.
          </p>
        </>
      )}
    </Modal>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Compile", "Ctrl/⌘ + S  or  Ctrl/⌘ + Enter"],
  ["Jump from code to PDF", "Ctrl/⌘ + Alt + →"],
  ["Jump from PDF to code", "Double-click the PDF"],
  ["Autocomplete", "Ctrl + Space"],
  ["Bold / italic / underline", "Ctrl/⌘ + B / I / U"],
  ["Inline math", "Ctrl/⌘ + M"],
  ["Toggle comment", "Ctrl/⌘ + /"],
  ["Find / replace", "Ctrl/⌘ + F"],
  ["Go to line", "Ctrl/⌘ + Alt + G"],
  ["Indent / outdent", "Tab / Shift + Tab"],
  ["Fold / unfold block", "Ctrl/⌘ + Shift + [ / ]"],
  ["Select next occurrence", "Ctrl/⌘ + D"],
  ["Add cursor", "Alt + click"],
  ["Zoom PDF", "Ctrl/⌘ + scroll, or pinch"],
];

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" footer={<Button onClick={onClose}>Close</Button>}>
      <dl className="divide-y divide-line">
        {SHORTCUTS.map(([what, keys]) => (
          <div key={what} className="flex justify-between gap-4 py-2 text-[13px]">
            <dt className="text-fg-muted">{what}</dt>
            <dd className="text-right font-mono text-[12px]">{keys}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
