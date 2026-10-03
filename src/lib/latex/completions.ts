import {
  snippet,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import { DOCUMENT_CLASSES, ENVIRONMENTS, MATH_COMMANDS, PACKAGES, TEXT_COMMANDS, type EnvSpec } from "./data";
import type { BibEntry, UserCommand } from "./scan";
import { isBibPath, isGraphicPath, isTexPath, stripExtension } from "../paths";

export interface ProjectIndex {
  labels: string[];
  bibEntries: BibEntry[];
  commands: UserCommand[];
  environments: string[];
  files: string[];
}

function envTemplate(env: EnvSpec): string {
  const body = env.body ?? "\t#{}";
  return `${env.name}}${env.arg ?? ""}\n${body}\n\\end{${env.name}}`;
}

/** Applies a snippet, also swallowing a "}" that closeBrackets put after the cursor. */
function applySnippet(template: string, swallowBrace: boolean) {
  const apply = snippet(template);
  return (view: EditorView, completion: Completion, from: number, to: number) => {
    const next = view.state.sliceDoc(to, to + 1);
    apply(view, completion, from, swallowBrace && next === "}" ? to + 1 : to);
  };
}

const commandOptions: Completion[] = [
  ...[...TEXT_COMMANDS, ...MATH_COMMANDS].map(([name, args, detail]) => ({
    label: `\\${name}`,
    detail,
    type: "keyword",
    apply: args ? snippet(`\\${name}${args}`) : `\\${name}`,
  })),
  ...ENVIRONMENTS.filter((e) => e.name !== "document").map((env) => ({
    label: `\\begin{${env.name}}`,
    detail: env.detail,
    type: "class",
    boost: -1,
    apply: snippet(`\\begin{${envTemplate(env)}`),
  })),
];

const envNames = new Map(ENVIRONMENTS.map((e) => [e.name, e]));

/** Name of the innermost environment open at `pos`, for completing \end{. */
function openEnvironment(text: string): string | null {
  const stack: string[] = [];
  for (const m of text.matchAll(/\\(begin|end)\{([^}]+)\}/g)) {
    if (m[1] === "begin") stack.push(m[2]);
    else {
      const i = stack.lastIndexOf(m[2]);
      if (i !== -1) stack.length = i;
    }
  }
  return stack.length ? stack[stack.length - 1] : null;
}

export function latexCompletions(getIndex: () => ProjectIndex) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = line.text.slice(0, ctx.pos - line.from);
    // Don't complete inside comments.
    if (/(^|[^\\])%/.test(before)) return null;
    const index = getIndex();
    const argValid = /^[^},]*$/;

    let m = before.match(/\\(begin|end)\{([^}]*)$/);
    if (m) {
      const from = ctx.pos - m[2].length;
      if (m[1] === "end") {
        const open = openEnvironment(ctx.state.sliceDoc(Math.max(0, ctx.pos - 50000), line.from + (before.length - m[0].length)));
        const names = new Set([...(open ? [open] : []), ...ENVIRONMENTS.map((e) => e.name), ...index.environments]);
        return {
          from,
          validFor: argValid,
          options: [...names].map((name, i) => ({
            label: name,
            type: "class",
            boost: name === open && i === 0 ? 50 : 0,
            apply: (view: EditorView, _c: Completion, f: number, t: number) => {
              const next = view.state.sliceDoc(t, t + 1);
              view.dispatch({ changes: { from: f, to: next === "}" ? t + 1 : t, insert: `${name}}` }, selection: { anchor: f + name.length + 1 } });
            },
          })),
        };
      }
      const names = new Map(envNames);
      for (const name of index.environments) if (!names.has(name)) names.set(name, { name, detail: "Defined in project" });
      return {
        from,
        validFor: argValid,
        options: [...names.values()].map((env) => ({
          label: env.name,
          detail: env.detail,
          type: "class",
          apply: applySnippet(envTemplate(env), true),
        })),
      };
    }

    m = before.match(/\\(?:[a-zA-Z]*ref|[cC]ref|autoref|eqref|nameref|vref|crefrange)\*?(?:\[[^\]]*\])?\{(?:[^}]*,)?\s*([^},]*)$/);
    if (m) {
      return {
        from: ctx.pos - m[1].length,
        validFor: argValid,
        options: [...new Set(index.labels)].map((label) => ({ label, type: "variable" })),
      };
    }

    m = before.match(/\\(?:[a-zA-Z]*cite[a-zA-Z]*|nocite)\*?(?:\[[^\]]*\]){0,2}\{(?:[^}]*,)?\s*([^},]*)$/);
    if (m) {
      return {
        from: ctx.pos - m[1].length,
        validFor: argValid,
        options: index.bibEntries.map((e) => ({
          label: e.key,
          type: "text",
          detail: [e.author?.split(/\s+and\s+/)[0]?.split(",")[0], e.year].filter(Boolean).join(", "),
          info: e.title,
        })),
      };
    }

    m = before.match(/\\(includegraphics|includepdf)\*?(?:\[[^\]]*\])?\{([^}]*)$/);
    if (m) {
      return {
        from: ctx.pos - m[2].length,
        validFor: /^[^}]*$/,
        options: index.files.filter(isGraphicPath).map((p) => ({ label: p, type: "constant" })),
      };
    }

    m = before.match(/\\(input|include|subfile|includeonly)\{([^}]*)$/);
    if (m) {
      const cmd = m[1];
      return {
        from: ctx.pos - m[2].length,
        validFor: /^[^}]*$/,
        options: index.files.filter(isTexPath).map((p) => ({
          label: cmd === "input" ? p : stripExtension(p),
          type: "constant",
        })),
      };
    }

    m = before.match(/\\(bibliography|addbibresource)\{(?:[^}]*,)?([^},]*)$/);
    if (m) {
      const keepExt = m[1] === "addbibresource";
      return {
        from: ctx.pos - m[2].length,
        validFor: argValid,
        options: index.files.filter(isBibPath).map((p) => ({ label: keepExt ? p : stripExtension(p), type: "constant" })),
      };
    }

    m = before.match(/\\(?:usepackage|RequirePackage)(?:\[[^\]]*\])?\{(?:[^}]*,)?\s*([^},]*)$/);
    if (m) {
      return {
        from: ctx.pos - m[1].length,
        validFor: argValid,
        options: PACKAGES.map(([label, detail]) => ({ label, detail, type: "namespace" })),
      };
    }

    m = before.match(/\\documentclass(?:\[[^\]]*\])?\{([^}]*)$/);
    if (m) {
      return {
        from: ctx.pos - m[1].length,
        validFor: argValid,
        options: DOCUMENT_CLASSES.map(([label, detail]) => ({ label, detail, type: "namespace" })),
      };
    }

    const word = ctx.matchBefore(/\\[a-zA-Z@]*/);
    if (word) {
      // A lone "\" right after another "\" is a line break, not a command.
      if (word.text === "\\" && before.endsWith("\\\\")) return null;
      const known = new Set(commandOptions.map((o) => o.label));
      const user: Completion[] = [];
      for (const c of index.commands) {
        const label = `\\${c.name}`;
        if (known.has(label)) continue;
        known.add(label);
        user.push({
          label,
          detail: "Defined in project",
          type: "function",
          boost: 1,
          apply: c.args ? snippet(label + "{#{}}".repeat(c.args)) : label,
        });
      }
      return { from: word.from, validFor: /^\\[a-zA-Z@]*$/, options: [...user, ...commandOptions] };
    }
    return null;
  };
}
