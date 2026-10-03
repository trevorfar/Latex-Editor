# Self-hosted TeXbench with a local TeX Live: full logs, warnings, SyncTeX and fast compiles.
#   docker build -t texbench .
#   docker run -p 3000:3000 texbench

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm ci
COPY . .
RUN STANDALONE=1 npm run build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      latexmk biber \
      texlive-latex-recommended texlive-latex-extra texlive-fonts-recommended texlive-fonts-extra \
      texlive-science texlive-pictures texlive-bibtex-extra texlive-xetex texlive-luatex \
      texlive-publishers texlive-lang-european lmodern \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 LATEX_BACKEND=local
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# Compile as an unprivileged user; LaTeX can only write inside its build directory.
RUN useradd --create-home texbench && mkdir -p /tmp/latex-studio && chown texbench /tmp/latex-studio
USER texbench
EXPOSE 3000
CMD ["node", "server.js"]
