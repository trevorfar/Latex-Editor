import { snippet } from "@codemirror/autocomplete";
import { indentUnit } from "@codemirror/language";
import { EditorSelection } from "@codemirror/state";
import { EditorView, type KeyBinding } from "@codemirror/view";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Enter right after "\begin{env}" inserts the matching \end when the document lacks one. */
export const closeEnvironmentOnEnter: KeyBinding = {
  key: "Enter",
  run(view) {
    const { state } = view;
    if (state.selection.ranges.length > 1) return false;
    const sel = state.selection.main;
    if (!sel.empty) return false;
    const line = state.doc.lineAt(sel.head);
    const before = line.text.slice(0, sel.head - line.from);
    const after = line.text.slice(sel.head - line.from);
    if (after.trim() !== "") return false;
    const m = before.match(/\\begin\{([^}]+)\}(?:\s*(?:\[[^\]]*\]|\{[^}]*\}|<[^>]*>))*\s*$/);
    if (!m || before.slice(0, m.index).match(/(^|[^\\])%/)) return false;
    const name = m[1];
    if (name === "document" && /\\end\{document\}/.test(state.sliceDoc(sel.head))) return false;

    // Insert only when \begin{name} outnumbers \end{name} across the whole document.
    const doc = state.doc.toString();
    const begins = doc.match(new RegExp(`\\\\begin\\{${escapeRe(name)}\\}`, "g"))?.length ?? 0;
    const ends = doc.match(new RegExp(`\\\\end\\{${escapeRe(name)}\\}`, "g"))?.length ?? 0;
    if (ends >= begins) return false;

    const indent = /^\s*/.exec(line.text)?.[0] ?? "";
    const unit = state.facet(indentUnit);
    const inner = /^(itemize|enumerate)$/.test(name) ? "\\item " : name === "description" ? "\\item[] " : "";
    const insert = `\n${indent}${unit}${inner}\n${indent}\\end{${name}}`;
    const cursor = sel.head + 1 + indent.length + unit.length + inner.length - (name === "description" ? 2 : 0);
    view.dispatch({ changes: { from: sel.head, insert }, selection: { anchor: cursor }, scrollIntoView: true, userEvent: "input" });
    return true;
  },
};

/** Pairs $ like a bracket: $ -> $|$, typing $ in an empty pair -> $$|$$, and steps over a closing $. */
export const dollarPairing = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== "$" || view.state.selection.ranges.length > 1 || view.composing) return false;
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty) {
    view.dispatch({
      changes: [{ from: sel.from, insert: "$" }, { from: sel.to, insert: "$" }],
      selection: EditorSelection.range(sel.from + 1, sel.to + 1),
      userEvent: "input",
    });
    return true;
  }
  const prev = state.sliceDoc(from - 1, from);
  const prev2 = state.sliceDoc(from - 2, from - 1);
  const next = state.sliceDoc(to, to + 1);
  if (prev === "\\") return false;
  const line = state.doc.lineAt(from);
  if (/(^|[^\\])%/.test(line.text.slice(0, from - line.from))) return false;

  if (prev === "$" && next === "$" && prev2 !== "$" && prev2 !== "\\") {
    view.dispatch({ changes: { from, insert: "$$" }, selection: { anchor: from + 1 }, userEvent: "input" });
    return true;
  }
  if (next === "$") {
    view.dispatch({ selection: { anchor: to + 1 }, userEvent: "select" });
    return true;
  }
  if (next === "" || /[\s.,;:!?)\]}]/.test(next)) {
    view.dispatch({ changes: { from, insert: "$$" }, selection: { anchor: from + 1 }, userEvent: "input" });
    return true;
  }
  return false;
});

/** Wraps each selection in before/after; unwraps when already wrapped. */
export function toggleWrap(view: EditorView, before: string, after: string): boolean {
  const { state } = view;
  const tr = state.changeByRange((range) => {
    const pre = state.sliceDoc(range.from - before.length, range.from);
    const post = state.sliceDoc(range.to, range.to + after.length);
    if (pre === before && post === after) {
      return {
        changes: [
          { from: range.from - before.length, to: range.from },
          { from: range.to, to: range.to + after.length },
        ],
        range: EditorSelection.range(range.from - before.length, range.to - before.length),
      };
    }
    return {
      changes: [
        { from: range.from, insert: before },
        { from: range.to, insert: after },
      ],
      range: EditorSelection.range(range.from + before.length, range.to + before.length),
    };
  });
  view.dispatch(tr, { userEvent: "input", scrollIntoView: true });
  view.focus();
  return true;
}

/** Inserts a CodeMirror snippet (#{field} syntax) at the selection; a selection fills the first field via #{sel}. */
export function insertSnippet(view: EditorView, template: string): void {
  const sel = view.state.selection.main;
  const selected = view.state.sliceDoc(sel.from, sel.to);
  const filled = selected ? template.replace("#{sel}", selected.replace(/[{}]/g, (c) => "\\" + c)) : template.replace("#{sel}", "#{}");
  snippet(filled)(view, { label: "" }, sel.from, sel.to);
  view.focus();
}

export const formattingKeymap: KeyBinding[] = [
  { key: "Mod-b", run: (v) => toggleWrap(v, "\\textbf{", "}") },
  { key: "Mod-i", run: (v) => toggleWrap(v, "\\textit{", "}") },
  { key: "Mod-u", run: (v) => toggleWrap(v, "\\underline{", "}") },
  { key: "Mod-m", run: (v) => toggleWrap(v, "$", "$") },
];
