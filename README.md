<div align="center">

<br>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://readme-typing-svg.demolab.com?font=JetBrains+Mono&weight=800&size=48&duration=1&pause=9999&color=E8ECF4&center=true&vCenter=true&width=220&height=58&lines=ADE">
  <img alt="ADE" src="https://readme-typing-svg.demolab.com?font=JetBrains+Mono&weight=800&size=48&duration=1&pause=9999&color=0D111A&center=true&vCenter=true&width=220&height=58&lines=ADE">
</picture>

<sub>**Agentic Dev Environment**</sub>

<br><br>

[![License: MIT](https://img.shields.io/badge/license-MIT-3b82f6?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![Electron](https://img.shields.io/badge/Electron_29-47848F?style=for-the-badge&logo=electron&logoColor=white)](https://electronjs.org)
[![node-pty](https://img.shields.io/badge/node--pty-real%20PTY-1a1a2e?style=for-the-badge)](https://github.com/homebridge/node-pty-prebuilt-multiarch#readme)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-22c55e?style=for-the-badge)](https://github.com/Rockazim/Agentic-Development-Environment/pulls)

<br>

Run **Claude Code**, **Codex**, and any CLI agent side-by-side<br>
in a grid of real terminal panes — all sharing the same project.

<br>

---

</div>

<br>

## Why

Most AI coding tools give you **one** assistant. ADE gives you a **grid** of them.

One pane debugs a pricing bug. Another refactors your filters. Another writes docs. Another investigates why staging broke. All at the same time. All in the same repo. Each pane is a real terminal — not a chat window.

<div align="center">

```
 ╭─ skinmerge ─────────────────────────────────────────────────────╮
 │                                                                  │
 │  ┌─ claude code ──────┐  ┌─ codex ───────────┐  ┌─ bash ──────┐ │
 │  │                    │  │                    │  │              │ │
 │  │  fixing StatTrak   │  │  writing API docs  │  │  npm test    │ │
 │  │  pricing bug...    │  │  for /trade-up     │  │  ✓ 14 pass  │ │
 │  │                    │  │                    │  │              │ │
 │  ├─ claude code ──────┤  ├─ codex ───────────┤  ├─ git ───────┤ │
 │  │                    │  │                    │  │              │ │
 │  │  refactoring       │  │  writing tests     │  │  5 files     │ │
 │  │  filter pipeline   │  │  for auth module   │  │  changed     │ │
 │  │                    │  │                    │  │              │ │
 │  └────────────────────┘  └────────────────────┘  └──────────────┘ │
 │                                                                  │
 ╰──────────────────────────────────────────────────────────────────╯
```

</div>

<br>

## Quick start

```bash
git clone https://github.com/Rockazim/Agentic-Development-Environment.git
cd Agentic-Development-Environment
npm install
npm run dev
```

> [!NOTE]
> Requires **Node.js 18+**. The `postinstall` script handles native module rebuilds automatically.
> If `npm install` fails, see [node-gyp prerequisites](https://github.com/nodejs/node-gyp#installation).

### Prerequisites

| | |
|:--|:--|
| **Node.js** | 18 or later |
| **Windows** | Python 3 + Visual Studio Build Tools (for native modules) |
| **macOS** | Xcode Command Line Tools (`xcode-select --install`) |
| **Linux** | `build-essential` / `make` / `gcc` (distro equivalent) |

> Native module rebuilds are handled automatically by the `postinstall` script.
> If you already have a working `node-gyp` setup, no extra steps are needed.

<br>

## Features

<table>
<tr>
<td width="50%">

### &nbsp;&nbsp;Workspace tabs
Each tab is a project. Create a workspace, pick a directory, choose your grid size (2–9 panes). Switch tabs — terminals stay alive in the background.

</td>
<td width="50%">

### &nbsp;&nbsp;Real terminals
Every pane is a full PTY via **node-pty** + **xterm.js**. Full color, scrollback, resize. Run any CLI tool — shells, agents, scripts.

</td>
</tr>
<tr>
<td width="50%">

### &nbsp;&nbsp;Voice typing
Speak into the focused pane. Audio is transcribed locally via **Hugging Face Transformers** — nothing leaves your machine. Toggle with a hotkey.

</td>
<td width="50%">

### &nbsp;&nbsp;Per-pane shell profiles
Each pane has its own shell selector. Switch between PowerShell, WSL, bash, zsh, or cmd — per pane, on the fly.

</td>
</tr>
<tr>
<td width="50%">

### &nbsp;&nbsp;Customizable hotkeys
Open the **keys** dialog to rebind shortcuts. Record new bindings, clear them, or reset to defaults. Persisted to localStorage.

</td>
<td width="50%">

### &nbsp;&nbsp;Cross-platform
Automatically detects available shells. PowerShell, WSL, and cmd on Windows. zsh and bash on macOS/Linux. Works on all three.

</td>
</tr>
</table>

<br>

## Keyboard shortcuts

| Shortcut | Action |
|:---------|:-------|
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd> | Toggle voice typing |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd> | Add pane to current workspace |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Backspace</kbd> | Close the active pane |

> On macOS, <kbd>Ctrl</kbd> is replaced by <kbd>Cmd</kbd>.

All shortcuts are rebindable via the **keys** button in the toolbar.

<br>

## Architecture

<div align="center">

```
  ┌─────────────────────────────────────────────────────────┐
  │                                                         │
  │   renderer.js                                           │
  │   workspaces · xterm · tabs · hotkeys · voice capture   │
  │                                                         │
  │              ▼  IPC (preload.js)  ▲                     │
  ├─────────────────────────────────────────────────────────┤
  │                                                         │
  │   electron/main.js                                      │
  │   window lifecycle · IPC routing · permissions          │
  │                                                         │
  │         ▼                    ▼                           │
  ├──────────────────┬──────────────────────────────────────┤
  │                  │                                      │
  │  terminal-mgr    │   voice-transcriber.js               │
  │  PTY spawn/kill  │   @huggingface/transformers          │
  │  shell profiles  │   local Whisper inference            │
  │                  │                                      │
  │      ▼           │                                      │
  │  node-pty ────►  │   real shell processes               │
  │                  │                                      │
  └──────────────────┴──────────────────────────────────────┘
```

</div>

<br>

## Project structure

```
electron/
├── main.js                 app lifecycle, IPC handlers, permissions
├── preload.js              context bridge (renderer ↔ main)
├── terminal-manager.js     PTY spawning, shell profile detection
└── voice-transcriber.js    local audio transcription via HF Transformers

backend/src/
├── contracts.ts            types, interfaces, port definitions
├── WorkspaceBackend.ts     orchestrator (projects, sessions, git, voice)
└── platform.ts             OS detection, shell resolution, path helpers

scripts/
└── install-electron-pty.js postinstall for native module rebuild

index.html                  UI shell — tabs, grid, dialogs
renderer.js                 frontend — workspaces, terminals, hotkeys, voice
```

<br>

## Tech

<div align="center">

| | |
|:--|:--|
| **Desktop** | Electron 29 |
| **Terminals** | xterm.js + node-pty (prebuilt) |
| **Voice** | @huggingface/transformers (local Whisper) |
| **Frontend** | Vanilla JS — no framework, no build step |
| **Backend** | TypeScript with ports & adapters |
| **Packaging** | electron-builder (Windows NSIS, macOS DMG) |

</div>

<br>

## Roadmap

| Status | Feature |
|:------:|---------|
| ✅ | Workspace tabs with real terminal grids |
| ✅ | PTY shell detection (PowerShell, WSL, cmd, zsh, bash) |
| ✅ | Per-pane shell profile selector |
| ✅ | Local voice transcription (Whisper via HF Transformers) |
| ✅ | Customizable hotkeys with recording UI |
| ✅ | Dynamic pane creation (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd>) |
| ✅ | Close-pane hotkey (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Backspace</kbd>) |
| ✅ | Native folder picker for workspace directory |
| ✅ | IPC security hardening and Content Security Policy |
| ⬜ | Git panel — branch, diffs, staging, commits |
| ⬜ | Chat history persistence |
| ⬜ | Pane resize and drag-to-rearrange |
| ⬜ | Agent file attribution (which agent changed what) |
| ⬜ | Settings and preferences |
| ⬜ | Plugin system |

<br>

## Contributing

PRs welcome. Fork it, branch it, change it, open a PR.

```bash
# development
npm run dev

# package for distribution
npm run dist:win     # → Windows NSIS installer
npm run dist:mac     # → macOS DMG
```

<details>
<summary><strong>Releases and versioning</strong></summary>

<br>

Desktop releases should be built from a clean checkout with the lockfile, not from an ad hoc local `npm install`.

#### Local Windows release

Run the Windows build from PowerShell, not WSL:

```powershell
npm ci
npm run dist:win
```

The packaged installer is written to `dist/`.

#### Versioning

Use npm versioning so the app version, git tag, and packaged release stay aligned:

```bash
npm version patch
# or: npm version minor
# or: npm version major
```

That updates `package.json`, creates a version commit, and creates a git tag such as `v0.1.1`.

#### GitHub release flow

This repo includes:

- `/.github/workflows/release.yml` for tag-driven Windows release builds
- `/.github/dependabot.yml` for weekly npm and GitHub Actions dependency checks

Recommended release sequence:

1. Merge the changes you want to ship.
2. Run `npm version patch|minor|major`.
3. Push the commit and tag: `git push && git push --tags`.
4. GitHub Actions builds the Windows installer from `npm ci`.
5. The workflow uploads the build artifacts to the matching GitHub Release.

</details>

<details>
<summary><strong>Security</strong></summary>

<br>

ADE follows Electron security best practices:

- **Sandbox enabled** — renderer runs in a sandboxed process
- **Context isolation** — no Node.js access from renderer code
- **IPC hardening** — all handlers validate sender origin via `assertTrustedSender()`
- **Content Security Policy** — strict CSP via meta tag (`default-src 'self'`, `object-src 'none'`, `frame-src 'none'`)
- **Navigation blocked** — renderer cannot navigate away from the app
- **External URLs filtered** — only `http`/`https` links open in the system browser

#### Release security checklist

- Keep `package-lock.json` committed and build releases with `npm ci`.
- Review dependency bumps before merging them.
- Prefer release builds from GitHub Actions instead of an everyday dev machine.
- Code-sign public Windows installers before broad distribution.
- Treat Electron security settings and preload IPC surface as release-critical code.

</details>

<br>

---

<div align="center">

<br>

<sub>Built for the workflow where one agent isn't enough.</sub>

<br><br>

[Report a bug](https://github.com/Rockazim/Agentic-Development-Environment/issues) · [Request a feature](https://github.com/Rockazim/Agentic-Development-Environment/issues)

<br>

</div>
