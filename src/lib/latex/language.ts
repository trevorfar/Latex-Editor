import {
  HighlightStyle,
  LanguageSupport,
  StreamLanguage,
  foldService,
  type StringStream,
} from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { Tag, tags as t } from "@lezer/highlight";

export const latexTags = {
  command: Tag.define(),
  sectionCommand: Tag.define(),
  envName: Tag.define(),
  math: Tag.define(),
  mathCommand: Tag.define(),
  mathDelim: Tag.define(),
  heading: Tag.define(),
  ref: Tag.define(),
  path: Tag.define(),
  verbatim: Tag.define(),
  special: Tag.define(),
  brace: Tag.define(),
  comment: t.comment,
};

const MATH_ENVS = new Set([
  "equation", "equation*", "align", "align*", "gather", "gather*", "multline", "multline*",
  "flalign", "flalign*", "alignat", "alignat*", "eqnarray", "eqnarray*", "math", "displaymath",
  "dmath", "dmath*", "subequations*",
]);
const VERBATIM_ENVS = new Set(["verbatim", "verbatim*", "Verbatim", "lstlisting", "minted", "comment", "BVerbatim", "LVerbatim", "alltt"]);
export const SECTION_LEVELS: Record<string, number> = {
  part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5, subparagraph: 6,
  frametitle: 3,
};
const REF_CMDS = new Set([
  "label", "ref", "eqref", "pageref", "autoref", "cref", "Cref", "nameref", "vref", "cite", "citep", "citet",
  "citeauthor", "citeyear", "parencite", "textcite", "autocite", "footcite", "nocite", "bibitem", "Autocite",
  "Textcite", "Parencite", "fullcite", "supercite", "smartcite", "cites", "crefrange", "hyperref",
]);
const PATH_CMDS = new Set([
  "input", "include", "includegraphics", "usepackage", "documentclass", "RequirePackage", "bibliography",
  "addbibresource", "includeonly", "subfile", "includepdf", "bibliographystyle", "usetheme", "usecolortheme",
  "lstinputlisting", "inputminted", "usetikzlibrary", "graphicspath",
]);
const TEXT_IN_MATH = new Set(["text", "textrm", "textbf", "textit", "mbox", "intertext", "textsf", "texttt", "shortintertext", "operatorname"]);

interface MathState {
  end: string | null;
  env: string | null;
}

interface State {
  math: MathState | null;
  pending: null | "begin" | "end" | "heading" | "ref" | "path" | "mathtext";
  verbatim: string | null;
  envStack: string[];
}

/** Consumes a brace group that starts at the stream position, staying on the current line. */
function eatGroup(stream: StringStream, open: string, close: string): void {
  let depth = 0;
  while (!stream.eol()) {
    const ch = stream.next();
    if (ch === "\\") {
      stream.next();
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return;
    }
  }
}

function onBegin(state: State, name: string) {
  state.envStack.push(name);
  if (VERBATIM_ENVS.has(name)) state.verbatim = name;
  else if (!state.math && MATH_ENVS.has(name)) state.math = { end: null, env: name };
}

function onEnd(state: State, name: string) {
  const i = state.envStack.lastIndexOf(name);
  if (i !== -1) state.envStack.length = i;
  if (state.math && state.math.env === name) state.math = null;
}

function token(stream: StringStream, state: State): string | null {
  // Verbatim-like environments: everything until the matching \end.
  if (state.verbatim) {
    const close = `\\end{${state.verbatim}}`;
    if (stream.match(close)) {
      const name = state.verbatim;
      state.verbatim = null;
      onEnd(state, name);
      return "command";
    }
    const idx = stream.string.indexOf(close, stream.pos);
    if (idx === -1) stream.skipToEnd();
    else stream.pos = idx;
    return state.envStack[state.envStack.length - 1] === "comment" ? "comment" : "verbatim";
  }

  if (state.pending) {
    const kind = state.pending;
    if (stream.eatSpace()) return null;
    if (kind === "begin" || kind === "end") {
      state.pending = null;
      const m = stream.match(/^\{([^{}]*)\}/) as RegExpMatchArray | null;
      if (m) {
        if (kind === "begin") onBegin(state, m[1].trim());
        else onEnd(state, m[1].trim());
        return "envName";
      }
    } else {
      if (stream.peek() === "*") {
        stream.next();
        return "command";
      }
      if (stream.peek() === "[") {
        eatGroup(stream, "[", "]");
        return "brace";
      }
      if (stream.peek() === "<" && kind === "heading") {
        eatGroup(stream, "<", ">");
        return "brace";
      }
      state.pending = null;
      if (stream.peek() === "{") {
        eatGroup(stream, "{", "}");
        return kind === "mathtext" ? null : kind;
      }
    }
  }

  const inMath = state.math !== null;
  const ch = stream.peek();

  if (ch === "%") {
    stream.skipToEnd();
    return "comment";
  }

  if (ch === "\\") {
    if (stream.match(/^\\verb\*?/)) {
      const delim = stream.next();
      if (delim) {
        while (!stream.eol() && stream.next() !== delim) {
          /* consume */
        }
      }
      return "verbatim";
    }
    if (stream.match("\\[")) {
      if (!inMath) state.math = { end: "\\]", env: null };
      return "mathDelim";
    }
    if (stream.match("\\(")) {
      if (!inMath) state.math = { end: "\\)", env: null };
      return "mathDelim";
    }
    if (inMath && (stream.match("\\]") || stream.match("\\)"))) {
      if (state.math?.end === stream.current()) state.math = null;
      return "mathDelim";
    }
    const m = stream.match(/^\\([a-zA-Z@]+)/) as RegExpMatchArray | null;
    if (m) {
      const name = m[1];
      if (name === "begin" || name === "end") {
        state.pending = name;
        return "command";
      }
      if (inMath) {
        if (TEXT_IN_MATH.has(name)) state.pending = "mathtext";
        return "mathCommand";
      }
      if (name in SECTION_LEVELS || name === "title") {
        state.pending = "heading";
        return "sectionCommand";
      }
      if (REF_CMDS.has(name)) state.pending = "ref";
      else if (PATH_CMDS.has(name)) state.pending = "path";
      return "command";
    }
    stream.next();
    stream.next();
    return inMath ? "mathCommand" : "special";
  }

  if (ch === "$") {
    if (stream.match("$$")) {
      if (!inMath) state.math = { end: "$$", env: null };
      else if (state.math?.end === "$$") state.math = null;
      return "mathDelim";
    }
    stream.next();
    if (!inMath) state.math = { end: "$", env: null };
    else if (state.math?.end === "$") state.math = null;
    return "mathDelim";
  }

  if (ch === "{" || ch === "}" || ch === "[" || ch === "]") {
    stream.next();
    return inMath ? "math" : "brace";
  }

  if (ch === "&" || ch === "~" || ch === "#" || ((ch === "^" || ch === "_") && inMath)) {
    stream.next();
    return inMath ? "mathCommand" : "special";
  }

  if (!stream.eatWhile(/[^\\$%{}[\]&~#^_]/)) stream.next();
  return inMath ? "math" : null;
}

const latexStream = StreamLanguage.define<State>({
  name: "latex",
  startState: () => ({ math: null, pending: null, verbatim: null, envStack: [] }),
  copyState: (s) => ({
    math: s.math ? { ...s.math } : null,
    pending: s.pending,
    verbatim: s.verbatim,
    envStack: s.envStack.slice(),
  }),
  token,
  blankLine(state) {
    // TeX ends paragraphs at blank lines, so inline math can't continue past one.
    if (state.math && (state.math.end === "$" || state.math.end === "\\)")) state.math = null;
    state.pending = null;
  },
  indent(state, textAfter, cx) {
    const depth = state.envStack.filter((e) => e !== "document").length;
    const closing = /^\s*\\end\b/.test(textAfter) ? 1 : 0;
    return Math.max(0, depth - closing) * cx.unit;
  },
  languageData: {
    commentTokens: { line: "%" },
    indentOnInput: /^\s*\\end\{[^}]*\}$/,
    closeBrackets: { brackets: ["(", "[", "{"] },
  },
  tokenTable: {
    command: latexTags.command,
    sectionCommand: latexTags.sectionCommand,
    envName: latexTags.envName,
    math: latexTags.math,
    mathCommand: latexTags.mathCommand,
    mathDelim: latexTags.mathDelim,
    heading: latexTags.heading,
    ref: latexTags.ref,
    path: latexTags.path,
    verbatim: latexTags.verbatim,
    special: latexTags.special,
    brace: latexTags.brace,
    comment: latexTags.comment,
  },
});

export const lightHighlight = HighlightStyle.define([
  { tag: latexTags.command, color: "#1d4ed8" },
  { tag: latexTags.sectionCommand, color: "#1d4ed8", fontWeight: "600" },
  { tag: latexTags.envName, color: "#0f766e", fontWeight: "500" },
  { tag: latexTags.math, color: "#9a3412" },
  { tag: latexTags.mathCommand, color: "#a21caf" },
  { tag: latexTags.mathDelim, color: "#c2410c", fontWeight: "600" },
  { tag: latexTags.heading, color: "#111827", fontWeight: "700" },
  { tag: latexTags.ref, color: "#047857" },
  { tag: latexTags.path, color: "#6d28d9" },
  { tag: latexTags.verbatim, color: "#475569" },
  { tag: latexTags.special, color: "#b45309" },
  { tag: latexTags.brace, color: "#64748b" },
  { tag: latexTags.comment, color: "#6b7280", fontStyle: "italic" },
]);

export const darkHighlight = HighlightStyle.define([
  { tag: latexTags.command, color: "#7aa2f7" },
  { tag: latexTags.sectionCommand, color: "#7aa2f7", fontWeight: "600" },
  { tag: latexTags.envName, color: "#5eead4", fontWeight: "500" },
  { tag: latexTags.math, color: "#fdba74" },
  { tag: latexTags.mathCommand, color: "#f0abfc" },
  { tag: latexTags.mathDelim, color: "#fb923c", fontWeight: "600" },
  { tag: latexTags.heading, color: "#f3f4f6", fontWeight: "700" },
  { tag: latexTags.ref, color: "#6ee7b7" },
  { tag: latexTags.path, color: "#c4b5fd" },
  { tag: latexTags.verbatim, color: "#a8b3c4" },
  { tag: latexTags.special, color: "#fbbf24" },
  { tag: latexTags.brace, color: "#8b95a7" },
  { tag: latexTags.comment, color: "#7d8799", fontStyle: "italic" },
]);

const BEGIN_RE = /\\begin\{([^}]+)\}/;
const SECTION_RE = /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?[[{]/;

/** Folds \begin...\end blocks and sectioning commands down to the next heading of equal or higher rank. */
const latexFolding = foldService.of((state: EditorState, lineStart: number, lineEnd: number) => {
  const text = state.doc.sliceString(lineStart, lineEnd);
  const commentAt = text.search(/(?<!\\)%/);
  const code = commentAt === -1 ? text : text.slice(0, commentAt);

  const begin = code.match(BEGIN_RE);
  if (begin && !code.includes(`\\end{${begin[1]}}`)) {
    const name = begin[1];
    const open = `\\begin{${name}}`;
    const close = `\\end{${name}}`;
    let depth = 1;
    const startLine = state.doc.lineAt(lineStart).number;
    for (let n = startLine + 1; n <= state.doc.lines && n < startLine + 20000; n++) {
      const line = state.doc.line(n);
      const lt = line.text;
      let idx = 0;
      for (;;) {
        const o = lt.indexOf(open, idx);
        const c = lt.indexOf(close, idx);
        if (c === -1 && o === -1) break;
        if (o !== -1 && (c === -1 || o < c)) {
          depth++;
          idx = o + open.length;
        } else {
          depth--;
          idx = c + close.length;
          if (depth === 0) {
            // Keep the \end line visible: fold up to the end of the line before it.
            const to = line.from - 1;
            return to > lineEnd ? { from: lineEnd, to } : null;
          }
        }
      }
    }
    return null;
  }

  const sec = code.match(SECTION_RE);
  if (sec) {
    const level = SECTION_LEVELS[sec[1]];
    const startLine = state.doc.lineAt(lineStart).number;
    let last = lineEnd;
    for (let n = startLine + 1; n <= state.doc.lines; n++) {
      const line = state.doc.line(n);
      const m = line.text.match(SECTION_RE);
      if ((m && SECTION_LEVELS[m[1]] <= level) || /^\s*\\end\{document\}/.test(line.text) || /^\s*\\(bibliography|printbibliography|appendix)\b/.test(line.text)) break;
      if (line.text.trim()) last = line.to;
    }
    return last > lineEnd ? { from: lineEnd, to: last } : null;
  }
  return null;
});

export function latex(): LanguageSupport {
  return new LanguageSupport(latexStream, [latexFolding]);
}
