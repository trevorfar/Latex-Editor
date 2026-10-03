import type { Compiler } from "./types";

export interface TemplateFile {
  path: string;
  content: string;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  mainFile: string;
  compiler: Compiler;
  files: TemplateFile[];
}

const ARTICLE_BIB = String.raw`@book{knuth1984,
  author    = {Donald E. Knuth},
  title     = {The {\TeX}book},
  publisher = {Addison-Wesley},
  year      = {1984},
}

@article{lamport1994,
  author  = {Leslie Lamport},
  title   = {{\LaTeX}: A Document Preparation System},
  journal = {Addison-Wesley Professional},
  year    = {1994},
}

@misc{tantau2023,
  author = {Till Tantau},
  title  = {The {TikZ} and {PGF} Packages},
  year   = {2023},
  note   = {Manual for version 3.1.10},
}
`;

export const TEMPLATES: Template[] = [
  {
    id: "blank",
    name: "Blank document",
    description: "A minimal article to start from scratch.",
    mainFile: "main.tex",
    compiler: "pdflatex",
    files: [
      {
        path: "main.tex",
        content: String.raw`\documentclass{article}
\usepackage[utf8]{inputenc}
\usepackage{amsmath}

\title{Untitled}
\author{}
\date{\today}

\begin{document}

\maketitle

Start writing here.

\end{document}
`,
      },
    ],
  },
  {
    id: "article",
    name: "Article",
    description: "Sections, math, a figure, a table and a bibliography.",
    mainFile: "main.tex",
    compiler: "pdflatex",
    files: [
      {
        path: "main.tex",
        content: String.raw`\documentclass[11pt]{article}
\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\usepackage[margin=1in]{geometry}
\usepackage{amsmath, amssymb, amsthm}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{tikz}
\usepackage[colorlinks=true, linkcolor=blue, citecolor=teal]{hyperref}

\newtheorem{theorem}{Theorem}

\title{A Short Article}
\author{Your Name \\ \small Your Institution}
\date{\today}

\begin{document}

\maketitle

\begin{abstract}
This template shows the essentials: sections, equations, cross-references,
figures, tables and citations. Edit anything on the left and the PDF on the
right updates when you compile.
\end{abstract}

\section{Introduction}
\label{sec:intro}

\LaTeX{} was created by Leslie Lamport~\cite{lamport1994} on top of Donald
Knuth's \TeX{}~\cite{knuth1984}. Section~\ref{sec:math} has some mathematics,
Figure~\ref{fig:circle} a drawing and Table~\ref{tab:results} some data.

\section{Mathematics}
\label{sec:math}

Inline math sits within text, like $e^{i\pi} + 1 = 0$. Display math gets its
own line and can be numbered:
\begin{equation}
  \int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}.
  \label{eq:gauss}
\end{equation}
Equation~\eqref{eq:gauss} is the Gaussian integral.

\begin{theorem}[Pythagoras]
For a right triangle with legs $a, b$ and hypotenuse $c$,
\[ a^2 + b^2 = c^2. \]
\end{theorem}

Aligned equations:
\begin{align}
  f(x) &= (x + 1)^2 \\
       &= x^2 + 2x + 1.
\end{align}

\section{Figures and tables}

\begin{figure}[ht]
  \centering
  \begin{tikzpicture}
    \draw[thick, ->] (-2.2, 0) -- (2.2, 0) node[right] {$x$};
    \draw[thick, ->] (0, -2.2) -- (0, 2.2) node[above] {$y$};
    \draw[blue, very thick] (0, 0) circle (1.5);
    \draw[red, dashed] (0, 0) -- (1.06, 1.06) node[midway, above left] {$r$};
  \end{tikzpicture}
  \caption{A circle drawn with Ti\emph{k}Z~\cite{tantau2023}.}
  \label{fig:circle}
\end{figure}

\begin{table}[ht]
  \centering
  \begin{tabular}{lrr}
    \toprule
    Method & Time (s) & Accuracy (\%) \\
    \midrule
    Baseline & 12.4 & 81.2 \\
    Improved & 9.8  & 88.7 \\
    \bottomrule
  \end{tabular}
  \caption{Example results.}
  \label{tab:results}
\end{table}

\section{Conclusion}

That's the tour. Press \texttt{Ctrl+S} (or \texttt{Cmd+S}) to compile.

\bibliographystyle{plain}
\bibliography{references}

\end{document}
`,
      },
      { path: "references.bib", content: ARTICLE_BIB },
    ],
  },
  {
    id: "report",
    name: "Report / thesis",
    description: "Multi-file book-style report with chapters and a bibliography.",
    mainFile: "main.tex",
    compiler: "pdflatex",
    files: [
      {
        path: "main.tex",
        content: String.raw`\documentclass[11pt, oneside]{report}
\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\usepackage[margin=1in]{geometry}
\usepackage{amsmath, amssymb}
\usepackage{graphicx}
\usepackage[hidelinks]{hyperref}

\title{\textbf{Report Title}\\[1ex] \large A Subtitle}
\author{Your Name}
\date{\today}

\begin{document}

\maketitle
\tableofcontents

% Each chapter lives in its own file under chapters/.
\include{chapters/introduction}
\include{chapters/background}
\include{chapters/conclusion}

\bibliographystyle{plain}
\bibliography{references}

\end{document}
`,
      },
      {
        path: "chapters/introduction.tex",
        content: String.raw`\chapter{Introduction}
\label{ch:intro}

Large documents are easier to manage when split across files. This chapter is
\texttt{chapters/introduction.tex}, pulled in with \verb|\include|.

\section{Motivation}
Explain why the work matters. Cite sources like this~\cite{knuth1984}.

\section{Outline}
Chapter~\ref{ch:background} covers background and
Chapter~\ref{ch:conclusion} concludes.
`,
      },
      {
        path: "chapters/background.tex",
        content: String.raw`\chapter{Background}
\label{ch:background}

\section{Prior work}
Summarise related work here~\cite{lamport1994}.

\section{Theory}
\begin{equation}
  \nabla \cdot \mathbf{E} = \frac{\rho}{\varepsilon_0}
  \label{eq:gauss-law}
\end{equation}
`,
      },
      {
        path: "chapters/conclusion.tex",
        content: String.raw`\chapter{Conclusion}
\label{ch:conclusion}

Summarise the findings and suggest future work.
`,
      },
      { path: "references.bib", content: ARTICLE_BIB },
    ],
  },
  {
    id: "lab",
    name: "Lab report",
    description: "Engineering lab report with units, tables and a plotted dataset.",
    mainFile: "main.tex",
    compiler: "pdflatex",
    files: [
      {
        path: "main.tex",
        content: String.raw`\documentclass[11pt]{article}
\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\usepackage[margin=1in]{geometry}
\usepackage{amsmath}
\usepackage{siunitx}
\usepackage{booktabs}
\usepackage{pgfplots}
\pgfplotsset{compat=1.18}
\usepackage{float}
\usepackage[hidelinks]{hyperref}

\begin{document}

\begin{titlepage}
  \centering
  \vspace*{2cm}
  {\LARGE\bfseries Lab 1: RC Circuit Transient Response\par}
  \vspace{1.5cm}
  {\large Your Name \quad Partner Name\par}
  \vspace{0.5cm}
  {\large COURSE 101 --- Section 001\par}
  \vfill
  {\large \today\par}
\end{titlepage}

\section{Objective}
Measure the time constant of an RC circuit and compare it to the theoretical
value $\tau = RC$.

\section{Theory}
When a capacitor charges through a resistor from a step input $V_s$,
\begin{equation}
  v_C(t) = V_s\left(1 - e^{-t/\tau}\right), \qquad \tau = RC.
  \label{eq:charge}
\end{equation}
With $R = \SI{10}{\kilo\ohm}$ and $C = \SI{100}{\micro\farad}$,
$\tau = \SI{1.0}{\second}$.

\section{Procedure}
\begin{enumerate}
  \item Build the circuit on a breadboard.
  \item Apply a \SI{5}{\volt} step and record $v_C$ every \SI{0.5}{\second}.
  \item Repeat three times and average.
\end{enumerate}

\section{Results}

\begin{table}[H]
  \centering
  \caption{Measured capacitor voltage.}
  \label{tab:data}
  \begin{tabular}{S[table-format=1.1] S[table-format=1.2]}
    \toprule
    {Time (\si{\second})} & {$v_C$ (\si{\volt})} \\
    \midrule
    0.0 & 0.00 \\
    0.5 & 1.94 \\
    1.0 & 3.15 \\
    1.5 & 3.88 \\
    2.0 & 4.31 \\
    3.0 & 4.75 \\
    \bottomrule
  \end{tabular}
\end{table}

\begin{figure}[H]
  \centering
  \begin{tikzpicture}
    \begin{axis}[
      width=0.8\linewidth, height=6cm,
      xlabel={Time (\si{\second})}, ylabel={$v_C$ (\si{\volt})},
      grid=major, legend pos=south east]
      \addplot[only marks, mark=*, blue] coordinates {
        (0,0) (0.5,1.94) (1,3.15) (1.5,3.88) (2,4.31) (3,4.75)};
      \addlegendentry{Measured}
      \addplot[red, thick, domain=0:3, samples=100] {5*(1-exp(-x))};
      \addlegendentry{Theory, Eq.~\eqref{eq:charge}}
    \end{axis}
  \end{tikzpicture}
  \caption{Charging curve.}
  \label{fig:curve}
\end{figure}

\section{Discussion}
The data in Table~\ref{tab:data} follow the model closely (Figure~\ref{fig:curve}).
Discuss sources of error here.

\section{Conclusion}
Summarise the measured time constant and percent error.

\end{document}
`,
      },
    ],
  },
  {
    id: "homework",
    name: "Assignment",
    description: "Problem set with numbered problems and solutions.",
    mainFile: "main.tex",
    compiler: "pdflatex",
    files: [
      {
        path: "main.tex",
        content: String.raw`\documentclass[11pt]{article}
\usepackage[utf8]{inputenc}
\usepackage[margin=1in]{geometry}
\usepackage{amsmath, amssymb, amsthm}
\usepackage{enumitem}
\usepackage{fancyhdr}

\newcommand{\coursename}{COURSE 101}
\newcommand{\assignment}{Assignment 1}
\newcommand{\studentname}{Your Name}

\pagestyle{fancy}
\fancyhf{}
\lhead{\studentname}
\chead{\coursename}
\rhead{\assignment}
\cfoot{\thepage}

\theoremstyle{definition}
\newtheorem{problem}{Problem}
\newenvironment{solution}{\begin{proof}[Solution]}{\end{proof}}

\newcommand{\R}{\mathbb{R}}

\begin{document}

\begin{center}
  {\Large\bfseries \coursename{} --- \assignment}\\[0.5ex]
  \studentname \quad \today
\end{center}

\begin{problem}
Show that $\sum_{k=1}^{n} k = \dfrac{n(n+1)}{2}$ for all $n \ge 1$.
\end{problem}

\begin{solution}
By induction. For $n = 1$ both sides equal $1$. Assume it holds for $n$. Then
\[
  \sum_{k=1}^{n+1} k = \frac{n(n+1)}{2} + (n+1) = \frac{(n+1)(n+2)}{2}. \qedhere
\]
\end{solution}

\begin{problem}
Let $f : \R \to \R$, $f(x) = x^3 - 3x$.
\begin{enumerate}[label=(\alph*)]
  \item Find the critical points of $f$.
  \item Classify each as a local maximum or minimum.
\end{enumerate}
\end{problem}

\begin{solution}
\begin{enumerate}[label=(\alph*)]
  \item $f'(x) = 3x^2 - 3 = 0 \implies x = \pm 1$.
  \item $f''(x) = 6x$, so $x = -1$ is a local maximum and $x = 1$ a local minimum.
\end{enumerate}
\end{solution}

\end{document}
`,
      },
    ],
  },
  {
    id: "beamer",
    name: "Presentation (Beamer)",
    description: "Slides with a title page, bullets, columns and math.",
    mainFile: "main.tex",
    compiler: "pdflatex",
    files: [
      {
        path: "main.tex",
        content: String.raw`\documentclass[aspectratio=169]{beamer}
\usetheme{Madrid}
\usecolortheme{default}
\usepackage{amsmath}
\usepackage{tikz}

\title{Presentation Title}
\subtitle{A Subtitle}
\author{Your Name}
\institute{Your Institution}
\date{\today}

\begin{document}

\frame{\titlepage}

\begin{frame}{Outline}
  \tableofcontents
\end{frame}

\section{Introduction}

\begin{frame}{Bullet points}
  \begin{itemize}
    \item<1-> Points can appear one at a time
    \item<2-> using overlay specifications
    \item<3-> like \texttt{\textbackslash item<2->}
  \end{itemize}
\end{frame}

\section{Content}

\begin{frame}{Two columns}
  \begin{columns}
    \column{0.5\textwidth}
    Text on the left, with math:
    \[ \hat{f}(\xi) = \int_{-\infty}^{\infty} f(x)\, e^{-2\pi i x \xi}\, dx \]

    \column{0.5\textwidth}
    \centering
    \begin{tikzpicture}
      \fill[blue!30] (0,0) rectangle (2,1.5);
      \fill[red!40] (1,0.75) circle (0.6);
    \end{tikzpicture}
  \end{columns}
\end{frame}

\begin{frame}{Blocks}
  \begin{block}{Definition}
    A block highlights important content.
  \end{block}
  \begin{alertblock}{Warning}
    Alert blocks draw attention.
  \end{alertblock}
  \begin{exampleblock}{Example}
    Example blocks show examples.
  \end{exampleblock}
\end{frame}

\end{document}
`,
      },
    ],
  },
  {
    id: "letter",
    name: "Letter",
    description: "Formal letter with addresses, opening and closing.",
    mainFile: "main.tex",
    compiler: "pdflatex",
    files: [
      {
        path: "main.tex",
        content: String.raw`\documentclass[11pt]{letter}
\usepackage[utf8]{inputenc}
\usepackage[margin=1in]{geometry}

\signature{Your Name}
\address{123 Your Street \\ Your City, Province A1B 2C3 \\ you@example.com}

\begin{document}

\begin{letter}{Hiring Manager \\ Company Name \\ 456 Their Street \\ Their City}

\opening{Dear Hiring Manager,}

I am writing to express my interest in the position advertised on your
website. My background in engineering and my experience with ... make me a
strong fit for the role.

In my previous position, I ...

Thank you for your time and consideration. I look forward to hearing from you.

\closing{Sincerely,}

\end{letter}
\end{document}
`,
      },
    ],
  },
  {
    id: "cv",
    name: "CV / Résumé",
    description: "One-page résumé with sections for education, experience and skills.",
    mainFile: "main.tex",
    compiler: "pdflatex",
    files: [
      {
        path: "main.tex",
        content: String.raw`\documentclass[10pt, letterpaper]{article}
\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\usepackage[margin=0.6in]{geometry}
\usepackage{titlesec}
\usepackage{enumitem}
\usepackage[hidelinks]{hyperref}
\usepackage{xcolor}

\pagestyle{empty}
\setlength{\parindent}{0pt}
\definecolor{accent}{RGB}{30, 80, 160}

\titleformat{\section}{\large\bfseries\color{accent}}{}{0em}{}[{\color{accent}\titlerule}]
\titlespacing*{\section}{0pt}{10pt}{6pt}
\setlist[itemize]{leftmargin=1.2em, itemsep=1pt, topsep=2pt}

\newcommand{\entry}[4]{%
  \textbf{#1} \hfill #2 \\
  \textit{#3} \hfill \textit{#4} \\[-2pt]}

\begin{document}

\begin{center}
  {\Huge\bfseries Your Name}\\[4pt]
  City, Province \,|\, (555) 555-5555 \,|\,
  \href{mailto:you@example.com}{you@example.com} \,|\,
  \href{https://github.com/you}{github.com/you}
\end{center}

\section{Education}
\entry{University Name}{Sept 2023 -- Apr 2027}{Bachelor of Applied Science, Engineering}{GPA 3.8/4.0}
\begin{itemize}
  \item Relevant courses: Digital Systems, Signals and Systems, Software Engineering
\end{itemize}

\section{Experience}
\entry{Company Name}{May 2025 -- Aug 2025}{Software Engineering Intern}{City, Province}
\begin{itemize}
  \item Built a feature that did something measurable, improving a metric by 30\%.
  \item Wrote tests and documentation for a service used by 5 teams.
\end{itemize}

\entry{Student Design Team}{Sept 2023 -- Present}{Electrical Lead}{University}
\begin{itemize}
  \item Designed a PCB for ...
  \item Led a team of 6 to ...
\end{itemize}

\section{Projects}
\textbf{Project Name} \textbar{} \textit{Python, React} \\
Short description of what it does and the impact.

\section{Skills}
\textbf{Languages:} Python, C/C++, TypeScript, MATLAB, \LaTeX \\
\textbf{Tools:} Git, Linux, KiCad, Docker

\end{document}
`,
      },
    ],
  },
];

export function getTemplate(id: string): Template {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
}
