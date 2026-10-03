# TeXbench

An Overleaf-style LaTeX editor built with Next.js: code on the left, PDF on the right.

## Features

- **Live preview**: auto-compiles after you pause typing (configurable), or compile with the button, `Ctrl/⌘+S` or `Ctrl/⌘+Enter`. The PDF swaps in without flicker and keeps your scroll position and zoom.
- **Resizable panes**: file tree and outline, editor, and PDF. Drag the dividers, collapse any pane, or switch between code only, both, and PDF only. On phones you get Code/PDF tabs and a file drawer.
- **Multi-file projects**: nested folders, new file and folder, upload (drag in files or whole folders, or a `.zip`), drag to move, rename, delete, download, and "Set as main document". Use `\input`/`\include` across files.
- **Editor** (CodeMirror 6): LaTeX highlighting (math, environments, refs, verbatim), autocomplete for commands, environments, `\ref` labels, `\cite` keys from your `.bib` files, `\includegraphics`/`\input` paths, packages and classes. Also auto `\end{…}`, `$` pairing, folding, find/replace, multiple cursors, a formatting toolbar, Vim mode and spell check.
- **Errors**: parsed log with errors, warnings and bad boxes, plain-English hints, click to jump to file:line, inline squiggles in the editor, and a raw log view.
- **Source ↔ PDF sync**: double-click the PDF to jump to the code, or use the `›` button / `Ctrl+Alt+→` to find the current line in the PDF. Exact (SyncTeX) with the local backend; text matching with the remote service.
- **Export**: download PDF, open it in a new tab to print, download the project as `.zip`, and import `.zip` files (Overleaf exports work).
- Templates (article, report/thesis, lab report, assignment, Beamer, letter, CV), pdfLaTeX/XeLaTeX/LuaLaTeX, BibTeX/Biber, word count, outline, dark mode.

Projects are saved in the browser (IndexedDB). There are no accounts or server-side storage.

## Compiling

`/api/compile` runs LaTeX through one of two backends (`LATEX_BACKEND=auto` picks local when `latexmk` is available):

| Backend | Where it runs | Notes |
| --- | --- | --- |
| `local` | TeX Live on the server (Docker image, VPS, your machine) | Fast, full logs and warnings, SyncTeX. |
| `remote` | [LaTeX-On-HTTP](https://github.com/YtoTech/latex-on-http) (`latex.ytotech.com` by default) | Works on Vercel. Logs only when a compile fails, so there are no warnings; text-based sync. |

The public LaTeX-On-HTTP instance is a free community service. For anything beyond personal use, self-host it (`docker run -p 8080:8080 yoarch/latex-on-http`) and set `LATEX_REMOTE_URL`. See `.env.example` for all settings.

## Development

```bash
npm install
npm run dev
```

If TeX Live isn't on your `PATH`, point `LATEX_BIN_DIR` at its `bin` directory in `.env.local`.

## Deploying

- **Vercel**: import the repo, no configuration needed (uses the remote backend). Requests are capped at 4.5 MB, so very image-heavy projects need the Docker route.
- **Docker** (includes TeX Live): `docker build -t texbench . && docker run -p 3000:3000 texbench`.

Security notes for public hosting with the local backend: latexmk runs with `-norc` (project rc files are ignored), restricted shell escape, `openin_any=p`/`openout_any=p`, a timeout and a concurrency cap. Still, run it in a container as the Dockerfile does.
