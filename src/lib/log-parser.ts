export type LogLevel = "error" | "warning" | "typesetting";

export interface LogEntry {
  level: LogLevel;
  /** One-line summary. */
  message: string;
  /** Full context lines from the log. */
  content: string;
  /** Project-relative path when the entry points into the project, otherwise the raw path (or null). */
  file: string | null;
  /** True when `file` is a project file the editor can open. */
  inProject: boolean;
  line: number | null;
  hint?: string;
}

export interface ParsedLog {
  errors: LogEntry[];
  warnings: LogEntry[];
  typesetting: LogEntry[];
}

export interface ParseOptions {
  mainFile: string;
  projectFiles: string[];
  /** Join lines TeX wrapped at max_print_line (79). Off when the log was produced without wrapping. */
  unwrap: boolean;
}

const WRAP_LIMIT = 79;
const FILE_LINE_ERROR = /^((?:\.\/|\/|[A-Za-z]:[\\/])?[^:\n]*?):(\d+): (.*)$/;
const LATEX_WARNING = /^LaTeX(?:3| Font)? Warning: (.*)$/;
const PACKAGE_WARNING = /^(?:Package|Class|Module) (\S+) Warning: (.*)$/;
const BOX_WARNING = /^(Over|Under)full \\[hv]box/;
const INPUT_LINE = /on input line (\d+)/;
const BOX_LINES = /lines? (\d+)/;
const MAIN_DOCUMENT = /__main_document__\.tex/g;

const encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
function byteLength(s: string): number {
  if (!encoder || /^[\x00-\x7f]*$/.test(s)) return s.length;
  return encoder.encode(s).length;
}

function unwrapLines(text: string, unwrap: boolean): string[] {
  const raw = text.replace(/\r\n?/g, "\n").split("\n");
  if (!unwrap) return raw;
  const lines: string[] = [raw[0] ?? ""];
  for (let i = 1; i < raw.length; i++) {
    const prev = raw[i - 1];
    if (byteLength(prev) === WRAP_LIMIT && !prev.endsWith("...")) {
      lines[lines.length - 1] += raw[i];
    } else {
      lines.push(raw[i]);
    }
  }
  return lines;
}

const HINTS: [RegExp, string][] = [
  [/Undefined control sequence/, "A command isn't defined. Check its spelling, or load the package that provides it with \\usepackage."],
  [/Missing \$ inserted/, "Math-only syntax (like ^, _ or \\alpha) appeared outside math mode, or a math block wasn't closed. Wrap it in $...$."],
  [/File `(.+)' not found/, "LaTeX can't find a file. Check the name and path, or upload it. For packages, check the spelling."],
  [/Missing \\begin\{document\}/, "Text or commands appear before \\begin{document}, or the preamble has a stray character."],
  [/\\begin\{(.+)\} on input line \d+ ended by \\end\{(.+)\}/, "Environments are mismatched. Every \\begin{x} needs a matching \\end{x}, nested in order."],
  [/Environment (.+) undefined/, "This environment doesn't exist. Check the name or load the package that defines it."],
  [/Extra alignment tab has been changed to \\cr/, "A table row has more & columns than the column spec declares."],
  [/Misplaced alignment tab character &/, "An & appears outside a table or align environment. Write \\& for a literal ampersand."],
  [/Paragraph ended before (.+) was complete/, "A command's argument contains a blank line or is missing its closing brace."],
  [/Extra \}, or forgotten (\$|\\endgroup|\\right)/, "Braces are unbalanced. Look for an extra } or a missing {."],
  [/Missing \} inserted/, "Braces are unbalanced. Look for a missing }."],
  [/Too many \}'s/, "There is a } without a matching {."],
  [/Display math should end with \$\$/, "A $$ display wasn't closed properly. Prefer \\[ ... \\]."],
  [/There's no line here to end/, "\\\\ was used where no line is being built, e.g. right after a blank line or at the start of a paragraph."],
  [/Citation `(.+)' on page (\d+) undefined/, "This citation key isn't in your bibliography, or the bibliography hasn't been processed yet."],
  [/Reference `(.+)' on page (\d+) undefined/, "No \\label with this name exists, or a recompile is needed."],
  [/Label `(.+)' multiply defined/, "Two \\label commands use the same name. Labels must be unique."],
  [/Float too large for page/, "A figure or table is taller than the page. Scale it down."],
  [/Unicode character (.+) not set up for use with LaTeX/, "This character isn't supported by pdfLaTeX. Use a LaTeX command for it, or switch the compiler to XeLaTeX or LuaLaTeX."],
  [/Missing character: There is no/, "The font has no glyph for a character. Pick a font that covers it."],
  [/Overfull \\hbox/, "A line sticks out into the margin. Rephrase, add hyphenation hints (\\-), or resize the content."],
  [/Underfull \\hbox/, "A line is spaced too loosely, often from a manual \\\\ or a short line. Usually harmless."],
  [/Option clash for package (.+)\./, "A package is loaded twice with different options. Load it once with all options."],
  [/Can be used only in preamble/, "This command must come before \\begin{document}."],
  [/LaTeX Error: Lonely \\item/, "\\item must be inside a list environment like itemize or enumerate."],
  [/Something's wrong--perhaps a missing \\item/, "A list environment has content before its first \\item, or \\\\ was used where it can't be."],
  [/Illegal unit of measure/, "A length is missing its unit (pt, cm, mm, in, em, \\textwidth...)."],
  [/Double superscript|Double subscript/, "Two ^ or _ in a row. Group them with braces, e.g. x^{a^b}."],
  [/I can't find file|Emergency stop/, "LaTeX stopped early. Fix the first error above; later errors often follow from it."],
];

function hintFor(message: string): string | undefined {
  for (const [re, hint] of HINTS) if (re.test(message)) return hint;
  return undefined;
}

export function parseLatexLog(text: string, opts: ParseOptions): ParsedLog {
  const lines = unwrapLines(text.replace(MAIN_DOCUMENT, opts.mainFile), opts.unwrap);
  const known = new Set(opts.projectFiles);

  const resolveFile = (raw: string | null): { file: string | null; inProject: boolean } => {
    if (!raw) return { file: null, inProject: false };
    let p = raw.trim().replace(/^"(.*)"$/, "$1");
    while (p.startsWith("./")) p = p.slice(2);
    if (known.has(p)) return { file: p, inProject: true };
    // TeX may omit the .tex extension for \input{chapter}.
    if (known.has(`${p}.tex`)) return { file: `${p}.tex`, inProject: true };
    // Absolute path into the compile directory (local backend in some setups).
    for (const k of known) {
      if (p.endsWith(`/${k}`)) return { file: k, inProject: true };
    }
    return { file: p, inProject: false };
  };

  // File stack, tracked through TeX's "(file ... )" notation.
  const fileStack: string[] = [];
  let openParens = 0;
  const currentFile = () => (fileStack.length ? fileStack[fileStack.length - 1] : opts.mainFile);

  const consumeParens = (line: string) => {
    let rest = line;
    for (;;) {
      const pos = rest.search(/[()]/);
      if (pos === -1) return;
      const token = rest[pos];
      rest = rest.slice(pos + 1);
      if (token === "(") {
        const m = rest.match(/^"?((?:\.{0,2}\/|[A-Za-z]:[\\/]|\/)?(?:[^ ()"\n]+\/)*[^ ()"\n]+\.[A-Za-z0-9]+)"?/);
        if (m && (m[1].includes("/") || /\.(tex|sty|cls|cfg|def|clo|aux|toc|bbl|fd|ldf|lof|lot|out|nav|snm)$/.test(m[1]))) {
          fileStack.push(m[1]);
          rest = rest.slice(m[0].length);
        } else {
          openParens++;
        }
      } else if (openParens > 0) {
        openParens--;
      } else if (fileStack.length > 0) {
        fileStack.pop();
      }
    }
  };

  const result: ParsedLog = { errors: [], warnings: [], typesetting: [] };
  const seen = new Set<string>();
  const push = (entry: LogEntry) => {
    const key = `${entry.level}|${entry.file}|${entry.line}|${entry.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (entry.level === "error") result.errors.push(entry);
    else if (entry.level === "warning") result.warnings.push(entry);
    else result.typesetting.push(entry);
  };

  /** Collects the error context: following lines up to a blank line (bounded). */
  const collectContext = (start: number, max = 14): { content: string; lineNo: number | null; end: number } => {
    const out: string[] = [];
    let lineNo: number | null = null;
    let i = start;
    for (; i < lines.length && out.length < max; i++) {
      const l = lines[i];
      if (l.trim() === "" && out.length > 0) break;
      if (i > start && (FILE_LINE_ERROR.test(l) || l.startsWith("! "))) break;
      out.push(l);
      const m = l.match(/^l\.(\d+)/);
      if (m && lineNo === null) lineNo = Number(m[1]);
    }
    return { content: out.join("\n"), lineNo, end: i };
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fle = line.match(FILE_LINE_ERROR);
    if (fle && !/^\s/.test(line) && /\.\w+$/.test(fle[1]) && !line.startsWith("l.")) {
      const message = fle[3].trim();
      if (message.startsWith("==> Fatal error occurred")) continue;
      const ctx = collectContext(i);
      const { file, inProject } = resolveFile(fle[1]);
      push({ level: "error", message, content: ctx.content, file, inProject, line: Number(fle[2]), hint: hintFor(message) });
      i = Math.max(i, ctx.end - 1);
      continue;
    }

    if (line.startsWith("! ")) {
      const message = line.slice(2).trim();
      const ctx = collectContext(i);
      const { file, inProject } = resolveFile(currentFile());
      push({ level: "error", message, content: ctx.content, file, inProject, line: ctx.lineNo, hint: hintFor(message) });
      i = Math.max(i, ctx.end - 1);
      continue;
    }

    if (BOX_WARNING.test(line)) {
      const m = line.match(BOX_LINES);
      const { file, inProject } = resolveFile(currentFile());
      // The offending box contents follow on the next line(s).
      let content = line;
      if (lines[i + 1] && !lines[i + 1].startsWith("[") && lines[i + 1].trim()) content += "\n" + lines[i + 1];
      push({ level: "typesetting", message: line.trim(), content, file, inProject, line: m ? Number(m[1]) : null, hint: hintFor(line) });
      consumeParens(line);
      continue;
    }

    let warning = line.match(LATEX_WARNING);
    let pkg: string | null = null;
    let message: string | null = warning ? warning[1] : null;
    if (!warning) {
      warning = line.match(PACKAGE_WARNING);
      if (warning) {
        pkg = warning[1];
        message = `${pkg}: ${warning[2]}`;
      }
    }
    if (warning && message !== null) {
      // Continuation lines are prefixed with "(pkg)" or "(Font)" and padding.
      let j = i + 1;
      const cont = new RegExp(`^\\((?:${pkg ? pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "Font"})\\)\\s+(.*)$`);
      while (j < lines.length) {
        const m = lines[j].match(cont);
        if (!m) break;
        message += " " + m[1];
        j++;
      }
      const lm = message.match(INPUT_LINE);
      const { file, inProject } = resolveFile(currentFile());
      push({ level: "warning", message: message.trim(), content: lines.slice(i, j).join("\n"), file, inProject, line: lm ? Number(lm[1]) : null, hint: hintFor(message) });
      i = j - 1;
      continue;
    }

    const missing = line.match(/^Missing character: There is no (.+)!$/);
    if (missing) {
      const { file, inProject } = resolveFile(currentFile());
      push({ level: "warning", message: line.trim(), content: line, file, inProject, line: null, hint: hintFor(line) });
      continue;
    }

    consumeParens(line);
  }

  // "Emergency stop" only restates an earlier error.
  if (result.errors.length > 1) {
    result.errors = result.errors.filter((e) => !/^Emergency stop/.test(e.message) && !/^==> Fatal error/.test(e.message));
  }
  return result;
}

/** Extracts the useful tail of latexmk output when no TeX log exists (e.g. bibtex/biber failures). */
export function summarizeOutput(output: string): LogEntry[] {
  const entries: LogEntry[] = [];
  const lines = output.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const bib = l.match(/^(?:ERROR|FATAL) - (.*)$/) || l.match(/^(I couldn't open .*|I found no .*|Illegal, another \\bib.*|Repeated entry.*)$/);
    if (bib) {
      entries.push({ level: "error", message: `Bibliography: ${bib[1]}`, content: lines.slice(i, i + 3).join("\n"), file: null, inProject: false, line: null });
    }
    const warn = l.match(/^WARN - (.*)$/) || l.match(/^Warning--(.*)$/);
    if (warn) {
      entries.push({ level: "warning", message: `Bibliography: ${warn[1]}`, content: l, file: null, inProject: false, line: null });
    }
  }
  return entries;
}
