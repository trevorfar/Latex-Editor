import { SECTION_LEVELS } from "./language";

/** Removes % comments (but not \%) from each line. */
export function stripComments(text: string): string {
  return text.replace(/(^|[^\\])%.*$/gm, "$1");
}

function collect(re: RegExp, text: string, group = 1): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(re)) if (m[group]) out.push(m[group].trim());
  return out;
}

export function extractLabels(tex: string): string[] {
  return collect(/\\label\{([^}]+)\}/g, stripComments(tex));
}

export interface BibEntry {
  key: string;
  type: string;
  title?: string;
  author?: string;
  year?: string;
}

export function extractBibEntries(bib: string): BibEntry[] {
  const out: BibEntry[] = [];
  const re = /@(\w+)\s*[{(]\s*([^,\s]+)\s*,/g;
  for (const m of bib.matchAll(re)) {
    const type = m[1].toLowerCase();
    if (type === "string" || type === "comment" || type === "preamble") continue;
    // Look at the entry body (up to the next @) for a few display fields.
    const start = (m.index ?? 0) + m[0].length;
    const next = bib.indexOf("\n@", start);
    const body = bib.slice(start, next === -1 ? undefined : next);
    const field = (name: string) => {
      const f = body.match(new RegExp(`\\b${name}\\s*=\\s*[{"]\\s*((?:[^{}"]|\\{[^{}]*\\})*)`, "i"));
      return f ? f[1].replace(/[{}]/g, "").replace(/\s+/g, " ").trim() : undefined;
    };
    out.push({ key: m[2], type, title: field("title"), author: field("author"), year: field("year") });
  }
  return out;
}

export function extractBibItems(tex: string): string[] {
  return collect(/\\bibitem(?:\[[^\]]*\])?\{([^}]+)\}/g, stripComments(tex));
}

export interface UserCommand {
  name: string;
  args: number;
}

export function extractCommands(tex: string): UserCommand[] {
  const text = stripComments(tex);
  const out: UserCommand[] = [];
  for (const m of text.matchAll(/\\(?:re)?newcommand\*?\s*\{?\\([a-zA-Z@]+)\}?\s*(?:\[(\d)\])?/g)) {
    out.push({ name: m[1], args: m[2] ? Number(m[2]) : 0 });
  }
  for (const m of text.matchAll(/\\(?:DeclareMathOperator\*?|DeclareRobustCommand\*?|NewDocumentCommand|newcommandx)\s*\{?\\([a-zA-Z@]+)\}?/g)) {
    out.push({ name: m[1], args: 0 });
  }
  for (const m of text.matchAll(/\\(?:g|e|x)?def\s*\\([a-zA-Z@]+)/g)) out.push({ name: m[1], args: 0 });
  return out;
}

export function extractEnvironments(tex: string): string[] {
  const text = stripComments(tex);
  return [
    ...collect(/\\(?:re)?newenvironment\*?\s*\{([^}]+)\}/g, text),
    ...collect(/\\newtheorem\*?\s*\{([^}]+)\}/g, text),
    ...collect(/\\(?:New|Renew)DocumentEnvironment\s*\{([^}]+)\}/g, text),
    ...collect(/\\newtcolorbox\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g, text),
  ];
}

export function extractPackages(tex: string): string[] {
  const text = stripComments(tex);
  const out: string[] = [];
  for (const m of text.matchAll(/\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g)) {
    out.push(...m[1].split(",").map((s) => s.trim()).filter(Boolean));
  }
  return out;
}

export interface OutlineItem {
  level: number;
  title: string;
  line: number;
  starred: boolean;
}

/** Sectioning commands of one file, with 1-based line numbers. */
export function extractOutline(tex: string): OutlineItem[] {
  const out: OutlineItem[] = [];
  const lines = tex.split("\n");
  const re = /\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)(\*?)\s*(?:\[[^\]]*\])?\s*\{/;
  const frame = /\\begin\{frame\}(?:<[^>]*>)?(?:\[[^\]]*\])?\s*\{/;
  lines.forEach((raw, i) => {
    const line = raw.replace(/(^|[^\\])%.*$/, "$1");
    let m = line.match(re);
    let level: number;
    let starred = false;
    if (m) {
      level = SECTION_LEVELS[m[1]];
      starred = m[2] === "*";
    } else {
      m = line.match(frame) ?? line.match(/\\frametitle\s*\{/);
      if (!m) return;
      level = 3;
    }
    // Read the balanced title, possibly continuing on following lines.
    let rest = line.slice((m.index ?? 0) + m[0].length);
    let j = i;
    let depth = 1;
    let title = "";
    for (;;) {
      for (let k = 0; k < rest.length; k++) {
        const ch = rest[k];
        if (ch === "\\" && k + 1 < rest.length) {
          title += ch + rest[++k];
          continue;
        }
        if (ch === "{") depth++;
        if (ch === "}" && --depth === 0) break;
        title += ch;
      }
      if (depth === 0 || j >= i + 3 || j + 1 >= lines.length) break;
      rest = lines[++j];
      title += " ";
    }
    out.push({ level, title: cleanTitle(title), line: i + 1, starred });
  });
  return out;
}

function cleanTitle(s: string): string {
  return s
    .replace(/\\(?:textbf|textit|emph|texttt|textsc|underline|mbox|text)\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\(LaTeX|TeX)\{?\}?/g, "$1")
    .replace(/\\label\{[^}]*\}/g, "")
    .replace(/\\\\/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "(untitled)";
}

/** Files referenced via \input / \include / \subfile, resolved against known paths. */
export function extractIncludes(tex: string, known: Set<string>): string[] {
  const out: string[] = [];
  for (const m of stripComments(tex).matchAll(/\\(?:input|include|subfile)\s*\{([^}]+)\}/g)) {
    const p = m[1].trim().replace(/^\.\//, "");
    if (known.has(p)) out.push(p);
    else if (known.has(`${p}.tex`)) out.push(`${p}.tex`);
  }
  return out;
}

export interface WordCountResult {
  words: number;
  headers: number;
  mathInline: number;
  mathDisplay: number;
  figures: number;
  tables: number;
  characters: number;
}

/** A texcount-style estimate: words in body text, excluding commands, math and the preamble. */
export function wordCount(tex: string): WordCountResult {
  let text = stripComments(tex);
  const docStart = text.indexOf("\\begin{document}");
  if (docStart !== -1) text = text.slice(docStart + "\\begin{document}".length);
  const docEnd = text.indexOf("\\end{document}");
  if (docEnd !== -1) text = text.slice(0, docEnd);

  const count = (re: RegExp) => (text.match(re) ?? []).length;
  const result: WordCountResult = {
    words: 0,
    headers: count(/\\(?:part|chapter|section|subsection|subsubsection|paragraph)\*?\s*[[{]/g),
    mathInline: count(/(?<!\\)\$(?!\$)[^$]+(?<!\\)\$/g) + count(/\\\(/g),
    mathDisplay: count(/\\\[/g) + count(/\$\$/g) / 2 + count(/\\begin\{(?:equation|align|gather|multline|eqnarray|displaymath)\*?\}/g),
    figures: count(/\\begin\{figure\*?\}/g),
    tables: count(/\\begin\{table\*?\}/g),
    characters: 0,
  };

  const body = text
    .replace(/\\begin\{(equation|align|gather|multline|eqnarray|displaymath|tikzpicture|verbatim|lstlisting|minted|tabular|axis)\*?\}[\s\S]*?\\end\{\1\*?\}/g, " ")
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/\\\[[\s\S]*?\\\]/g, " ")
    .replace(/\\\([\s\S]*?\\\)/g, " ")
    .replace(/(?<!\\)\$[^$]*(?<!\\)\$/g, " ")
    // Commands whose arguments aren't prose.
    .replace(/\\(?:label|ref|eqref|cite\w*|includegraphics|input|include|usepackage|bibliography\w*|begin|end|vspace|hspace|url|href|pageref|autoref|cref|Cref|setlength|addtolength|newcommand|renewcommand)\*?(?:\[[^\]]*\])?(?:\{[^}]*\})?/g, " ")
    .replace(/\\[a-zA-Z@]+\*?/g, " ")
    .replace(/\\./g, " ")
    .replace(/[{}[\]&~^_#]/g, " ");

  const words = body.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
  result.words = words.length;
  result.characters = words.join("").length;
  result.mathDisplay = Math.round(result.mathDisplay);
  return result;
}
