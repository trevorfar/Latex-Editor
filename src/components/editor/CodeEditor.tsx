"use client";

import { useEffect, useImperativeHandle, useLayoutEffect, useRef, type Ref } from "react";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  Decoration,
  type DecorationSet,
} from "@codemirror/view";
import { Compartment, EditorSelection, EditorState, Prec, StateEffect, StateField, type Extension } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { highlightSelectionMatches, searchKeymap, search } from "@codemirror/search";
import { lintGutter, lintKeymap, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { vim } from "@replit/codemirror-vim";
import { darkHighlight, latex, lightHighlight } from "@/lib/latex/language";
import { latexCompletions, type ProjectIndex } from "@/lib/latex/completions";
import { closeEnvironmentOnEnter, dollarPairing, formattingKeymap } from "@/lib/latex/editing";
import type { Settings } from "@/lib/settings";
import type { ProjectStore } from "@/lib/project-store";
import type { ProjectFile } from "@/lib/types";

export interface EditorDiagnostic {
  line: number;
  severity: "error" | "warning" | "info";
  message: string;
}

export interface GotoRequest {
  path: string;
  line: number;
  nonce: number;
}

export interface CodeEditorHandle {
  view(): EditorView | null;
  focus(): void;
}

interface CodeEditorProps {
  store: ProjectStore;
  file: ProjectFile | null;
  settings: Settings;
  theme: "light" | "dark";
  diagnostics: Map<string, EditorDiagnostic[]>;
  goto: GotoRequest | null;
  getIndex: () => ProjectIndex;
  onCompile: () => void;
  onCursorLine?: (line: number) => void;
  onSyncToPdf?: () => void;
  ref?: Ref<CodeEditorHandle>;
}

// ----- line flash (used after jumps) -----
const flashEffect = StateEffect.define<{ from: number } | null>();
const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(flashEffect)) {
        value = e.value ? Decoration.set([Decoration.line({ class: "cm-sync-flash" }).range(e.value.from)]) : Decoration.none;
      }
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

function toCmDiagnostics(state: EditorState, diags: EditorDiagnostic[]): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const d of diags) {
    if (d.line < 1 || d.line > state.doc.lines) continue;
    const line = state.doc.line(d.line);
    const text = line.text;
    const start = line.from + (text.length - text.trimStart().length);
    out.push({ from: start, to: Math.max(start, line.to), severity: d.severity, message: d.message, source: "LaTeX" });
  }
  return out;
}

export function CodeEditor({
  store,
  file,
  settings,
  theme,
  diagnostics,
  goto,
  getIndex,
  onCompile,
  onCursorLine,
  onSyncToPdf,
  ref,
}: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const states = useRef(new Map<string, EditorState>());
  const currentId = useRef<string | null>(null);
  const appliedGoto = useRef<number>(-1);
  const compartments = useRef({
    theme: new Compartment(),
    font: new Compartment(),
    wrap: new Compartment(),
    keymap: new Compartment(),
    spell: new Compartment(),
    complete: new Compartment(),
  });
  const latest = useRef({ onCompile, onCursorLine, onSyncToPdf, getIndex, settings, theme, store });
  useLayoutEffect(() => {
    latest.current = { onCompile, onCursorLine, onSyncToPdf, getIndex, settings, theme, store };
  });

  // ----- dynamic configuration -----
  const dynamicValues = () => {
    const { settings: s, theme: t } = latest.current;
    return {
      theme: [EditorView.theme({}, { dark: t === "dark" }), syntaxHighlighting(t === "dark" ? darkHighlight : lightHighlight)],
      font: EditorView.theme({ "&": { fontSize: `${s.fontSize}px` } }),
      wrap: s.lineWrapping ? EditorView.lineWrapping : [],
      keymap: s.keymap === "vim" ? vim() : [],
      spell: EditorView.contentAttributes.of({
        spellcheck: s.spellcheck ? "true" : "false",
        autocorrect: "off",
        autocapitalize: "off",
        translate: "no",
      }),
      complete: s.autocomplete
        ? autocompletion({
            override: [latexCompletions(() => latest.current.getIndex())],
            icons: false,
            activateOnTyping: true,
            maxRenderedOptions: 80,
          })
        : [],
    } satisfies Record<keyof typeof compartments.current, Extension>;
  };

  const dynamicConfig = (): Extension[] => {
    const v = dynamicValues();
    const c = compartments.current;
    // Order matters: vim's keymap must precede the default keymaps.
    return [c.keymap.of(v.keymap), c.theme.of(v.theme), c.font.of(v.font), c.wrap.of(v.wrap), c.spell.of(v.spell), c.complete.of(v.complete)];
  };

  const reconfigureAll = () => {
    const v = dynamicValues();
    const c = compartments.current;
    return (Object.keys(c) as (keyof typeof c)[]).map((k) => c[k].reconfigure(v[k]));
  };

  const baseExtensions = (fileId: string): Extension[] => [
    ...dynamicConfig(),
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter({ openText: "▾", closedText: "▸" }),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    indentUnit.of("  "),
    bracketMatching(),
    closeBrackets(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    search({ top: true }),
    latex(),
    dollarPairing,
    flashField,
    lintGutter(),
    Prec.high(
      keymap.of([
        closeEnvironmentOnEnter,
        ...formattingKeymap,
        { key: "Mod-s", preventDefault: true, run: () => (latest.current.onCompile(), true) },
        { key: "Mod-Enter", preventDefault: true, run: () => (latest.current.onCompile(), true) },
        { key: "Mod-Alt-ArrowRight", preventDefault: true, run: () => (latest.current.onSyncToPdf?.(), true) },
      ]),
    ),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      ...lintKeymap,
      indentWithTab,
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) latest.current.store.setLiveDoc(fileId, update.state.doc);
      if (update.selectionSet || update.docChanged) {
        latest.current.onCursorLine?.(update.state.doc.lineAt(update.state.selection.main.head).number);
      }
    }),
  ];

  const createState = (f: ProjectFile): EditorState =>
    EditorState.create({
      doc: store.getText(f.path) ?? "",
      extensions: baseExtensions(f.id),
    });

  // Mount once.
  useEffect(() => {
    const view = new EditorView({ parent: hostRef.current!, state: EditorState.create({ doc: "" }) });
    viewRef.current = view;
    const cache = states.current;
    const unsubscribe = store.onFileReplaced((id) => {
      cache.delete(id);
      if (currentId.current === id) {
        const f = store.getSnapshot().files.find((x) => x.id === id);
        if (f) view.setState(createState(f));
      }
    });
    return () => {
      unsubscribe();
      view.destroy();
      viewRef.current = null;
      cache.clear();
      // A remount (e.g. React StrictMode) gets a fresh view that must load the file again.
      currentId.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  // Switch files: stash the current state and restore (or create) the next.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (currentId.current && currentId.current !== file?.id) {
      states.current.set(currentId.current, view.state);
    }
    if (!file || file.kind !== "text") {
      currentId.current = null;
      return;
    }
    if (currentId.current === file.id) return;
    currentId.current = file.id;
    let state = states.current.get(file.id) ?? createState(file);
    // Settings may have changed while this file was in the background.
    state = state.update({ effects: reconfigureAll() }).state;
    const diags = diagnostics.get(file.path) ?? [];
    state = state.update(setDiagnostics(state, toCmDiagnostics(state, diags))).state;
    view.setState(state);
    latest.current.onCursorLine?.(state.doc.lineAt(state.selection.main.head).number);
    requestAnimationFrame(() => view.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.id]);

  // Apply settings/theme changes to the live view.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !currentId.current) return;
    view.dispatch({ effects: reconfigureAll() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, theme]);

  // Diagnostics after each compile.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !file || file.kind !== "text") return;
    view.dispatch(setDiagnostics(view.state, toCmDiagnostics(view.state, diagnostics.get(file.path) ?? [])));
    // Background files get theirs when reopened.
    for (const [id, st] of states.current) {
      const f = store.getSnapshot().files.find((x) => x.id === id);
      if (f) states.current.set(id, st.update(setDiagnostics(st, toCmDiagnostics(st, diagnostics.get(f.path) ?? []))).state);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagnostics]);

  // Jump to a line (from logs, outline, or PDF double-click).
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !goto || !file || goto.path !== file.path || appliedGoto.current === goto.nonce) return;
    if (currentId.current !== file.id) return;
    appliedGoto.current = goto.nonce;
    const n = Math.min(Math.max(1, goto.line), view.state.doc.lines);
    const line = view.state.doc.line(n);
    const col = line.text.length - line.text.trimStart().length;
    view.dispatch({
      selection: EditorSelection.cursor(line.from + col),
      effects: [EditorView.scrollIntoView(line.from, { y: "center" }), flashEffect.of({ from: line.from })],
    });
    view.focus();
    const t = setTimeout(() => viewRef.current?.dispatch({ effects: flashEffect.of(null) }), 1700);
    return () => clearTimeout(t);
  }, [goto, file]);

  useImperativeHandle(ref, () => ({
    view: () => viewRef.current,
    focus: () => viewRef.current?.focus(),
  }));

  return <div ref={hostRef} className="h-full min-h-0 w-full overflow-hidden" />;
}
