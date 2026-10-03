"use client";

import {
  Bold,
  Italic,
  Underline,
  Heading,
  Sigma,
  SquareFunction,
  List,
  ListOrdered,
  Image as ImageIcon,
  Table,
  Link2,
  Quote,
  Hash,
  Undo2,
  Redo2,
  Search,
  MessageSquareCode,
  Footprints,
} from "lucide-react";
import { undo, redo, toggleComment } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { startCompletion } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import { insertSnippet, toggleWrap } from "@/lib/latex/editing";
import { Dropdown } from "@/components/ui/Menu";

interface FormatBarProps {
  getView: () => EditorView | null;
}

export function FormatBar({ getView }: FormatBarProps) {
  const run = (fn: (v: EditorView) => void) => () => {
    const v = getView();
    if (v) fn(v);
  };
  const snip = (template: string) => run((v) => insertSnippet(v, template));
  const insertAndComplete = (text: string) =>
    run((v) => {
      insertSnippet(v, text);
      startCompletion(v);
    });

  const sep = <span className="mx-1 h-5 w-px shrink-0 bg-line" />;

  return (
    <div className="flex h-9 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line bg-subtle px-1.5">
      <Tool label="Undo (Ctrl+Z)" onClick={run((v) => undo(v))}>
        <Undo2 size={15} />
      </Tool>
      <Tool label="Redo (Ctrl+Shift+Z)" onClick={run((v) => redo(v))}>
        <Redo2 size={15} />
      </Tool>
      {sep}
      <Dropdown
        trigger={({ onClick, ref }) => (
          <button
            ref={ref}
            onClick={onClick}
            title="Heading"
            className="flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-fg-muted hover:bg-muted hover:text-fg"
          >
            <Heading size={15} />
            <span className="text-[12px]">Section</span>
          </button>
        )}
        entries={[
          { label: "Part", onSelect: snip("\\part{#{sel}}") },
          { label: "Chapter", onSelect: snip("\\chapter{#{sel}}") },
          { label: "Section", onSelect: snip("\\section{#{sel}}") },
          { label: "Subsection", onSelect: snip("\\subsection{#{sel}}") },
          { label: "Subsubsection", onSelect: snip("\\subsubsection{#{sel}}") },
          { label: "Paragraph", onSelect: snip("\\paragraph{#{sel}}") },
        ]}
      />
      {sep}
      <Tool label="Bold (Ctrl+B)" onClick={run((v) => toggleWrap(v, "\\textbf{", "}"))}>
        <Bold size={15} />
      </Tool>
      <Tool label="Italic (Ctrl+I)" onClick={run((v) => toggleWrap(v, "\\textit{", "}"))}>
        <Italic size={15} />
      </Tool>
      <Tool label="Underline (Ctrl+U)" onClick={run((v) => toggleWrap(v, "\\underline{", "}"))}>
        <Underline size={15} />
      </Tool>
      {sep}
      <Tool label="Inline math (Ctrl+M)" onClick={run((v) => toggleWrap(v, "$", "$"))}>
        <Sigma size={15} />
      </Tool>
      <Tool label="Display equation" onClick={snip("\\begin{equation}\n\t#{sel}\n\\end{equation}")}>
        <SquareFunction size={15} />
      </Tool>
      {sep}
      <Tool label="Bulleted list" onClick={snip("\\begin{itemize}\n\t\\item #{sel}\n\\end{itemize}")}>
        <List size={15} />
      </Tool>
      <Tool label="Numbered list" onClick={snip("\\begin{enumerate}\n\t\\item #{sel}\n\\end{enumerate}")}>
        <ListOrdered size={15} />
      </Tool>
      {sep}
      <Tool
        label="Figure"
        onClick={snip("\\begin{figure}[ht]\n\t\\centering\n\t\\includegraphics[width=0.8\\linewidth]{#{file}}\n\t\\caption{#{caption}}\n\t\\label{fig:#{label}}\n\\end{figure}")}
      >
        <ImageIcon size={15} />
      </Tool>
      <Tool
        label="Table"
        onClick={snip(
          "\\begin{table}[ht]\n\t\\centering\n\t\\begin{tabular}{#{lcr}}\n\t\t\\hline\n\t\t#{A} & #{B} & #{C} \\\\\n\t\t\\hline\n\t\t#{} & #{} & #{} \\\\\n\t\t\\hline\n\t\\end{tabular}\n\t\\caption{#{caption}}\n\t\\label{tab:#{label}}\n\\end{table}",
        )}
      >
        <Table size={15} />
      </Tool>
      {sep}
      <Tool label="Link" onClick={snip("\\href{#{https://}}{#{sel}}")}>
        <Link2 size={15} />
      </Tool>
      <Tool label="Cite" onClick={insertAndComplete("\\cite{#{}}")}>
        <Quote size={15} />
      </Tool>
      <Tool label="Reference" onClick={insertAndComplete("\\ref{#{}}")}>
        <Hash size={15} />
      </Tool>
      <Tool label="Footnote" onClick={snip("\\footnote{#{sel}}")}>
        <Footprints size={15} />
      </Tool>
      {sep}
      <Tool label="Toggle comment (Ctrl+/)" onClick={run((v) => toggleComment(v))}>
        <MessageSquareCode size={15} />
      </Tool>
      <Tool label="Find and replace (Ctrl+F)" onClick={run((v) => openSearchPanel(v))}>
        <Search size={15} />
      </Tool>
    </div>
  );
}

function Tool({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-muted hover:text-fg"
    >
      {children}
    </button>
  );
}
