# Spec-notator

Spec-notator is a desktop (and browser) app for annotating markdown specs and
exporting the result as an agent-ready prompt. You paste or open a markdown
document, select text or whole blocks, attach typed annotations
(`comment`, `replace`, `delete`, `add`, `question`, `approve`), and then
generate a structured payload to hand off to an LLM, a teammate in Slack, or a
code agent.

It is built with **SvelteKit 5 + TypeScript + Vite** on the frontend and
**Tauri 2** for the desktop shell. Because SvelteKit is configured with
`adapter-static`, the same build runs as a normal single-page web app in any
browser.

## Features

- Markdown rendering with stable block IDs and line numbers
- Two annotation modes:
  - **Text-range** annotations on a selection within a single block
  - **Pinpoint** annotations spanning one or more whole blocks
- Six annotation types with keyboard shortcuts (C / R / D / A / Q / K)
- Live output panel with three export formats:
  - **XML** — structured prompt for LLMs / agents
  - **Markdown** — human-readable diff-style suggestions
  - **Slack** — formatted message (casual or neutral tone, grouped by order or type)
- Light and dark themes, command palette, keyboard cheatsheet
- Document and annotation state persisted in `localStorage`

## Project layout

```
src/
  routes/+page.svelte    Main UI (single-page app)
  parser/                Markdown parser and DOM selection helpers
  prompts/               XML / Markdown / Slack output builders
  lib/sample-doc.ts      Bundled sample spec
  styles/global.css      App styles
  types.ts               Shared TypeScript types
src-tauri/               Rust crate, Tauri config, platform icons
static/                  Static assets served at the site root
```

## Prerequisites

- **Node.js 18+** and **pnpm** (the lockfile is `pnpm-lock.yaml`)
- For desktop builds only: **Rust** (stable toolchain) and the
  [Tauri 2 system prerequisites](https://v2.tauri.app/start/prerequisites/)
  for your OS (Xcode CLI tools on macOS, WebView2 + MSVC on Windows, the
  `webkit2gtk` and friends packages on Linux)

Install dependencies once:

```bash
pnpm install
```

## Run as a web app

The frontend is a standalone SPA — no Tauri or Rust toolchain needed.

```bash
pnpm dev
```

Then open <http://localhost:1420>. Hot reload is on by default.

To produce a static build you can host anywhere:

```bash
pnpm build
pnpm preview   # serve the production build locally
```

The build output lands in `build/`.

## Run as a desktop app

This wraps the same Vite dev server in a native window. The Tauri CLI will
start `pnpm dev` for you (see `src-tauri/tauri.conf.json`), so you don't need a
separate terminal.

```bash
pnpm tauri dev
```

The first run compiles the Rust shell and can take a few minutes; subsequent
runs are fast.

To produce a distributable desktop bundle for your current platform:

```bash
pnpm tauri build
```

Installers / app bundles are written under `src-tauri/target/release/bundle/`.

## How to use it

1. The app opens with a sample spec loaded. Replace it by pasting markdown into
   the editor or opening a file.
2. Select text inside a block — the annotation toolbar appears. Pick a type
   (or press its shortcut) and add a note.
3. To annotate one or more whole blocks instead, switch to **pinpoint** mode
   and click the blocks you want to cover.
4. Open the output panel to preview the generated prompt. Switch between XML,
   Markdown, and Slack formats; copy the result with one click.

## Useful scripts

| Command            | What it does                                              |
| ------------------ | --------------------------------------------------------- |
| `pnpm dev`         | Vite dev server on port 1420 (web)                        |
| `pnpm build`       | Static production build into `build/`                     |
| `pnpm preview`     | Serve the production build locally                        |
| `pnpm check`       | Type-check with `svelte-check`                            |
| `pnpm tauri dev`   | Run the desktop app against the dev server                |
| `pnpm tauri build` | Build a distributable desktop bundle                      |

## License

MIT — see [`LICENSE`](./LICENSE).
